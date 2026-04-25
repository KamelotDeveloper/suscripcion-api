import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://mucitlqroneaegmwvdup.supabase.co',
  process.env.NEXT_PUBLIC_SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im11Y2l0bHFyb25lYWVnbXd2ZHVwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3NjY5OTgsImV4cCI6MjA5MjM0Mjk5OH0.8Ne39FOS8Wk3vsrdCIzs5B3aogg7W5U258Ir4wg6IHc'
);

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
        
        // Calcular fecha de expiración según el plan
        const planDuration = body.plan || '1_mes';
        const dias = planDuration === '1_mes' ? 30 : planDuration === '6_meses' ? 180 : 365;
        const fechaExpiracion = new Date();
        fechaExpiracion.setDate(fechaExpiracion.getDate() + dias);

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
          console.log('Suscripción activada para:', clientId);
        }
      }
    }

    return Response.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return Response.json({ error: 'Error processing webhook' }, { status: 500 });
  }
}