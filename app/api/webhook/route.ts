import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_KEY!
);

export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    // Solo procesar notificaciones de payment
    if (body.type !== 'payment') {
      return Response.json({ ok: true, message: 'No es payment' });
    }

    const paymentId = body.data?.id;
    if (!paymentId) {
      return Response.json({ ok: true, message: 'Sin payment ID' });
    }

    // Consultar estado del pago a MercadoPago
    const mpResponse = await fetch(
      `https://api.mercadopago.com/v1/payments/${paymentId}`,
      {
        headers: {
          'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}`
        }
      }
    );

    const payment = await mpResponse.json();

    // Solo procesar pagos aprobados
    if (payment.status !== 'approved') {
      return Response.json({ 
        ok: true, 
        message: `Pago no aprobado: ${payment.status}` 
      });
    }

    // Extraer metadata (client_id, plan)
    const clientId = payment.external_reference || payment.metadata?.client_id;
    const plan = payment.metadata?.plan || '1_mes';
    const email = payment.payer?.email || 'sin-email@email.com';

    if (!clientId) {
      console.error('No se encontró client_id en el pago');
      return Response.json(
        { ok: false, error: 'Sin client_id' },
        { status: 400 }
      );
    }

    // Calcular fecha de expiración según el plan
    const duracionDias: Record<string, number> = {
      '1_mes': 30,
      '6_meses': 180,
      '1_anio': 365
    };

    const dias = duracionDias[plan] || 30;
    const fechaExpiracion = new Date();
    fechaExpiracion.setDate(fechaExpiracion.getDate() + dias);

    // Guardar o actualizar suscripción
    const { error } = await supabase
      .from('suscripciones')
      .upsert({
        client_id: clientId,
        email: email,
        plan: plan,
        estado: 'activo',
        fecha_inicio: new Date().toISOString(),
        fecha_expiracion: fechaExpiracion.toISOString(),
        mp_payment_id: String(paymentId)
      }, { onConflict: 'client_id' });

    if (error) {
      console.error('Error guardando suscripción:', error);
      return Response.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }

    console.log(`Suscripción activada para ${clientId}, plan ${plan}`);
    return Response.json({ ok: true, message: 'Suscripción activada' });

  } catch (error) {
    console.error('Webhook error:', error);
    return Response.json(
      { ok: false, error: 'Error interno del servidor' }, 
      { status: 500 }
    );
  }
}