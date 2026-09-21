# API de Suscripción - GA Software

API para manejar suscripciones, pruebas gratis y códigos de descuento.

## Archivos

- `/api/verificar` - Verifica si el usuario tiene suscripción activa
- `/api/iniciar-prueba` - Inicia prueba gratis de 7 días
- `/api/codigo-descuento` - Valida códigos de descuento
- `/api/webhook` - Recibe notificaciones de MercadoPago

## Variables de Entorno

En **Vercel** agregar (todas server-only, sin prefijo `NEXT_PUBLIC_`):
- `NEXT_PUBLIC_SUPABASE_URL` = `https://nrysusllouuytjlwdyvn.supabase.co` (URL de API, no del dashboard)
- `SUPABASE_ANON_KEY` = Supabase anon key (server-only)
- `SUPABASE_SERVICE_KEY` = Service role key (Secret, server-only — NO prefix `NEXT_PUBLIC_`)
- `MP_ACCESS_TOKEN` = Tu token de MercadoPago (Secret, server-only)

## Deploy a Vercel

1. Subir este proyecto a GitHub
2. Importar en Vercel
3. Agregar las variables de entorno en Settings
4. Deploy automático

## Webhook de MercadoPago

URL: `https://tu-proyecto.vercel.app/api/webhook`

Eventos: `payment`

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
