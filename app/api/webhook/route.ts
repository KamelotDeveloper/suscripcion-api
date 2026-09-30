import { createClient } from '@supabase/supabase-js';

import {
  construirFilaActivacion,
  calcularFechaExpiracion,
  decodificarExternalReference,
  buscarPlan,
  planDesdeMonto,
  resolverConfig,
  verificarPago,
  yaActivadaConEstePago,
} from '../../../lib/mp-contract.mjs';

/**
 * Webhook de pagos de MercadoPago: el activador principal de la licencia.
 *
 * Antes este archivo tenía seis cortes independientes y ningún test. Todos
 * están cerrados acá; la lógica de decisión vive en `lib/mp-contract.mjs` para
 * que sea ejercitable sin levantar Next.
 *
 * Los cortes que este archivo cerraba, y dónde:
 *
 *  1. `external_reference.startsWith('ERP-')` descartaba `canyp:<client_id>`,
 *     que es lo único que CANYP emite. Ahora se decodifica el formato
 *     `app_id:client_id` y `ERP-` queda solo para el flujo legacy.
 *  2. La URL de Supabase estaba hardcodeada a otro proyecto que el que lee
 *     CANYP, así que la plata entraba donde nadie mira. Ahora sale 100% del
 *     entorno (`NEXT_PUBLIC_SUPABASE_URL`).
 *  3. La fila insertada no llevaba `app_id`, y CANYP filtra por
 *     `client_id AND app_id`: la fila quedaba invisible para el backend.
 *  4. Se escribía la columna `payment_id`; CANYP lee `mp_payment_id`.
 *  5. Se usaba la clave `anon` del entorno. Con RLS activo la escritura se
 *     denegaba en silencio y el webhook respondía 200 igual. Ahora exige
 *     `SUPABASE_SERVICE_ROLE_KEY` y falla cerrado si no está.
 *  6. El switch de planes solo conocía `1_mes`/`6_meses`/`1_anio`, así que un
 *     plan de CANYP caía en `default` = 1 mes: quien pagaba el anual recibía
 *     un mes. Ahora los ids son los del catálogo y la expiración sale del
 *     momento del pago.
 *
 * Además: se verifica el pago contra la API de MercadoPago (status +
 * monto + referencia), la escritura es idempotente, y todo fallo devuelve
 * no-2xx con el error real en el log. Antes devolvía `{received: true}` con
 * 200 incluso con la escritura denegada, así que MercadoPago daba el webhook
 * por entregado y no reintentaba nunca.
 *
 * Variables de entorno que necesita este webhook (valores en el despliegue,
 * nunca en el repo):
 *   - NEXT_PUBLIC_SUPABASE_URL   -> proyecto de Supabase del operador. DEBE ser
 *                                   el mismo que lee CANYP: si difieren, el
 *                                   pago se registra donde el backend no mira
 *   - SUPABASE_SERVICE_ROLE_KEY  -> credencial de privilegio; sin ella 503
 *   - MP_ACCESS_TOKEN            -> sin ella no se puede verificar el cobro; 503
 */

const MP_API_PAGOS = 'https://api.mercadopago.com/v1/payments';
const MP_API_PREFERENCIAS = 'https://api.mercadopago.com/checkout/preferences';
const TABLA = 'suscripciones';

export const runtime = 'nodejs';

/** Cuerpo de la notificación de MercadoPago (campos que nos interesan). */
type NotificacionMP = {
  id?: unknown;
  type?: unknown;
  topic?: unknown;
  data?: { id?: unknown } | null;
  payment_id?: unknown;
};

/** Cualquier objeto JSON vindo de la API de MercadoPago. */
type Json = Record<string, unknown>;

type ResultadoConsulta =
  | { ok: true; pago: Json }
  | { ok: false; status: number; error: string; detalle?: string };

type ResultadoPreferencia = { ok: true; preferencia: Json } | { ok: false; status?: number };

/** Respuesta 2xx: la notificación quedó atendida (procesada o idempotente). */
function ok(payload: Json): Response {
  return Response.json({ ok: true, ...payload });
}

/**
 * Respuesta no-2xx: la notificación NO quedó atendida, para que MercadoPago
 * la reintente y quede el error real en el log. Nunca 200 con un error
 * adentro: era la forma en que este webhook se tragaba los fallos.
 */
function fail(status: number, error: string, extra: Json = {}): Response {
  console.error('[webhook] error:', error, JSON.stringify(extra));
  return Response.json({ ok: false, error, ...extra }, { status });
}

/**
 * `GET /v1/payments/{id}`: la única fuente confiable del pago.
 *
 * La notificación de MercadoPago para el topic `payment` trae `data.id` y
 * nada más: NO trae `external_reference`, ni `status`, ni `metadata`, ni
 * `plan`. Por eso el código anterior nunca entraba a la rama de activación
 * (buscaba `body.external_reference` y `body.status`, que no existen) y
 * aun así respondía 200. Traer el pago completo es lo que hace que la
 * verificación de abajo sea real.
 */
