import { MENSAJE_PENDIENTE, paginaRetorno } from '../../../lib/paginas-retorno';

/**
 * Retorno de pago PENDIENTE (transferencia, medio de pago que acredita después).
 *
 * Este archivo era HTML guardado con extensión `.ts` y rompía `next build`.
 *
 * Acá sí corresponde decir "pendiente": MercadoPago manda al usuario a esta URL
 * justamente cuando el pago todavía no se acreditó. Reintentar tiene sentido.
 */
export async function GET(): Promise<Response> {
  return new Response(
    paginaRetorno({
      tono: 'esperando',
      mensaje: MENSAJE_PENDIENTE,
      accion: { texto: 'Volver a la app', href: null },
    }),
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}
