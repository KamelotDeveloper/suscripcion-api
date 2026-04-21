# API de Suscripción - El Menestral ERP

API para manejar suscripciones, pruebas gratis y códigos de descuento.

## Archivos

- `/api/verificar` - Verifica si el usuario tiene suscripción activa
- `/api/iniciar-prueba` - Inicia prueba gratis de 7 días
- `/api/codigo-descuento` - Valida códigos de descuento
- `/api/webhook` - Recibe notificaciones de MercadoPago

## Variables de Entorno

En **Vercel** agregar:
- `NEXT_PUBLIC_SUPABASE_URL` = `https://mucitlqroneaegmwvdup.supabase.co`
- `NEXT_PUBLIC_SUPABASE_KEY` = `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im11Y2l0bHFyb25lYWVnbXd2ZHVwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3NjY5OTgsImV4cCI6MjA5MjM0Mjk5OH0.8Ne39FOS8Wk3vsrdCIzs5B3aogg7W5U258Ir4wg6IHc`
- `MP_ACCESS_TOKEN` = Tu token de MercadoPago

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
