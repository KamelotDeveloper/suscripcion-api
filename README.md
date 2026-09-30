# API de Suscripción - El Menestral ERP / CANYP

API para manejar suscripciones, pruebas gratis y códigos de descuento.

## Archivos

- `/api/verificar` - Verifica si el usuario tiene suscripción activa
- `/api/iniciar-prueba` - Inicia prueba gratis de 7 días
- `/api/codigo-descuento` - Valida códigos de descuento
- `/api/webhook` - Recibe notificaciones de MercadoPago y **activa la licencia**
- `lib/mp-contract.mjs` - Contrato puro compartido con CANYP (planes, decodificación
  de `external_reference`, verificación del pago, idempotencia). Sin
  dependencias: se importa tanto desde la ruta como desde un test.

## Variables de Entorno

Ver `.env.example` para la lista con descripción. **Los valores van en el
entorno de despliegue (Vercel), nunca en el repo.** Resumen:

| Variable | Para qué | Sin ella |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Proyecto de Supabase del operador | 503, no activa |
| `SUPABASE_SERVICE_ROLE_KEY` | Escritura en `suscripciones` (RLS la deniega con `anon`) | 503, no activa |
| `MP_ACCESS_TOKEN` | Verificar el cobro contra la API de MercadoPago | 503, no activa |
| `NEXT_PUBLIC_SUPABASE_KEY` | Solo lectura en los otros handlers | — |
| `MP_WEBHOOK_SECRET` | (opcional) Validar el header `x-signature` | — |
| `NEXT_PUBLIC_APP_URL` | A dónde manda al usuario la página de retorno (`/api/success`) | La página no redirige, muestra el estado y avisa |

> `NEXT_PUBLIC_APP_URL` NO puede hardcodearse: antes `/api/success` apuntaba fijo a
> `http://localhost:5173`, que funcionaba en la máquina del dueño y en producción
> mandaba al usuario a un localhost inexistente. O sea: pagaba y no pasaba nada.

El webhook **no tiene valores por defecto**: sin esas variables responde 503 a
propósito, para que MercadoPago reintente y el fallo quede en el log, en vez de
responder 200 y tragarse el error.

> `NEXT_PUBLIC_SUPABASE_URL` debe apuntar al **mismo** proyecto de Supabase que
> lee el backend de CANYP. Si difieren, el pago se registra donde nadie lo mira
> y la licencia nunca se activa: la plata entra y no pasa nada.

## Deploy a Vercel

1. Subir este proyecto a GitHub
2. Importar en Vercel
3. Agregar las variables de entorno en Settings (solo nombres + valores reales)
4. Deploy automático

## Webhook de MercadoPago

URL: `https://tu-proyecto.vercel.app/api/webhook` — Evento: `payment`

La notificación de MercadoPago para el topic `payment` trae **solo** `data.id`.
No trae `external_reference`, ni `status`, ni `metadata`, ni `plan`. Por eso el
webhook consulta `GET /v1/payments/{id}` y decide sobre esa respuesta, que es la
única fuente confiable.

### Contrato de `external_reference`

| Formato | app_id | client_id |
| --- | --- | --- |
| `canyp:<client_id>` | `canyp` | el sufijo |
| `ERP-<...>` | `erp` (legacy) | el sufijo |

Un formato que no matchea ninguno de los dos es un **error** (400), no un caso
silenciosamente ignorado: se responde no-2xx para que MercadoPago reintente y
quede registrado.

### Planes

`lib/mp-contract.mjs` (`PLANES`) debe coincidir con `PLANES_FALLBACK["canyp"]`
de `canyp/backend/pricing.py`. Si divergen, el webhook rechaza pagos legítimos o
acepta pagos de un plan que no se compró. El plan se resuelve por
`metadata.plan` de la preferencia y, si eso no está, por el monto cobrado. **Si
no se puede resolver, se rechaza: nunca cae en "1 mes" por defecto.**

### Columnas que escribe

`client_id`, `app_id`, `plan`, `estado` (`activo`, el vocabulario canónico de
`canyp/backend/subscription_status.py`), `fecha_inicio`, `fecha_expiracion`,
`mp_payment_id`, `preference_id`, `mp_response`.

CANYP filtra por `client_id AND app_id` y busca por `mp_payment_id`, así que
`app_id` no es opcional y el nombre de la columna del pago es `mp_payment_id`.

### Idempotencia

Si la fila ya está `activo` con ese mismo `mp_payment_id`, se responde 200
**sin recalcular `fecha_expiracion`**. MercadoPago reintenta hasta recibir un
2xx, así que sin este freno cada reentrega regalaría días de licencia.

### Tests

`pnpm test` corre `tests/*.test.ts` con el runner de Node (`node --test`). No hay
vitest ni jest: no se agregaron dependencias en este cambio, y para las rutas de
retorno el runner nativo alcanza.

La lógica de decisión del webhook (`lib/mp-contract.mjs`) sigue sin ejercitarse
desde un test, y esa es la deuda real que queda. Es pura y sin dependencias, así
que cuando se decida agregar vitest se importa directo en un test sin mocks; la
ruta se puede cubrir con `fetch` y el cliente de Supabase mockeados — que es lo
que se verificó con un script temporal durante el arranque de esta cadena.

## Bug que destapó el build

`app/api/{success,failure,pending}/route.ts` eran archivos HTML guardados con
extensión `.ts`. Webpack los parseaba como TypeScript y `next build` fallaba con
`Unexpected token '<'`. **El proyecto no era desplegable**, así que tampoco se
podía desplegar el webhook corregido: la plata entraba y la licencia no se
activaba, y no había forma de subir el arreglo.

Ahora son route handlers de verdad y el HTML se arma en `lib/paginas-retorno.ts`.
`tests/paginas-retorno.test.ts` mira exactamente la condición que se rompió
(que esos archivos sean TypeScript parseable), así que el corte no vuelve.

`pnpm lint` sigue sin poder correr: el repo no tiene configuración de ESLint y
`next lint` entra en modo interactivo. Es una deuda previa, no de este cambio.

## Uso desde la App

```javascript
// Verificar suscripción
const res = await fetch('https://tu-proyecto.vercel.app/api/verificar', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ client_id: 'abc123' })
});

// Iniciar prueba gratis
const res = await fetch('https://tu-proyecto.vercel.app/api/iniciar-prueba', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ client_id: 'abc123', email: 'cliente@email.com' })
});

// Validar código de descuento
const res = await fetch('https://tu-proyecto.vercel.app/api/codigo-descuento', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ codigo: 'BIENVENIDO20' })
});
```
