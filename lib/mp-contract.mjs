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
    canyp_1_mes: { dias: 30, precio: 100 },
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
 * `SUPABASE_SERVICE_ROLE_KEY` (o su alias `SUPABASE_SERVICE_KEY`) es
 * obligatoria a propósito: con la clave `anon` y RLS activo, la escritura se
 * deniega y el webhook hoy respondía 200 igual, que es exactamente el bug de
 * "cobró y no activó" sin dejar rastro.
 *
 * Se aceptan los dos nombres porque el despliegue real cargó la service key
 * como `SUPABASE_SERVICE_KEY` (nombre de la sesión de septiembre) mientras que
 * este contrato usa `SUPABASE_SERVICE_ROLE_KEY`. Cualquiera de los dos sirve;
 * la falta de ambos falla cerrado.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {{ok: true, supabaseUrl: string, supabaseServiceKey: string, mpAccessToken: string}
 *          | {ok: false, error: string, falta: string[]}}
 */
export function resolverConfig(env) {
  const falta = [];
  const supabaseUrl = (env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const supabaseServiceKey = (env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY || '').trim();
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

// ==================== VERIFICACIÓN DE LICENCIA ====================

/**
 * Contrato de `/api/verificar` (y de su equivalente en CANYP,
 * `backend/routers/suscripcion.py::verificar_suscripcion`).
 *
 * Igual que el webhook, la decisión vive acá y no en la ruta: son reglas puras
 * (estado, fechas, selección de fila) que se pueden ejercitar sin levantar Next
 * ni hablar con Supabase.
 *
 * Reglas del vocabulario, que son las de `canyp/backend/subscription_status.py`
 * (el archivo canónico; si divergen, CANYP deja de reconocer la licencia):
 *
 *   - `estado` es UNO de `pendiente` | `prueba` | `activo` | `expirado`.
 *     `pendiente` (pago no aprobado) y `expirado` NO dan acceso.
 *   - Los sinónimos `activa` / `active` se aceptan SOLO en lectura: los escribió
 *     el webhook viejo y CANYP los normaliza a `activo`.
 *   - Un estado desconocido NO da acceso. Adivinar sería el bug.
 *
 * Y una diferencia deliberada con la versión anterior de esta verificación,
 * documentada porque cambia el resultado de filas reales: acá la fecha de
 * expiración es obligatoria para TODOS los estados con acceso, no solo para
 * `activo`. La versión anterior hacía `estado === 'prueba' ⇒ activo`, o sea que
 * una fila `prueba` sin `fecha_expiracion` (o con una fecha que ya pasó) daba
 * acceso INDEFINIDO. Hoy, de las 19 filas de la tabla del operador, 15 tienen
 * `fecha_expiracion` en NULL: con la regla vieja, quince filas de corrupto
 * abrían la puerta para siempre. Es el mismo criterio fail-closed de
 * `estado_da_acceso` en CANYP.
 */

/** Días de la prueba gratis que anuncia `/api/verificar`. */
export const DIAS_PRUEBA = 7;

/** Estados canónicos de `suscripciones.estado` (ver `backend/subscription_status.py`). */
export const ESTADOS = {
  PENDIENTE: 'pendiente',
  PRUEBA: 'prueba',
  ACTIVO: 'activo',
  EXPIRADO: 'expirado',
};

/** Estados que habilitan licencia (siempre con `fecha_expiracion` en el futuro). */
export const ESTADOS_CON_ACCESO = [ESTADOS.PRUEBA, ESTADOS.ACTIVO];

/** Sinónimos heredados: se normalizan en lectura, nunca se escriben. */
export const SINONIMOS_ESTADO = {
  activa: ESTADOS.ACTIVO,
  active: ESTADOS.ACTIVO,
};

/**
 * Columnas que `/api/verificar` proyecta de `suscripciones`.
 *
 * Lista explícita y no `select('*')` a propósito: este endpoint es público y
 * con `Access-Control-Allow-Origin: *`, así que `*` publicaría `email` y
 * `mp_payment_id` de quien consultara. La respuesta pública queda
 * reducida al contrato de `/api/verificar`.
 *
 * `created_at` NO se pide a propósito: si la columna no existiera, PostgREST
 * responde 400 (`42703`) y el endpoint se caía entero. Para desempates se usa
 * `fecha_inicio`, que es la que escriben el webhook (`mp-contract.mjs`) y CANYP.
 */
export const COLUMNAS_VERIFICACION = [
  'client_id',
  'app_id',
  'estado',
  'plan',
  'fecha_inicio',
  'fecha_expiracion',
];

/**
 * Estado crudo de la fila -> estado canónico, o `null` si no se reconoce.
 *
 * @param {unknown} valor
 * @returns {string | null}
 */
export function normalizarEstado(valor) {
  if (valor === null || valor === undefined) return null;
  const texto = String(valor).trim().toLowerCase();
  if (!texto) return null;
  if (Object.prototype.hasOwnProperty.call(SINONIMOS_ESTADO, texto)) {
    return SINONIMOS_ESTADO[texto];
  }
  return Object.values(ESTADOS).includes(texto) ? texto : null;
}

/**
 * Timestamp de Postgres -> `Date` UTC, o `null` si no hay fecha válida.
 *
 * Hay que normalizar tres cosas porque los dos que escriben la tabla no
 * escriben igual:
 *
 *   1. `datetime.utcnow().isoformat()` (CANYP, `crear_suscripcion`) deja la
 *      fecha SIN offset, y en JavaScript una fecha sin offset se interpreta
 *      como hora LOCAL. Sin el `Z` que se agrega acá, una licencia de un club
 *      de Buenos Aires se cuenta tres horas antes de lo que corresponde.
 *   2. Postgres puede mandar la fracción de segundos con 6 dígitos
 *      (`...:00.123456`): algunos motores cortan a milisegundos y otros
 *      rechazan el parseo.
 *   3. Postgres puede mandar el offset abreviado (`+00` en vez de `+00:00`),
 *      que `Date` no parsea.
 *
 * `null` NUNCA se convierte en `new Date(null)` (que es epoch y por lo tanto
 * "vencida"): una fecha ausente es dato faltante, no una licencia de 1970.
 *
 * @param {unknown} valor ISO 8601 (string), `Date`, o nada
 * @returns {Date | null}
 */
export function parseIsoFecha(valor) {
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? null : valor;
  if (typeof valor !== 'string') return null;

  let texto = valor.trim();
  if (!texto) return null;

  // Solo fecha ('2026-10-15'): es UTC medianoche. Se resuelve antes de agregar
  // el 'Z' de abajo, porque '2026-10-15Z' no lo parsea ningún motor.
  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
    const soloFecha = new Date(`${texto}T00:00:00Z`);
    return Number.isNaN(soloFecha.getTime()) ? null : soloFecha;
  }

  // '2026-01-02 03:04:05' -> '2026-01-02T03:04:05'
  texto = texto.replace(' ', 'T');
  // Fracción de segundos a 3 dígitos como máximo.
  texto = texto.replace(/\.(\d{3})\d+/, '.$1');
  // Offset abreviado '+00' -> '+00:00'
  texto = texto.replace(/([+-]\d{2})$/, '$1:00');
  // Sin 'Z' ni offset: es UTC por convención de quien lo escribió.
  if (!/(Z|[+-]\d{2}:\d{2})$/i.test(texto)) texto = `${texto}Z`;

  const fecha = new Date(texto);
  return Number.isNaN(fecha.getTime()) ? null : fecha;
}

/**
 * Marca temporal de una fila, para ordenar cuál es la suscripción vigente.
 *
 * Se toma `fecha_inicio` (el momento del pago, lo que escribe el webhook y
 * CANYP). Si no estuviera, se cae a `created_at` — que solo llega si algún día
 * se proyecta esa columna — y por último a `fecha_expiracion`, que para dos
 * filas del mismo plan ordena igual de bien.
 *
 * @param {Record<string, any>} fila
 * @returns {number} epoch ms, o 0 si la fila no tiene ninguna fecha usable
 */
function marcaTemporal(fila) {
  for (const columna of ['fecha_inicio', 'created_at', 'fecha_expiracion']) {
    const fecha = parseIsoFecha(fila?.[columna]);
    if (fecha) return fecha.getTime();
  }
  return 0;
}

/**
 * De las filas que matchean `(client_id, app_id)`, la que manda: la más
 * reciente.
 *
 * Antes esta ruta usaba `.single()`, que es `.limit(1)` con la exigencia de que
 * haya exactamente UNA fila: con dos filas PostgREST responde `PGRST116` y el
 * endpoint devolvía 500. Un 500 acá no es un dato feo, es el cliente que no
 * puede ni operar. Con más de una fila (migraciones, app_ids viejos, filas
 * duplicadas a mano) la más reciente es la que representa la última compra, así
 * que se elige en vez de fallar.
 *
 * El orden se resuelve en JavaScript y no con `.order()` a propósito: pedirle
 * orden a una columna que no existe es un 400 de PostgREST, y la respuesta
 * correcta a "hay filas" no puede depender de adivinar el esquema.
 *
 * @param {Record<string, any>[] | null | undefined} filas
 * @returns {Record<string, any> | null}
 */
export function elegirSuscripcion(filas) {
  if (!Array.isArray(filas) || filas.length === 0) return null;
  let elegida = null;
  let mejorMarca = -Infinity;
  for (const fila of filas) {
    if (!fila || typeof fila !== 'object') continue;
    const marca = marcaTemporal(fila);
    // Empate (o filas sin fecha): gana la última, que es el orden en que
    // PostgREST devolvió el lote.
    if (elegida === null || marca >= mejorMarca) {
      elegida = fila;
      mejorMarca = marca;
    }
  }
  return elegida;
}

/**
 * ¿Esta fila habilita licencia AHORA?
 *
 * Mismo criterio que `estado_da_acceso` de CANYP: estado con acceso Y
 * `fecha_expiracion` válida y futura. Un estado desconocido, una fecha
 * ausente o ilegible y una fecha vencida dan `false` (fail-closed).
 *
 * @param {unknown} estado valor crudo de la columna `estado`
 * @param {Date | null} expira
 * @param {Date} ahora
 * @returns {boolean}
 */
export function estadoDaAcceso(estado, expira, ahora) {
  const canonico = normalizarEstado(estado);
  if (canonico === null || !ESTADOS_CON_ACCESO.includes(canonico)) return false;
  if (!expira) return false;
  return expira.getTime() > ahora.getTime();
}

/**
 * Días que quedan, redondeando hacia arriba, y nunca negativo.
 *
 * Hacia arriba porque un cliente con 6 horas de licencia tiene que ver "1 día",
 * no "0 días" (que se lee como "venció"). El piso en 0 evita el
 * "Suscripción activa (-3 días)" que producía la resta sin validar cuando la
 * fecha ya había pasado.
 *
 * @param {Date | null} expira
 * @param {Date} ahora
 * @returns {number}
 */
export function calcularDiasRestantes(expira, ahora) {
  if (!expira) return 0;
  const dias = Math.ceil((expira.getTime() - ahora.getTime()) / 86400000);
  return dias > 0 ? dias : 0;
}

/**
 * Respuesta de `/api/verificar` cuando no hay fila para `(client_id, app_id)`.
 *
 * Se mantiene idéntica a la de siempre a propósito: es el contrato que un
 * cliente nuevo recibe y con el que calcula su prueba.
 *
 * @returns {Record<string, unknown>}
 */
export function respuestaSinSuscripcion() {
  return {
    activo: false,
    estado: 'nuevo',
    mensaje: 'Usuario sin suscripción',
    dias_prueba: DIAS_PRUEBA,
  };
}

/**
 * Cuerpo de la respuesta de `/api/verificar` para una fila.
 *
 * El `estado` que vuelve es el CANÓNICO, no el crudo: si la fila quedó en
 * `activa` (webhook viejo) el cliente recibe `activo` y no un estado que
 * ningún consumidor del sistema reconoce. Si el estado es desconocido se
 * devuelve tal cual junto a `activo: false`, para que el que consulta pueda
 * ver qué hay en la fila en vez de un `null` inútil.
 *
 * @param {Record<string, any> | null} fila
 * @param {Date} [ahora]
 * @returns {Record<string, unknown>}
 */
export function construirRespuestaVerificacion(fila, ahora = new Date()) {
  if (!fila) return respuestaSinSuscripcion();

  const canonico = normalizarEstado(fila.estado);
  const expira = parseIsoFecha(fila.fecha_expiracion);
  const activo = estadoDaAcceso(fila.estado, expira, ahora);
  const diasRestantes = activo ? calcularDiasRestantes(expira, ahora) : 0;

  return {
    activo,
    estado: canonico ?? (fila.estado === undefined || fila.estado === null ? null : fila.estado),
    plan: fila.plan ?? null,
    fecha_expiracion: fila.fecha_expiracion ?? null,
    dias_restantes: diasRestantes,
    mensaje: activo
      ? `Suscripción activa (${diasRestantes} días)`
      : mensajeSinAcceso(canonico),
  };
}

/**
 * Mensaje para una fila que NO habilita licencia. Distingue los dos casos que
 * el cliente necesita distinguir: "se está pagando" de "no hay nada".
 *
 * @param {string | null} canonico
 * @returns {string}
 */
function mensajeSinAcceso(canonico) {
  if (canonico === ESTADOS.PENDIENTE) return 'Pago pendiente de aprobación';
  return 'Suscripción expirada';
}

/**
 * Configuración para LEER la licencia.
 *
 * A diferencia del webhook, acá la lectura tiene que ser con `service_role`:
 * `anon` no tiene política de SELECT sobre `suscripciones` y PostgREST no
 * avisa — devuelve `200` con `[]`. Medido contra el proyecto del operador:
 * 19 filas visibles con `service_role`, 0 con `anon`. O sea que con la clave
 * `anon` esta ruta respondía "Usuario sin suscripción" a TODO el mundo,
 * incluidos los clientes que pagaron. Un denial de RLS que parece "no hay
 * licencia" es el peor tipo de falla posible en un chequeo de licencia.
 *
 * La credencial NO se expone: se usa acá adentro, en el servidor, y la
 * respuesta pública sale de `construirRespuestaVerificacion`, que solo trae
 * campos del contrato (ni `email`, ni `mp_payment_id`, ni la clave).
 *
 * @param {Record<string, string | undefined>} env
 * @returns {{ok: true, supabaseUrl: string, supabaseServiceKey: string}
 *          | {ok: false, error: string, falta: string[]}}
 */
export function resolverConfigLectura(env) {
  const falta = [];
  const supabaseUrl = (env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
  const supabaseServiceKey = (env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY || '').trim();

  if (!supabaseUrl) falta.push('NEXT_PUBLIC_SUPABASE_URL');
  if (!supabaseServiceKey) falta.push('SUPABASE_SERVICE_ROLE_KEY');

  // `createClient` tira si la URL no es http(s). Se valida acá para que eso sea
  // un 503 con nombre de variable en vez de un 500 con stack trace en el log.
  if (supabaseUrl && !/^https?:\/\//i.test(supabaseUrl)) falta.push('NEXT_PUBLIC_SUPABASE_URL(no_http)');

  if (falta.length > 0) {
    return { ok: false, error: `config_incompleta:${falta.join(',')}`, falta };
  }
  return { ok: true, supabaseUrl, supabaseServiceKey };
}