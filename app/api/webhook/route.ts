import { createClient } from '@supabase/supabase-js';
import { createHmac } from 'crypto';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_KEY!
);

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export async function OPTIONS() {
  return new Response(null, { status: 200, headers });
}

export async function POST(request: Request) {
  try {
    const signature = request.headers.get('x-signature');
    const timestamp = request.headers.get('x-timestamp');
    const bodyRaw = await request.text();
    
    const body = JSON.parse(bodyRaw);
    
    if (body.type !== 'payment') {
      return Response.json({ ok: true, message: 'No es payment' }, { headers });
    }

    const paymentId = body.data?.id;
    if (!paymentId) {
      return Response.json({ ok: true, message: 'Sin payment ID' }, { headers });
    }

    const mpResponse = await fetch(
      `https://api.mercadopago.com/v1/payments/${paymentId}`,
      {
        headers: {
          'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}`
        }
      }
    );

    const payment = await mpResponse.json();

    if (payment.status !== 'approved') {
      return Response.json({ 
        ok: true, 
        message: `Pago no aprobado: ${payment.status}` 
      }, { headers });
    }

    const clientId = payment.external_reference || payment.metadata?.client_id || `pago_${paymentId}`;
    const plan = payment.metadata?.plan || payment.payment_type || '1_mes';
    const email = payment.payer?.email || payment.metadata?.email || 'sin-email@email.com';

    console.log(`Procesando pago ${paymentId} para client_id: ${clientId}`);

    const duracionDias: Record<string, number> = {
      '1_mes': 30,
      '6_meses': 180,
      '1_anio': 365
    };

    const dias = duracionDias[plan] || 30;
    const fechaExpiracion = new Date();
    fechaExpiracion.setDate(fechaExpiracion.getDate() + dias);

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
      console.error('Error:', error);
      return Response.json(
        { ok: false, error: error.message },
        { status: 500, headers }
      );
    }

    console.log(`Suscripción activada para ${clientId}`);
    return Response.json({ ok: true, message: 'Suscripción activada' }, { headers });

  } catch (error) {
    console.error('Error:', error);
    return Response.json(
      { ok: false, error: 'Error interno' }, 
      { status: 500, headers }
    );
  }
}