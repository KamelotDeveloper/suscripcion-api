import { MENSAJE_PENDIENTE, paginaRetorno } from '../../../lib/paginas-retorno';

/**
 * Retorno de pago APROBADO por MercadoPago.
 *
 * Este archivo era HTML guardado con extensión `.ts` y rompía `next build`.
 *
 * Ojo con lo que NO hace: no activa la licencia. Que el comprador vuelva a esta
 * página significa que Checkout Pro lo aceptó, no que el pago esté acreditado ni
 * que la fila se haya actualizado. La activación la hace `/api/webhook`.
 *
 * Si el webhook no llega, el respaldo no está en este proyecto: es
 * `/api/suscripcion/confirmar-pago` del sidecar de CANYP.
 */
export async function GET(): Promise<Response> {
  return new Response(
    paginaRetorno({
      tono: 'ok',
      mensaje: MENSAJE_PENDIENTE,
      accion: { texto: 'Volver a la app', href: null },
    }),
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );
}
