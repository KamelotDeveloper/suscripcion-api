/**
 * Guarda de las rutas de retorno de MercadoPago.
 *
 * Los tres archivos `app/api/{success,failure,pending}/route.ts` eran HTML crudo
 * guardado con extensión `.ts`. Webpack los parseaba como TypeScript y `next
 * build` fallaba con "Unexpected token '<'". Como el build no pasaba, este
 * proyecto entero era indesplegable — incluido el webhook que activa las
 * licencias.
 *
 * Estos tests no miran el HTML: miran que los archivos sean TypeScript
 * parseable. Es exactamente la condición que se rompió, así que alcanza para que
 * el corte no vuelva.
 *
 * Se usa `node:test` y no vitest a propósito: este proyecto no tiene runner de
 * tests y no se van a agregar dependencias por esto. `node --test` ya viene en
 * Node. Cuando se decida poner vitest, esto se migra tal cual.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it } from 'node:test';

const RUTAS = ['success', 'failure', 'pending'];
const RAIZ = process.cwd();

function fuente(relativa: string): string {
  return readFileSync(join(RAIZ, relativa), 'utf8');
}

describe('rutas de retorno de MercadoPago', () => {
  for (const ruta of RUTAS) {
    it(`${ruta}/route.ts no es HTML disfrazado de TypeScript`, () => {
      const src = fuente(`app/api/${ruta}/route.ts`);
      assert.ok(
        !src.trimStart().startsWith('<'),
        `${ruta}/route.ts arranca con '<': es HTML guardado como .ts y rompe next build`,
      );
      assert.ok(!/<!DOCTYPE html>/i.test(src), `${ruta}/route.ts contiene HTML crudo`);
    });

    it(`${ruta}/route.ts exporta un handler GET`, () => {
      const src = fuente(`app/api/${ruta}/route.ts`);
      assert.match(src, /export\s+async\s+function\s+GET/);
    });

    it(`${ruta}/route.ts usa el builder compartido`, () => {
      const src = fuente(`app/api/${ruta}/route.ts`);
      assert.ok(src.includes('paginaRetorno'), `${ruta}/route.ts no usa paginaRetorno`);
      assert.ok(
        src.includes('lib/paginas-retorno'),
        `${ruta}/route.ts debería sacar el HTML de lib/paginas-retorno`,
      );
    });
  }

  it('ninguna ruta hardcodea un destino de redirección', () => {
    // `localhost:5173` funcionaba en la máquina del dueño y en producción mandaba
    // al usuario a un localhost inexistente: pagaba y no pasaba nada.
    for (const ruta of RUTAS) {
      assert.ok(
        !fuente(`app/api/${ruta}/route.ts`).includes('localhost'),
        `${ruta}/route.ts tiene un destino de redirección hardcodeado`,
      );
    }
  });

  it('la página de retorno no promete que la licencia ya está activa', () => {
    const src = fuente('lib/paginas-retorno.ts');
    // Volver de MercadoPago no verifica el cobro. Prometerlo acá fue parte de
    // por qué un usuario veía "listo" y después no tenía acceso.
    assert.ok(!/licencia (ya )?activa/i.test(src), 'la página promete activación');
  });

  it('el destino de la app sale del entorno y se valida como http(s)', () => {
    const src = fuente('lib/paginas-retorno.ts');
    assert.ok(src.includes('NEXT_PUBLIC_APP_URL'), 'el destino no sale del entorno');
    assert.ok(src.includes("protocol === 'http:'"), 'no valida el protocolo del destino');
  });
});
