/**
 * Contrato de MercadoPago compartido entre CANYP y este webhook.
 *
 * Módulo PURO: sin dependencias, sin `process.env`, sin `fetch`. Toda la
 * lógica que decide "esto es un pago válido de esta app y activa esta
 * licencia" vive acá para poder ejercitarse sin levantar Next.js ni tocar
 * Supabase. La ruta (`app/api/webhook/route.ts`) solo orquesta.
 *
 * Por qué existe: el backend de CANYP (`backend/pricing.py`, `PLANES_FALLBACK`)
 * y este archivo son el MISMO catálogo. Si divergen, el webhook valida contra
 * un precio que el comprador nunca pagó y rechaza pagos legítimos (o acepta
 * pagos de un plan que no se compró). Los ids de plan y los precios son el
 * contrato; cambiarlos acá obliga a cambiarlos allá.
 *
 * Contrato de `external_reference` (ver `backend/routers/suscripcion.py`,
 * `crear_preferencia`):
 *
 *     canyp:<client_id>        -> app_id="canyp", client_id=<client_id>
 *     ERP-<algo>               -> app_id="erp"  (flujo legacy heredado)
 *
 * El prefijo `ERP-` se conserva porque este mismo servicio lo emitía en su
 * propio `crear-preferencia`. CANYP nunca lo emite.
 */

/** Prefijo del flujo legacy (Ordo-ERP), que este repo heredó. */
export const PREFIJO_LEGACY = 'ERP-';

/** App_id que emite CANYP. */
export const APP_ID_CANYP = 'canyp';

/** app_id que se asumía para las referencias legacy `ERP-...`. */
export const APP_ID_LEGACY = 'erp';

/**
 * Catálogo de planes. `dias` es la duración que se suma al momento del pago.
 *
 * `canyp` DEBE coincidir con `PLANES_FALLBACK["canyp"]` de
 * `canyp/backend/pricing.py` (ids, precios y días).
 *
 * `precio: null` = "no hay precio confiable para esta app". Es el caso de las
 * referencias legacy: el precio histórico de Ordo-ERP cambió varias veces y no
 * hay un catálogo que lo respalde acá. Para esos planes NO se verifica el
 * monto (se deja pasar con un warning en el log) en vez de rechazar un pago
 * válido por un número que no se sabe. Nunca se inventa el monto.
 */
export const PLANES = {
  [APP_ID_CANYP]: {
    canyp_1_mes: { dias: 30, precio: 120000 },
    canyp_6_meses: { dias: 180, precio: 617000 },
    canyp_1_anio: { dias: 365, precio: 1234000 },
  },
  [APP_ID_LEGACY]: {
    '1_mes': { dias: 30, precio: null },
    '6_meses': { dias: 180, precio: null },
    '1_anio': { dias: 365, precio: null },
  },
};

/** Tolerancia al comparar montos (el flotante de MP viene con decimales). */
export const TOLERANCIA_MONTO = 0.01;

/**
 * Decodifica `external_reference` a `{ appId, clientId }`.
 *
 * Devuelve `null` si el formato no matchea NINGUNO de los dos contratos
 * conocidos. Quien llama tiene que tratar eso como error (respuesta no-2xx)
 * y no seguir: inventar un app_id sería escribir la licencia en el lugar
 * equivocado.
 *
 * @param {unknown} ref
 * @returns {{appId: string, clientId: string} | null}
 */
export function decodificarExternalReference(ref) {
  if (typeof ref !== 'string') return null;
  const valor = ref.trim();
  if (!valor) return null;

  // Legacy: `ERP-<algo>`. El sufijo completo es el identificador, porque el
  // flujo viejo usaba UUIDs que no admitían el prefijo de app.
  if (valor.startsWith(PREFIJO_LEGACY)) {
    const clientId = valor.slice(PREFIJO_LEGACY.length).trim();
    return clientId ? { appId: APP_ID_LEGACY, clientId } : null;
  }

  // CANYP: `<app_id>:<client_id>`, partido por el PRIMER ':'. El backend de
  // CANYP valida que ninguno de los dos valores contenga ':' (por eso el
  // partition y no un split sin límite).
  const separador = valor.indexOf(':');
  if (separador <= 0) return null;
  const appId = valor.slice(0, separador).trim();
  const clientId = valor.slice(separador + 1).trim();
  if (!appId || !clientId) return null;
  return { appId, clientId };
}

