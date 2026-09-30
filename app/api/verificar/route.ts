import { createClient } from '@supabase/supabase-js';

import {
  COLUMNAS_VERIFICACION,
  construirRespuestaVerificacion,
  elegirSuscripcion,
  resolverConfigLectura,
  respuestaSinSuscripcion,
} from '../../../lib/mp-contract.mjs';

/**
 * Consulta de licencia. A diferencia del webhook, esto NO es el activador: es la
 * lectura que un cliente (o una app) hace para saber si tiene licencia.
 *
 * Los cuatro cortes que este archivo tenía, y qué se hizo en cada uno. Todos
 * menos el primero eran el mismo bug con distinta ropa: la ruta contestaba
 * "no tenés suscripción" a gente que sí la tenía.
 *
 *  1. Filtraba solo por `client_id`. CANYP filtra por `client_id AND app_id`
 *     (`backend/routers/suscripcion.py::_buscar_suscripcion_supabase`) y en la
 *     tabla conviven `app_id = 'canyp'` y `app_id = 'ordo'`: con un solo campo
 *     la respuesta era ambigua y, con dos filas, `.single()` reventaba.
 *     Ahora se filtra por los dos y, si aun así hay más de una fila, gana la
 *     más reciente (ver `elegirSuscripcion`): una respuesta clara le sirve a
 *     alguien, un `PGRST116` con 500 no.
 *
 *  2. Leía con `NEXT_PUBLIC_SUPABASE_KEY` (rol `anon`). NO hay política de
 *     SELECT para `anon` sobre `suscripciones`, y PostgREST no avisa cuando RLS
 *     filtra: devuelve `200` con `[]`. Medido contra el proyecto del operador,
 *     con `service_role` hay 19 filas y con `anon` se ven 0. O sea que esta
 *     ruta contestaba "Usuario sin suscripción" a todo el mundo, paga o no.
 *     Un error que se disfraza de "no hay licencia" es el peor bug posible en
 *     un chequeo de licencia, así que ahora se lee con `service_role`
 *     (`resolverConfigLectura`) y, si falta, se responde 503 en vez de mentir.
 *
 *  3. `activo = estado === 'prueba'` daba acceso INDEFINIDO a cualquier fila de
 *     prueba sin fecha, o con fecha ya vencida. De las 19 filas que hay hoy, 15
 *     tienen `fecha_expiracion` en NULL. Ahora la fecha es obligatoria para todo
 *     estado con acceso, igual que `estado_da_acceso` en CANYP.
 *
 *  4. `new Date(fecha_expiracion)` sobre un valor ausente daba epoch, y la
 *     resta de días podía salir negativa: "Suscripción activa (-3 días)".
 *     `parseIsoFecha` devuelve `null` ante una fecha inválida y los días nunca
 *     son negativos.
 *
 * Sobre exponer `service_role`: la credencial se usa acá adentro, en el
 * servidor, y NUNCA sale por la respuesta — la respuesta sale de
 * `construirRespuestaVerificacion`, que solo devuelve los campos del contrato
 * (ni `email`, ni `mp_payment_id`; por eso la consulta proyecta una lista de
 * columnas en vez de `select('*')`). Un endpoint público que responde si un
 * UUID está dado de alta es, en el peor de los casos, un oráculo de licencias
 * sobre identificadores que nadie publica; por eso el orden natural de las
 * cosas es que CANYP verifique contra SU backend (que es lo que ya hace) y este
 * endpoint quede solo como compatibilidad para clientes viejos.
 *
 * Variables de entorno (valores en el despliegue, nunca en el repo):
 *   - NEXT_PUBLIC_SUPABASE_URL  -> proyecto del operador, el MISMO que lee CANYP
 *   - SUPABASE_SERVICE_ROLE_KEY -> lectura con privilegio; sin ella 503
 */

const TABLA = 'suscripciones';

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Handle preflight
export async function OPTIONS() {
  return new Response(null, { status: 200, headers });
}

export async function POST(request: Request) {
  // ---------- 1. Body: los DOS identificadores ----------
  let body: { app_id?: unknown; client_id?: unknown };
  try {
    body = (await request.json()) as { app_id?: unknown; client_id?: unknown };
  } catch {
    return Response.json({ error: 'cuerpo_json_invalido' }, { status: 400, headers });
  }

  const appId = typeof body?.app_id === 'string' ? body.app_id.trim() : '';
  const clientId = typeof body?.client_id === 'string' ? body.client_id.trim() : '';

  // `app_id` no es opcional: es parte de la clave de la licencia. Sin él la
  // respuesta no significa nada (mismo `client_id` en dos apps = dos
  // licencias distintas) y el que consulta ni sabe a cuál se le responde.
  if (!clientId || !appId) {
    return Response.json(
      { error: 'app_id y client_id requeridos' },
      { status: 400, headers }
    );
  }

  // ---------- 2. Configuración: falla cerrado ----------
  const cfg = resolverConfigLectura(process.env);
  if (!cfg.ok) {
    console.error('[verificar] error:', cfg.error);
    return Response.json(
      {
        error: cfg.error,
        mensaje: 'No se puede verificar la suscripción en este momento.',
      },
      { status: 503, headers }
    );
  }

  // ---------- 3. Lectura ----------
  let supabase: ReturnType<typeof createClient>;
  try {
    supabase = createClient(cfg.supabaseUrl, cfg.supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  } catch (error) {
    // `createClient` tira si la URL o la clave están mal formadas. Sin este
    // try, eso salía como 500 con stack trace y el cliente veía "Error interno".
    console.error('[verificar] error:', error);
    return Response.json(
      { error: 'supabase_config_invalida', detalle: String(error) },
      { status: 502, headers }
    );
  }

  // `match` con los DOS campos, sin `single()`: cero filas es "sin
  // suscripción" (respuesta normal, no error) y varias filas se resuelven
  // eligiendo la más reciente. El límite acota un `client_id` con basura
  // duplicada a mano sin traer la tabla entera.
  const { data: filas, error } = await supabase
    .from(TABLA)
    .select(COLUMNAS_VERIFICACION.join(','))
    .match({ client_id: clientId, app_id: appId })
    .limit(50);

  // Una falla de lectura NO se reporta como "usuario sin suscripción": sería
  // inventar un dato. Se devuelve 5xx con el error real en el log, que es lo
  // único que permite distinguir "no hay licencia" de "no pude mirar".
  if (error) {
    console.error('[verificar] error de lectura:', error.message);
    return Response.json(
      { error: 'supabase_lectura_denegada', detalle: error.message },
      { status: 502, headers }
    );
  }

  const suscripcion = elegirSuscripcion(filas);
  if (!suscripcion) {
    return Response.json(respuestaSinSuscripcion(), { headers });
  }

  if (Array.isArray(filas) && filas.length > 1) {
    // No es un error, pero sí es una anomalía: dos filas para la misma clave
    // significa que algo escribe sin deduplicar. Queda en el log para
    // corregirlo en la fuente y no acá.
    console.warn(
      '[verificar] filas duplicadas para la misma clave, se usa la más reciente:',
      JSON.stringify({ app_id: appId, client_id: clientId, filas: filas.length })
    );
  }

  return Response.json(construirRespuestaVerificacion(suscripcion), { headers });
}
