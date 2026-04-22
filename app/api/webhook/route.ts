import { createClient } from '@supabase/supabase-js';
import { createHmac } from 'crypto';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_KEY!
);

// Validar firma de MercadoPago (seguridad)
function validarFirmaMP(signature: string, timestamp: string, body: string, secret: string): boolean {
  if (!signature || !timestamp || !secret) return false;
  
  const manifest = `id:${body};request-id:${timestamp};ts:${timestamp};`;
  const firma = createHmac('sha256', secret).update(manifest).digest('hex');
  
  return firma === signature;
}

export async function POST(request: Request) {
  try {
    // Leer headers para validar firma
    const signature = request.headers.get('x-signature');
    const timestamp = request.headers.get('x-timestamp');
    const bodyRaw = await request.text();
    
    // Validar firma del webhook (opcional pero recomendado)
    const webhookSecret = process.env.MP_WEBHOOK_SECRET;
    if (webhookSecret && signature && timestamp) {
      const bodyJson = JSON.parse(bodyRaw);
      const esValida = validarFirmaMP(signature, timestamp, bodyJson.data?.id?.toString() || '', webhookSecret);
      if (!esValida) {
        console.error('Firma de webhook inválida');
        return Response.json({ ok: false, error: 'Firma inválida' }, { status: 401 });
      }
    }
    
    const body = JSON.parse(bodyRaw);
    
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