/**
 * Info del plan dentro de una app, o `null` si esa app no tiene ese plan.
 *
 * @param {string} appId
 * @param {string} planId
 */
export function buscarPlan(appId, planId) {
  const planes = PLANES[appId];
  if (!planes || typeof planId !== 'string') return null;
  return Object.prototype.hasOwnProperty.call(planes, planId) ? planes[planId] : null;
}

/**
 * Todos los plan ids de una app (para derivar un plan desde el monto).
 *
 * @param {string} appId
 * @returns {string[]}
 */
export function planesDeApp(appId) {
  const planes = PLANES[appId];
  return planes ? Object.keys(planes) : [];
}

/**
 * Deriva el plan desde el monto pagado, para cuando la preferencia no se puede
 * leer y no hay `metadata.plan`. Sólo considera planes con `precio` conocido.
 *
 * @param {string} appId
 * @param {number} monto
 * @returns {string | null} plan id, o null si el monto no corresponde a nadie
 */
export function planDesdeMonto(appId, monto) {
  if (!Number.isFinite(monto)) return null;
  for (const [planId, info] of Object.entries(PLANES[appId] || {})) {
    if (info.precio === null) continue;
    if (Math.abs(info.precio - monto) <= TOLERANCIA_MONTO) return planId;
  }
  return null;
}

/**
 * `fechaExpiracion` = momento del pago + duración del plan.
 *
 * El ancla es SIEMPRE el momento del pago (`date_approved` que devuelve
 * MercadoPago), nunca "ahora": si la notificación llega tarde, o se reintenta,
 * la licencia tiene que contar los días que se pagaron, no los días que el
 * servidor estuvo mirando. Si el pago no trae `date_approved` se usa el
 * momento de la notificación (se registra en el log del llamador).
 *
 * @param {string} planId
 * @param {string} fechaPago ISO 8601
 * @returns {string | null} ISO 8601, o null si el plan es desconocido
 */