async function consultarPago(mpAccessToken: string, paymentId: string): Promise<ResultadoConsulta> {
  let respuesta: Response;
  try {
    respuesta = await fetch(`${MP_API_PAGOS}/${encodeURIComponent(paymentId)}`, {
      headers: { Authorization: `Bearer ${mpAccessToken}`, Accept: 'application/json' },
    });
  } catch (error) {
    return { ok: false, status: 502, error: 'mp_inalcanzable', detalle: String(error) };
  }

  if (respuesta.status === 404) {
    return { ok: false, status: 404, error: 'pago_no_encontrado_en_mp' };
  }
  if (!respuesta.ok) {
    return {
      ok: false,
      status: 502,
      error: 'mp_respondio_error',
      detalle: `HTTP ${respuesta.status}`,
    };
  }
  try {
    return { ok: true, pago: (await respuesta.json()) as Json };
  } catch {
    return { ok: false, status: 502, error: 'mp_respuesta_ilegible' };
  }
}

/**
 * `GET /v1/checkout/preferences/{id}`: de acá sale `metadata.plan`.
 *
 * El `metadata` se guarda en la PREFERENCIA, no en el pago: el recurso de pago
 * no lo devuelve. Por eso, sin la preferencia no hay plan confiable y se cae
 * al monto (ver `planDesdeMonto`), no a un "1 mes" por defecto.
 */
async function consultarPreferencia(
  mpAccessToken: string,
  preferenceId: string | null | undefined,
): Promise<ResultadoPreferencia> {
  if (!preferenceId) return { ok: false };
  try {
    const respuesta = await fetch(
      `${MP_API_PREFERENCIAS}/${encodeURIComponent(preferenceId)}`,
      { headers: { Authorization: `Bearer ${mpAccessToken}`, Accept: 'application/json' } }
    );
    if (!respuesta.ok) return { ok: false, status: respuesta.status };
    return { ok: true, preferencia: (await respuesta.json()) as Json };
  } catch {
    return { ok: false };
  }
}

