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
    
    console.log('Webhook收到的数据:', JSON.stringify(body, null, 2));

    // MercadoPago envía los datos del pago en.topic y action
    const topic = body.topic || '';
    const action = body.action || '';

    // Buscar la preferencia en los metadatos
    // MercadoPago envía la información del pago
    const paymentId = body.payment_id || body.id || body.data?.id;
    const status = body.status || body.data?.status;

    console.log('Payment ID:', paymentId, 'Status:', status);

    if (topic === 'payment' && status === 'approved') {
      // El pago fue aprobado - activar suscripción
      // Los datos del cliente están en external_reference o metadata
      const externalRef = body.external_reference;
      
      // Parsear external_reference para obtener client_id
      if (externalRef && externalRef.startsWith('ERP-')) {
        // Actualizar suscripción en Supabase
        const clientId = externalRef.replace('ERP-', '');
        
        // Obtener plan de metadata
        const planDuration = body.plan || body.metadata?.plan || '1_mes';
        
        // Calcular fecha de expiración con fecha fija
        const fechaPago = new Date();
        const fechaExpiracion = calcularFechaExpiracion(fechaPago, planDuration);

        // Guardar suscripción
        const { error: insertError } = await supabase
          .from('suscripciones')
          .upsert({
            client_id: clientId,
            plan: planDuration,
            estado: 'activa',
            fecha_inicio: new Date().toISOString(),
            fecha_expiracion: fechaExpiracion.toISOString(),
            payment_id: paymentId,
            mp_response: JSON.stringify(body)
          });

        if (insertError) {
          console.error('Error guardando suscripción:', insertError);
        } else {
          console.log('Suscripción activada para:', clientId, 'hasta:', fechaExpiracion);
        }
      }
    }

    return Response.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return Response.json({ error: 'Error processing webhook' }, { status: 500 });
  }
}