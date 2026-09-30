/**
 * Contrato de `/api/verificar` (el que consulta la licencia).
 *
 * La ruta sola no se puede ejercitar sin Supabase, así que la decisión vive en
 * `lib/mp-contract.mjs` (puro) y estos tests la cubren directamente; los últimos
 * son guardas sobre el archivo de la ruta, como los de `paginas-retorno.test.ts`.
 *
 * Qué se está protecting acá:
 *
 *  - `elegirSuscripcion`: más de una fila para `(client_id, app_id)` se resuelve
 *    eligiendo la más reciente. Antes la ruta usaba `.single()`, que con dos
 *    filas devolvía `PGRST116` → 500.
 *  - `estadoDaAcceso`: la fecha de expiración es obligatoria para TODO estado con
 *    acceso. Antes `estado === 'prueba'` daba acceso infinito a filas sin fecha,
 *    y en la tabla del operador 15 de 19 filas están así.
 *  - `respuestaSinSuscripcion`: el contrato de "usuario nuevo" no cambia.
 *  - Guardas de la ruta: filtra por `app_id` y `client_id`, no usa la clave
 *    `anon` para leer, no proyecta `*`, no usa `.single()` y sigue con CORS.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it } from 'node:test';

import {
  DIAS_PRUEBA,
  calcularDiasRestantes,
  construirRespuestaVerificacion,
  elegirSuscripcion,
  estadoDaAcceso,
  normalizarEstado,
  parseIsoFecha,
  resolverConfigLectura,
  respuestaSinSuscripcion,
} from '../lib/mp-contract.mjs';

const RAIZ = process.cwd();
const RUTA = 'app/api/verificar/route.ts';
const AHORA = new Date('2026-09-30T12:00:00.000Z');

function enDias(dias: number): Date {
  return new Date(AHORA.getTime() + dias * 86400000);
}

function fuenteRuta(): string {
  return readFileSync(join(RAIZ, RUTA), 'utf8');
}

/**
 * La ruta SIN comentarios.
 *
 * Las guardas de abajo buscan cosas que este archivo menciona a propósito en la
 * documentación de lo que estaba roto (`NEXT_PUBLIC_SUPABASE_KEY`, `.single()`,
 * `select('*')`): si no se limpian los comentarios, la guarda pasa por la prosa y
 * no verifica nada.
 */
function codigoRuta(): string {
  return fuenteRuta()
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((linea) => linea.replace(/\/\/.*$/, ''))
    .join('\n');
}

describe('normalizarEstado', () => {
  it('acepta los estados canónicos sin importar mayúsculas ni espacios', () => {
    assert.equal(normalizarEstado('activo'), 'activo');
    assert.equal(normalizarEstado('  ACTIVO '), 'activo');
    assert.equal(normalizarEstado('Prueba'), 'prueba');
    assert.equal(normalizarEstado('pendiente'), 'pendiente');
    assert.equal(normalizarEstado('expirado'), 'expirado');
  });

  it('normaliza los sinónimos que escribió el webhook viejo', () => {
    // Si no, un cliente que pagó con el webhook anterior queda sin licencia.
    assert.equal(normalizarEstado('activa'), 'activo');
    assert.equal(normalizarEstado('ACTIVE'), 'activo');
  });

  it('no adivina un estado desconocido', () => {
    assert.equal(normalizarEstado('activo_php'), null);
    assert.equal(normalizarEstado(''), null);
    assert.equal(normalizarEstado(null), null);
    assert.equal(normalizarEstado(undefined), null);
  });
});

describe('parseIsoFecha', () => {
  it('lee los dos formatos que escriben el webhook y CANYP', () => {
    // El webhook escribe `toISOString()` (con Z); CANYP escribe
    // `datetime.utcnow().isoformat()` (sin offset, pero en UTC).
    assert.equal(
      parseIsoFecha('2026-10-30T12:00:00.000Z')?.toISOString(),
      '2026-10-30T12:00:00.000Z'
    );
    assert.equal(parseIsoFecha('2026-10-30T12:00:00.123456')?.toISOString(), '2026-10-30T12:00:00.123Z');
  });

  it('tolera el separador de espacio y el offset abreviado de Postgres', () => {
    assert.equal(
      parseIsoFecha('2026-10-30 12:00:00+00')?.toISOString(),
      '2026-10-30T12:00:00.000Z'
    );
  });

  it('trata una fecha sin hora como UTC medianoche', () => {
    // Una columna `date` (no `timestamptz`) devuelve solo el día.
    assert.equal(parseIsoFecha('2026-10-30')?.toISOString(), '2026-10-30T00:00:00.000Z');
  });

  it('devuelve null en vez de una fecha inventada', () => {
    // `new Date(null)` es epoch: una fila sin fecha NO es una licencia de 1970.
    assert.equal(parseIsoFecha(null), null);
    assert.equal(parseIsoFecha(undefined), null);
    assert.equal(parseIsoFecha(''), null);
    assert.equal(parseIsoFecha('   '), null);
    assert.equal(parseIsoFecha('basura'), null);
    assert.equal(parseIsoFecha(12345), null);
    assert.equal(parseIsoFecha(new Date('nope')), null);
  });
});