export async function POST(request: Request) {
  // ---------- 1. Envoltorio de la notificación ----------
  let body: NotificacionMP;
  try {
    body = (await request.json()) as NotificacionMP;
  } catch {
    return fail(400, 'cuerpo_json_invalido');
  }

  // `type` (o `topic` en payloads viejos) viene en el BODY; `data.id` identifica
  // el pago. Aceptar cualquiera de los dos evita depender del nombre exacto del
  // campo que manda MercadoPago en cada versión.
  //
  // OJO: `body.id` NO es el id del pago, es el id de la NOTIFICACIÓN. Usarlo
  // como fallback haría consultar un recurso equivocado a la API (y, si ese
  // idMovistar deNotification, un pago ajeno activaría esta licencia).
  const topic = body?.type ?? body?.topic ?? null;
  const paymentId = body?.data?.id ?? body?.payment_id ?? null;

  // Notificación que no es de un pago (por ejemplo la de prueba del panel):
  // se acusa recibo para que MercadoPago no la reintente, pero no se toca nada.
  if (topic !== null && topic !== 'payment') {
    return ok({ recibido: true, topic });
  }
  if (!paymentId) {
    return fail(400, 'notificacion_sin_payment_id');
  }

  // ---------- 2. Configuración: falla cerrado ----------
  const cfg = resolverConfig(process.env);
  if (!cfg.ok) {
    return fail(503, cfg.error, {
      detalle:
        'Falta configuración del webhook: se responde 503 a propósito para que ' +
        'MercadoPago reintente. NO se activa nada sin poder verificar y escribir.',
      falta: cfg.falta,
    });
  }

  // ---------- 3. Verificación real contra MercadoPago ----------
  const consulta = await consultarPago(cfg.mpAccessToken, String(paymentId));
  if (!consulta.ok) {
    return fail(consulta.status, consulta.error, { detalle: consulta.detalle });
  }
  const pago = consulta.pago;

  if (pago.status !== 'approved') {
    return fail(409, `pago_no_aprobado_${pago.status ?? 'desconocido'}`, {
      payment_id: String(paymentId),
    });
  }

  // ---------- 4. Identidad: `app_id:client_id` ----------
  const ref = decodificarExternalReference(pago.external_reference);
  if (!ref) {
    return fail(400, 'external_reference_invalida', {
      detalle:
        'La external_reference del pago no matchea ningún contrato conocido ' +
        '(canyp:<client_id> ni ERP-<...>). Se responde 400 para que quede en el log.',
      external_reference: pago.external_reference ?? null,
    });
  }

  // ---------- 5. Plan: metadata de la preferencia, con el monto como respaldo ----------
  const pref = await consultarPreferencia(cfg.mpAccessToken, pago.preference_id as string | undefined);
  const metadata: Json = pref.ok ? ((pref.preferencia?.metadata as Json | undefined) ?? {}) : {};
  const planDesdeMetadata = typeof metadata.plan === 'string' ? metadata.plan : null;

  const planId =
    planDesdeMetadata && buscarPlan(ref.appId, planDesdeMetadata)
      ? planDesdeMetadata
      : planDesdeMonto(ref.appId, Number(pago.transaction_amount));

  if (!planId) {
    return fail(400, 'plan_no_resoluble', {
      detalle:
        'No se pudo determinar el plan (ni metadata.plan de la preferencia ni un ' +
        'precio del catálogo que coincida con transaction_amount). Antes caía en ' +
        '"1 mes" por defecto; ahora se rechaza en vez de regalar un mes.',
      app_id: ref.appId,
      transaction_amount: pago.transaction_amount ?? null,
    });
  }

  const verificacion = verificarPago(pago, {
    appId: ref.appId,
    planId,
    clientId: ref.clientId,
    metadataClientId: typeof metadata.client_id === 'string' ? metadata.client_id : null,
  });
  if (!verificacion.ok) {
    return fail(409, verificacion.error, {
      app_id: ref.appId,
      plan: planId,
      transaction_amount: pago.transaction_amount ?? null,
    });
  }
  for (const advertencia of verificacion.advertencias) {
    console.warn('[webhook] advertencia:', advertencia, JSON.stringify({ plan: planId }));
  }

  // ---------- 6. Fecha de expiración anclada al pago ----------
  const fechaPago =
    (pago.date_approved as string | undefined) ||
    (pago.date_created as string | undefined) ||
    new Date().toISOString();
  const fechaExpiracion = calcularFechaExpiracion(planId, fechaPago);
  if (!fechaExpiracion) {
    return fail(400, 'plan_desconocido_para_calcular_expiracion', { plan: planId });
  }

  // ---------- 7. Escritura idempotente en Supabase ----------
  const supabase = createClient(cfg.supabaseUrl, cfg.supabaseServiceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: filas, error: errorLectura } = await supabase
    .from(TABLA)
    .select('*')
    .match({ client_id: ref.clientId, app_id: ref.appId });
  if (errorLectura) {
    return fail(502, 'supabase_lectura_denegada', { detalle: errorLectura.message });
  }

  const fila = filas && filas.length > 0 ? filas[0] : null;

  // Idempotencia: si esta fila ya está activa con este mismo pago, se acusa
  // recibo SIN recalcular la expiración. Cada reentrega del webhook (MP
  // reintenta hasta un 2xx) regalaría días de licencia.
  if (yaActivadaConEstePago(fila, String(paymentId))) {
    console.log(
      '[webhook] pago ya activado, sin cambios:',
      JSON.stringify({ app_id: ref.appId, client_id: ref.clientId, payment_id: String(paymentId) })
    );
    return ok({ recibido: true, idempotente: true, app_id: ref.appId, client_id: ref.clientId });
  }

  const datos = construirFilaActivacion({
    appId: ref.appId,
    clientId: ref.clientId,
    planId,
    paymentId: String(paymentId),
    preferenceId: (pago.preference_id as string | undefined) ?? null,
    fechaInicio: fechaPago,
    fechaExpiracion,
    mpResponse: {
      status: pago.status ?? null,
      transaction_amount: pago.transaction_amount ?? null,
      external_reference: pago.external_reference ?? null,
      date_approved: pago.date_approved ?? null,
      preference_id: pago.preference_id ?? null,
    },
  });

  let errorEscritura: { code?: string; message: string } | null = null;
  if (fila) {
    ({ error: errorEscritura } = await supabase.from(TABLA).update(datos).match({
      client_id: ref.clientId,
      app_id: ref.appId,
    }));
  } else {
    const insercion = await supabase.from(TABLA).insert(datos);
    errorEscritura = insercion.error;
    // 23505 = unique violation: la fila apareció entre la lectura y el insert
    // (dos entregas simultáneas). Se resuelve actualizando, no duplicando.
    if (errorEscritura && String(errorEscritura.code) === '23505') {
      ({ error: errorEscritura } = await supabase.from(TABLA).update(datos).match({
        client_id: ref.clientId,
        app_id: ref.appId,
      }));
    }
  }

  if (errorEscritura) {
    // Antes esto se logueaba y se caía al `return {received:true}` con 200.
    // Con RLS y la clave anon era EXACTAMENTE este camino el que se llevaba
    // el pago sin activar, en silencio.
    return fail(502, 'supabase_escritura_denegada', { detalle: errorEscritura.message });
  }

  console.log(
    '[webhook] suscripción activada:',
    JSON.stringify({
      app_id: ref.appId,
      client_id: ref.clientId,
      plan: planId,
      payment_id: String(paymentId),
      hasta: fechaExpiracion,
    })
  );
  return ok({
    recibido: true,
    app_id: ref.appId,
    client_id: ref.clientId,
    plan: planId,
    fecha_expiracion: fechaExpiracion,
    idempotente: false,
  });
}