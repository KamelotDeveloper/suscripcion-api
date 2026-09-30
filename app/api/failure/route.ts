import { paginaRetorno } from '../../../lib/paginas-retorno';

/**
 * Retorno de pago RECHAZADO / fallido.
 *
 * Este archivo era HTML guardado con extensión `.ts` y rompía `next build`.
 *
 * Distingue "tu pago falló" de "no pudimos cobrarte". MercadoPago manda acá
 * cuando el pago se rechazó; si el dinero no llegó a moverse, la licencia
 * sigue igual y se puede reintentar sin perder nada.
 */
export async function GET(): Promise<Response> {
  return new Response(
    paginaRetorno({
      tono: 'error',
      mensaje:
        'El pago no se completó, así que no se cobró nada. Podés intentar de nuevo desde la app.',
      accion: { texto: 'Volver a la app', href: null },
    }),
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}