describe('elegirSuscripcion', () => {
  const base = { client_id: 'c1', app_id: 'canyp', estado: 'activo', plan: 'canyp_1_mes' };

  it('devuelve null cuando no hay filas', () => {
    assert.equal(elegirSuscripcion([]), null);
    assert.equal(elegirSuscripcion(null), null);
    assert.equal(elegirSuscripcion(undefined), null);
  });

  it('con una sola fila devuelve esa fila', () => {
    const fila = { ...base, fecha_inicio: '2026-01-01T00:00:00Z' };
    assert.equal(elegirSuscripcion([fila]), fila);
  });

  it('con varias filas gana la más reciente por fecha_inicio', () => {
    // Este es el caso que antes era un 500 (PGRST116) en `.single()`.
    const vieja = { ...base, fecha_inicio: '2025-01-01T00:00:00Z', plan: 'canyp_1_mes' };
    const nueva = { ...base, fecha_inicio: '2026-08-01T00:00:00Z', plan: 'canyp_1_anio' };
    assert.equal(elegirSuscripcion([vieja, nueva]), nueva);
    assert.equal(elegirSuscripcion([nueva, vieja]), nueva);
  });

  it('sin fecha_inicio ordena por created_at y, si tampoco hay, por fecha_expiracion', () => {
    const a = { ...base, created_at: '2026-02-01T00:00:00Z' };
    const b = { ...base, created_at: '2026-07-01T00:00:00Z' };
    assert.equal(elegirSuscripcion([a, b]), b);

    const c = { ...base, fecha_expiracion: '2026-10-01T00:00:00Z' };
    const d = { ...base, fecha_expiracion: '2027-10-01T00:00:00Z' };
    assert.equal(elegirSuscripcion([c, d]), d);
  });

  it('no se rompe con filas sin ninguna fecha', () => {
    const sinFecha = { ...base };
    assert.equal(elegirSuscripcion([sinFecha, { ...base }])?.plan, 'canyp_1_mes');
  });
});

describe('estadoDaAcceso', () => {
  it('da acceso con estado con acceso y fecha futura', () => {
    assert.equal(estadoDaAcceso('activo', enDias(10), AHORA), true);
    assert.equal(estadoDaAcceso('prueba', enDias(10), AHORA), true);
  });

  it('no da acceso con fecha vencida', () => {
    assert.equal(estadoDaAcceso('activo', enDias(-1), AHORA), false);
    assert.equal(estadoDaAcceso('prueba', enDias(-1), AHORA), false);
  });

  it('no da acceso sin fecha válida: antes `prueba` daba acceso infinito', () => {
    assert.equal(estadoDaAcceso('prueba', null, AHORA), false);
    assert.equal(estadoDaAcceso('activo', null, AHORA), false);
  });

  it('no da acceso con pendiente, expirado ni estados desconocidos', () => {
    assert.equal(estadoDaAcceso('pendiente', enDias(10), AHORA), false);
    assert.equal(estadoDaAcceso('expirado', enDias(10), AHORA), false);
    assert.equal(estadoDaAcceso('algo_nuevo', enDias(10), AHORA), false);
  });

  it('da acceso al sinónimo heredado mientras la fecha siga viva', () => {
    assert.equal(estadoDaAcceso('activa', enDias(10), AHORA), true);
  });
});

describe('calcularDiasRestantes', () => {
  it('redondea hacia arriba para no prometer "0 días" con licencia viva', () => {
    assert.equal(calcularDiasRestantes(enDias(6), AHORA), 6);
    assert.equal(calcularDiasRestantes(new Date(AHORA.getTime() + 6 * 3600000), AHORA), 1);
  });

  it('nunca es negativo (antes salía "Suscripción activa (-3 días)")', () => {
    assert.equal(calcularDiasRestantes(enDias(-3), AHORA), 0);
    assert.equal(calcularDiasRestantes(null, AHORA), 0);
  });
});

describe('respuestaSinSuscripcion', () => {
  it('mantiene el contrato de usuario nuevo', () => {
    assert.deepEqual(respuestaSinSuscripcion(), {
      activo: false,
      estado: 'nuevo',
      mensaje: 'Usuario sin suscripción',
      dias_prueba: DIAS_PRUEBA,
    });
  });
});

