/**
 * Páginas de retorno de MercadoPago (success / failure / pending).
 *
 * Antes cada una de esas rutas era un archivo HTML guardado con extensión `.ts`.
 * Eso rompía `next build` entero — webpack los parseaba como TypeScript y moría
 * en el `<` de `<!DOCTYPE html>`. Como el build fallaba, NADA de este proyecto
 * se podía desplegar: tampoco el webhook que activa las licencias.
 *
 * Ahora son route handlers de verdad, y el HTML se arma acá en un solo lugar.
 *
 * Sobre la redirección: el destino NO va hardcodeado a `localhost:5173`. Eso
 * funcionaba en la máquina del dueño y en producción mandaba al usuario a un
 * localhost inexistente, o sea que tras pagar no pasaba nada. Sale de
 * `NEXT_PUBLIC_APP_URL`; si no está configurado, la página lo dice y no redirige
 * a la nada.
 */

/** Tono visual de cada estado. Sin íconos ni ids interpolados: todo es estático. */
export type Tono = 'ok' | 'esperando' | 'error';

const TONOS: Record<Tono, { fondo: string; color: string; titulo: string }> = {
  ok: { fondo: '#166534', color: '#dcfce7', titulo: 'Pago confirmado' },
  esperando: { fondo: '#854d0e', color: '#fef3c7', titulo: 'Pago pendiente' },
  error: { fondo: '#991b1b', color: '#fee2e2', titulo: 'No se pudo completar el pago' },
};

/**
 * Destino al que volver a la app, o null si no está configurado.
 *
 * `APP_URL` es una URL pública de la app, no un endpoint con secretos: por eso
 * puede ser `NEXT_PUBLIC_*` sin problema.
 */
export function destinoApp(): string | null {
  const crudo = process.env.NEXT_PUBLIC_APP_URL;
  if (!crudo) return null;
  try {
    // Se valida que sea http(s) de verdad: un valor mal pegado en el entorno no
    // debe terminar en el `href` de una redirección automática.
    const url = new URL(crudo);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * Arma la página de retorno.
 *
 * `redireccion` a null = la página se queda mostrando el estado y da un link
 * manual. Es preferible a redirigir a un destino roto.
 */
export function paginaRetorno(opts: {
  tono: Tono;
  mensaje: string;
  /** texto del botón; si viene null, no se renderiza botón */
  accion?: { texto: string; href: string | null } | null;
}): string {
  const { fondo, color, titulo } = TONOS[opts.tono];
  const destino = destinoApp();
  const href = opts.accion?.href ?? destino;

  const boton = href
    ? `<a class="btn" href="${escapar(href)}">${escapar(opts.accion?.texto ?? 'Volver a la app')}</a>`
    : `<p class="warn">No se pudo determinar la dirección de la app. Volvé a abrirla.</p>`;

  // La redirección automática solo tiene sentido si hay destino. Antes iba fija a
  // localhost, así que en producción el usuario pagaba y se quedaba en una
  // pantalla de redirección eternamente rota.
  const auto = destino
    ? `<script>window.location.replace(${JSON.stringify(destino)});</script>`
    : '';

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapar(titulo)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1f2937 0%, #111827 100%);
      min-height: 100vh; display: flex; align-items: center; justify-content: center;
      padding: 20px; color: #111827;
    }
    .container {
      background: #fff; border-radius: 24px; padding: 48px; max-width: 500px;
      text-align: center; box-shadow: 0 25px 50px -12px rgba(0,0,0,.25);
      border-top: 8px solid ${fondo};
    }
    h1 { color: ${fondo}; font-size: 26px; margin-bottom: 12px; }
    .subtitle { color: #6b7280; font-size: 16px; margin-bottom: 28px; line-height: 1.5; }
    .btn {
      display: inline-block; background: ${fondo}; color: ${color};
      padding: 14px 30px; border-radius: 12px; font-size: 16px; font-weight: 600;
      text-decoration: none;
    }
    .warn { color: #6b7280; font-size: 14px; }
  </style>
  ${auto}
</head>
<body>
  <div class="container">
    <h1>${escapar(titulo)}</h1>
    <p class="subtitle">${escapar(opts.mensaje)}</p>
    ${boton}
  </div>
</body>
</html>`;
}

/** Escapa lo que se interpola en el HTML. Ningún valor de entrada llega crudo. */
function escapar(valor: string): string {
  return valor
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * NO dice que la licencia está activa.
 *
 * Volver de MercadoPago no es verificar el cobro: el pago puede seguir
 * `pending` en ese momento, y el que activa la licencia es el webhook (o
 * `/confirmar-pago`). Prometer "ya activaste tu licencia" acá era exactamente
 * la razón por la que un usuario veía "listo" y después no tenía acceso.
 */
export const MENSAJE_PENDIENTE =
  'Estamos esperando la confirmación del pago. Tu licencia se activa en cuanto el pago se acredita: puede tardar unos instantes.';
