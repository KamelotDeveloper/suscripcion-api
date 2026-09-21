# API de Suscripción - GA Software

API para manejar suscripciones, pruebas gratis y códigos de descuento.

## Archivos

- `/api/verificar` - Verifica si el usuario tiene suscripción activa
- `/api/iniciar-prueba` - Inicia prueba gratis de 7 días
- `/api/codigo-descuento` - Valida códigos de descuento
- `/api/webhook` - Recibe notificaciones de MercadoPago

## Variables de Entorno

En **Vercel** agregar:
- `NEXT_PUBLIC_SUPABASE_URL` = `https://nrysusllouuytjlwdyvn.supabase.co`
- `NEXT_PUBLIC_SUPABASE_KEY` = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5yeXN1c2xsb3V1eXRqbHdkeXZuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5NDU2NTYsImV4cCI6MjA5MzUyMTY1Nn0.C_hYiLkCmXZDpPb1VoUaJiUd00S1nE25RTFsz2KJHII`
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