describe('construirRespuestaVerificacion', () => {
  it('devuelve el contrato exacto, con y sin acceso', () => {
    const activa = construirRespuestaVerificacion(
      {
        estado: 'activo',
        plan: 'canyp_6_meses',
        fecha_expiracion: '2026-10-15T12:00:00Z',
      },
      AHORA
    );
    assert.deepEqual(activa, {
      activo: true,
      estado: 'activo',
      plan: 'canyp_6_meses',
      fecha_expiracion: '2026-10-15T12:00:00Z',
      dias_restantes: 15,
      mensaje: 'Suscripción activa (15 días)',
    });

    const vencida = construirRespuestaVerificacion(
      {
        estado: 'activo',
        plan: 'canyp_1_mes',
        fecha_expiracion: '2026-09-01T12:00:00Z',
      },
      AHORA
    );
    assert.equal(vencida.activo, false);
    assert.equal(vencida.dias_restantes, 0);
    assert.equal(vencida.mensaje, 'Suscripción expirada');
  });

  it('distingue "pago pendiente" de "expirada"', () => {
    const pendiente = construirRespuestaVerificacion(
      { estado: 'pendiente', plan: 'canyp_1_mes', fecha_expiracion: '2026-10-15T12:00:00Z' },
      AHORA
    );
    assert.equal(pendiente.activo, false);
    assert.equal(pendiente.mensaje, 'Pago pendiente de aprobación');
  });

  it('devuelve el estado canónico, no el sinónimo de la fila', () => {
    const r = construirRespuestaVerificacion(
      { estado: 'activa', plan: 'canyp_1_mes', fecha_expiracion: '2026-10-15T12:00:00Z' },
      AHORA
    );
    assert.equal(r.estado, 'activo');
    assert.equal(r.activo, true);
  });

  it('sin fila devuelve el contrato de usuario nuevo', () => {
    assert.deepEqual(construirRespuestaVerificacion(null, AHORA), respuestaSinSuscripcion());
  });

  it('una fila de prueba sin fecha NO da acceso', () => {
    const r = construirRespuestaVerificacion({ estado: 'prueba', plan: 'prueba' }, AHORA);
    assert.equal(r.activo, false);
    assert.equal(r.dias_restantes, 0);
    assert.equal(r.fecha_expiracion, null);
  });
});

describe('resolverConfigLectura', () => {
  it('exige la service role: con anon la lectura devuelve [] y parece "sin licencia"', () => {
    const r = resolverConfigLectura({
      NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co',
      NEXT_PUBLIC_SUPABASE_KEY: 'anon',
    });
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.falta.includes('SUPABASE_SERVICE_ROLE_KEY'));
  });

  it('acepta la configuración completa', () => {
    const r = resolverConfigLectura({
      NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service',
    });
    assert.equal(r.ok, true);
    assert.ok(r.ok && r.supabaseServiceKey === 'service');
  });

  it('rechaza una URL que no sea http(s) antes de que reviente createClient', () => {
    const r = resolverConfigLectura({
      NEXT_PUBLIC_SUPABASE_URL: 'localhost:5432/postgres',
      SUPABASE_SERVICE_ROLE_KEY: 'service',
    });
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.error.includes('NEXT_PUBLIC_SUPABASE_URL'));
  });
});

describe(`guardas de ${RUTA}`, () => {
  it('filtra por client_id Y app_id', () => {
    const src = codigoRuta();
    assert.match(src, /\.match\(\{\s*client_id:/, 'no filtra por (client_id, app_id)');
    assert.match(src, /app_id:/, 'no filtra por app_id');
  });

  it('no usa .single(): con varias filas devolvía PGRST116 y 500', () => {
    assert.ok(!codigoRuta().includes('.single()'), 'verificar usa .single()');
  });

  it('no lee con la clave anon', () => {
    assert.ok(
      !codigoRuta().includes('NEXT_PUBLIC_SUPABASE_KEY'),
      'verificar lee con la clave anon: RLS no tiene SELECT y devuelve []',
    );
  });

  it('no proyecta la fila entera: el endpoint es público y publicaría email/mp_payment_id', () => {
    assert.ok(
      !/\.select\(\s*['"]\*['"]/.test(codigoRuta()),
      'verificar proyecta la fila entera',
    );
  });

  it('exige app_id y client_id en el body', () => {
    const src = codigoRuta();
    assert.match(src, /app_id/, 'no lee app_id del body');
    assert.match(src, /client_id/, 'no lee client_id del body');
    assert.match(src, /status: 400/, 'no responde 400 por body inválido');
  });

  it('no confunde un error de lectura con "usuario sin suscripción"', () => {
    const src = codigoRuta();
    assert.match(src, /status: 502/, 'no falla explícito ante error de lectura');
    assert.match(src, /status: 503/, 'no falla cerrado si falta configuración');
  });

  it('mantiene CORS y el handler de preflight', () => {
    const src = codigoRuta();
    assert.match(src, /Access-Control-Allow-Origin/);
    assert.match(src, /export async function OPTIONS/);
  });

  it('la credencial de privilegio no se devuelve en la respuesta', () => {
    // `cfg` se usa solo para armar el cliente de servidor. La respuesta sale del
    // contrato de `construirRespuestaVerificacion`.
    const src = codigoRuta();
    assert.ok(
      !/Response\.json\(\s*cfg\b/.test(src),
      'responde con el objeto de configuración (trae la service role)',
    );
    assert.ok(
      !/Response\.json\([^)]*cfg\.supabase/.test(src),
      'responde con la credencial de Supabase',
    );
    const usos = src.match(/cfg\.supabaseServiceKey/g) ?? [];
    assert.equal(usos.length, 1, 'la service role se usa más de una vez: revisá la respuesta');
  });
});