export function calcularFechaExpiracion(planId, fechaPago) {
  const dias = duracionDePlan(planId);
  if (dias === null) return null;
  const base = new Date(fechaPago);
  if (Number.isNaN(base.getTime())) return null;
  return new Date(base.getTime() + dias * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * Duración en días de un plan, o `null` si no existe en el catálogo.
 *
 * @param {string} planId
 * @returns {number | null}
 */
export function duracionDePlan(planId) {
  for (const planes of Object.values(PLANES)) {
    if (Object.prototype.hasOwnProperty.call(planes, planId)) return planes[planId].dias;
  }
  return null;
}

/**
 * Decide si el pago verificado contra la API de MercadoPago es activable.
 *
 * Tres cortes distintos, y los tres son no-2xx (para que MercadoPago reintente
 * y quede en el log) en vez de un 200 silencioso:
 *
 * 1. `status !== 'approved'` -> el pago no se cobró (o se rechazó).
 * 2. monto != precio del plan -> el plan del metadata no es el que se cobró.
 * 3. `metadata.client_id` presente y distinto al de la `external_reference`
 *    -> la referencia y la preferencia no hablan del mismo cliente.
 *
 * @param {{status?: string, transaction_amount?: number, external_reference?: string}} pago
 * @param {{appId: string, planId: string, clientId?: string, metadataClientId?: string|null}} esperado
 * @returns {{ok: true, advertencias: string[]} | {ok: false, error: string}}
 */
export function verificarPago(pago, esperado) {
  const advertencias = [];
  if (!pago || typeof pago !== 'object') return { ok: false, error: 'pago_ilegible' };

  if (pago.status !== 'approved') {
    return { ok: false, error: `pago_no_aprobado_${pago.status ?? 'desconocido'}` };
  }

  const plan = buscarPlan(esperado.appId, esperado.planId);
  if (!plan) return { ok: false, error: `plan_desconocido_${esperado.planId}` };

  // Monto: se exige contra el precio del plan. Si el catálogo no tiene precio
  // para esta app (legacy), no se verifica de a stick: se avisa y se sigue,
  // porque no hay número confiable con el cual comparar.
  const monto = Number(pago.transaction_amount);
  if (typeof plan.precio === 'number') {
    if (!Number.isFinite(monto)) return { ok: false, error: 'monto_ilegible' };
    if (Math.abs(monto - plan.precio) > TOLERANCIA_MONTO) {
      return {
        ok: false,
        error: `monto_no_coincide_${monto}_esperado_${plan.precio}`,
      };
    }
  } else {
    advertencias.push(`monto_no_verificable_plan_${esperado.planId}`);
  }

  if (
    esperado.metadataClientId &&
    esperado.clientId &&
    esperado.metadataClientId !== esperado.clientId
  ) {
    return { ok: false, error: 'client_id_no_coincide_con_external_reference' };
  }

  return { ok: true, advertencias };
}

/**
 * Lee la configuración del runtime. Falla cerrado: si falta cualquiera de las
 * tres variables que hacen falta para activar una licencia, devuelve un error
 * y el llamador responde 5xx. Nunca devuelve credenciales de relleno ni
 * asume un proyecto de Supabase por defecto.
 *
 * `SUPABASE_SERVICE_ROLE_KEY` es obligatoria a propósito: con la clave `anon`
 * y RLS activo, la escritura se deniega y el webhook hoy respondía 200 igual,
 * que es exactamente el bug de "cobró y no activó" sin dejar rastro.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {{ok: true, supabaseUrl: string, supabaseServiceKey: string, mpAccessToken: string}
 *          | {ok: false, error: string, falta: string[]}}
 */
export function resolverConfig(env) {
  const falta = [];
  const supabaseUrl = (env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const supabaseServiceKey = (env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const mpAccessToken = (env.MP_ACCESS_TOKEN || '').trim();

  if (!supabaseUrl) falta.push('NEXT_PUBLIC_SUPABASE_URL');
  if (!supabaseServiceKey) falta.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!mpAccessToken) falta.push('MP_ACCESS_TOKEN');

  if (falta.length > 0) {
    return { ok: false, error: `config_incompleta:${falta.join(',')}`, falta };
  }
  return { ok: true, supabaseUrl, supabaseServiceKey, mpAccessToken };
}

/**
 * Construye la fila a escribir en `suscripciones`.
 *
 * Contrato de columnas (el que lee `canyp/backend/routers/suscripcion.py`):
 *
 *   client_id        -> filtro de `_buscar_suscripcion_supabase`
 *   app_id           -> filtro de `_buscar_suscripcion_supabase` (CANYP exige
 *                       los DOS; sin app_id la fila queda invisible)
 *   estado           -> vocabulario canónico `activo` de
 *                       `backend/subscription_status.py`
 *   mp_payment_id    -> como lo busca `_buscar_suscripcion_por_pago`
 *                       (`?mp_payment_id=eq.<id>`). El nombre histórico
 *                       `payment_id` no lo lee nadie.
 *   fecha_inicio     -> momento del pago
 *   fecha_expiracion -> pago + duración del plan
 *   plan             -> id del catálogo
 *   mp_response      -> resumen del pago tal como lo vio MercadoPago, para
 *                       auditar qué se cobró sin volver a guardar el cuerpo
 *                       crudo de la notificación
 *
 * @param {{appId: string, clientId: string, planId: string, paymentId: string,
 *          preferenceId?: string | null, fechaInicio: string, fechaExpiracion: string,
 *          mpResponse?: Record<string, unknown> | null}} args
 * @returns {Record<string, unknown>}
 */
export function construirFilaActivacion(args) {
  const fila = {
    client_id: args.clientId,
    app_id: args.appId,
    plan: args.planId,
    estado: 'activo',
    fecha_inicio: args.fechaInicio,
    fecha_expiracion: args.fechaExpiracion,
    mp_payment_id: args.paymentId,
  };
  if (args.preferenceId) fila.preference_id = args.preferenceId;
  if (args.mpResponse) fila.mp_response = JSON.stringify(args.mpResponse);
  return fila;
}

/**
 * Idempotencia: ¿esta fila ya registra ESTE pago como activo?
 *
 * Sin esto, cada reentrega del webhook (MercadoPago reintenta hasta que haya
 * un 2xx, y el navegador puede llamar `/confirmar-pago` en paralelo) recalcula
 * `fecha_expiracion` desde la fecha de entrega y regala días.
 *
 * @param {Record<string, any> | null} fila
 * @param {string} paymentId
 * @returns {boolean}
 */
export function yaActivadaConEstePago(fila, paymentId) {
  if (!fila || typeof fila !== 'object') return false;
  if (String(fila.estado ?? '').trim().toLowerCase() !== 'activo') return false;
  const previo = fila.mp_payment_id;
  return previo !== null && previo !== undefined && String(previo) === String(paymentId);
}