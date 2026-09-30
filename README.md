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

### Qué hace falta para testearlo en serio

Este repo no tiene infra de tests. La recomendación es agregar **vitest**:
`lib/mp-contract.mjs` ya es puro y sin dependencias (se importa directo en un
test sin mocks), y la ruta se puede testear con `fetch` y el cliente de Supabase
mockeados — que es exactamente lo que se hizo con un script temporal durante el
arranque de esta cadena. No se agregó vitest en este cambio para no meter
dependencias nuevas sin acuerdo.

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
