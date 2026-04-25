import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

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
    const { client_id, plan, email } = await request.json();

    if (!client_id || !plan || !email) {
      return Response.json(
        { ok: false, error: 'client_id, plan y email son requeridos' },
        { status: 400, headers }
      );
    }

    // Precios hardcodeados en servidor (NO confiar en cliente)
    const precios: Record<string, number> = {
      '1_mes': 35000,
      '6_meses': 180000,
      '1_anio': 300000,
    };

    if (!precios[plan]) {
      return Response.json(
        { ok: false, error: 'Plan inválido. Use: 1_mes, 6_meses, o 1_anio' },
        { status: 400, headers }
      );
    }

    // Generar referencia única para tracking
    const externalRef = `ERP-${randomUUID()}`;
    const nombrePlanes: Record<string, string> = {
      '1_mes': 'Suscripcion Mensual ERP',
      '6_meses': 'Suscripcion Semestral ERP',
      '1_anio': 'Suscripcion Anual ERP',
    };

    const mpResponse = await fetch(
      'https://api.mercadopago.com/checkout/preferences',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          items: [
            {
              title: nombrePlanes[plan],
              quantity: 1,
              unit_price: precios[plan],
              currency_id: 'ARS',
            },
          ],
          external_reference: externalRef,
          metadata: {
            client_id: client_id,
            plan: plan,
            email: email,
            ref: externalRef,
          },
          notification_url: `https://suscripcion-api-kc5t.vercel.app/api/webhook`,
          back_urls: {
            success: `https://suscripcion-api-kc5t.vercel.app/api/success`,
            failure: `https://suscripcion-api-kc5t.vercel.app/api/failure`,
            pending: `https://suscripcion-api-kc5t.vercel.app/api/pending`,
          },
          auto_return: 'approved',
        }),
      }
    );

    if (!mpResponse.ok) {
      const errorText = await mpResponse.text();
      console.error('Error MP:', errorText);
      return Response.json(
        { ok: false, error: 'Error al crear preferencia en MercadoPago' },
        { status: 500, headers }
      );
    }

    const data = await mpResponse.json();

    return Response.json({
      ok: true,
      init_point: data.init_point,
      preference_id: data.id,
      external_ref: externalRef,
    }, { headers });

  } catch (error) {
    console.error('Error:', error);
    return Response.json(
      { ok: false, error: 'Error interno del servidor' },
      { status: 500, headers }
    );
  }
}