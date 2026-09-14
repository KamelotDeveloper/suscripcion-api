import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://mucitlqroneaegmwvdup.supabase.co',
  process.env.NEXT_PUBLIC_SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im11Y2l0bHFyb25lYWVnbXd2ZHVwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3NjY5OTgsImV4cCI6MjA5MjM0Mjk5OH0.8Ne39FOS8Wk3vsrdCIzs5B3aogg7W5U258Ir4wg6IHc'
);

// Helper para agregar meses (fecha fija - mismo día del mes)
function addMonths(date, months) {
  const result = new Date(date);
  result.setMonth(result.getMonth() + months);
  return result;
}

// Calcular fecha de expiración según plan (fecha fija)
function calcularFechaExpiracion(fechaPago, plan) {
  const fecha = new Date(fechaPago);
  
  switch (plan) {
    case '1_mes':
      return addMonths(fecha, 1);
    case '6_meses':
      return addMonths(fecha, 6);
    case '1_anio':
      return addMonths(fecha, 12);
    default:
      // Por defecto 1 mes
      return addMonths(fecha, 1);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    console.log('Webhook recibido:', JSON.stringify(body, null, 2));

    // MercadoPago envía los datos del pago en topic/action o type
    const topic = body.topic || body.type || '';
    const status = body.status || body.data?.status;

    // Buscar la preferencia en los metadatos
    const paymentId = body.payment_id || body.id || body.data?.id;

    console.log('Payment ID:', paymentId, 'Status:', status, 'Topic:', topic);

    if (topic !== 'payment' || status !== 'approved' || !paymentId) {
      return Response.json({ received: true });
    }

    // external_reference trae `${app_id}:${client_id}` (sin ':' en los valores)
    const externalRef = body.external_reference;

    let appId = 'ordo';
    let clientId: string | undefined;

    if (externalRef && typeof externalRef === 'string') {
      const separator = externalRef.indexOf(':');
      if (separator !== -1) {
        appId = externalRef.slice(0, separator) || 'ordo';
        clientId = externalRef.slice(separator + 1);
      } else {
        // Back-compat: ERP-<uuid> de preferencias viejas o client_id pelado
        clientId = externalRef.replace(/^ERP-/, '');
      }
    } else {
      // Si no hay external_reference, fallback al comportamiento actual con app_id 'ordo'
      clientId = body.metadata?.client_id;
    }

    if (!clientId) {
      console.log('Webhook sin client_id, se ignora:', paymentId);
      return Response.json({ received: true });
    }

    // El pago fue aprobado - activar la suscripción en la fila (client_id, app_id)
    const planDuration = body.plan || body.metadata?.plan || '1_mes';

    // Calcular fecha de expiración con fecha fija
    const fechaPago = new Date();
    const fechaExpiracion = calcularFechaExpiracion(fechaPago, planDuration);

    // Guardar suscripción (una fila por (client_id, app_id))
    const { error: insertError } = await supabase
      .from('suscripciones')
      .upsert({
        client_id: clientId,
        app_id: appId,
        plan: planDuration,
        estado: 'activo',
        fecha_inicio: new Date().toISOString(),
        fecha_expiracion: fechaExpiracion.toISOString(),
        mp_payment_id: paymentId,
        mp_response: JSON.stringify(body)
      }, { onConflict: 'client_id,app_id' });

    if (insertError) {
      console.error('Error guardando suscripción:', insertError);
    } else {
      console.log(`Suscripción activada para (${appId}, ${clientId}) hasta:`, fechaExpiracion);
    }

    return Response.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return Response.json({ error: 'Error processing webhook' }, { status: 500 });
  }
}