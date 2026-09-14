import { createClient } from '@supabase/supabase-js';

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
    const { client_id, app_id = 'ordo', plan, email } = await request.json();

    if (!client_id || !plan || !email) {
      return Response.json(
        { ok: false, error: 'client_id, plan y email son requeridos' },
        { status: 400, headers }
      );
    }

    // Contrato: external_reference = `${app_id}:${client_id}`.
    // Los valores no pueden contener ':' porque el webhook hace split por el primer ':'
    if (client_id.indexOf(':') !== -1 || app_id.indexOf(':') !== -1) {
      return Response.json(
        { ok: false, error: 'app_id y client_id no pueden contener ":"' },
        { status: 400, headers }
      );
    }

    // Precios - $10 para pruebas, precios reales para producción
    const precios: Record<string, number> = {
      '1_mes': 10, // $10 para probar hastaq funcione
      '6_meses': 180000,
      '1_anio': 300000,
    };

    if (!precios[plan]) {
      return Response.json(
        { ok: false, error: 'Plan inválido. Use: 1_mes, 6_meses, o 1_anio' },
        { status: 400, headers }
      );
    }

    // Referencia que codifica (app_id, client_id) para que el webhook registre
    // el pago en la fila correcta. Sin UUID random: la fuente de verdad es el par.
    const externalRef = `${app_id}:${client_id}`;
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
            app_id: app_id,
            plan: plan,
            email: email,
            ref: externalRef,
          },
          notification_url: process.env.NOTIFICATION_URL || 'https://suscripcion-api-kc5t.vercel.app/api/webhook',
          back_urls: {
            success: `${process.env.NEXT_PUBLIC_SUPABASE_URL?.replace('/rest/v1', '')}/success`,
            failure: `${process.env.NEXT_PUBLIC_SUPABASE_URL?.replace('/rest/v1', '')}/failure`,
            pending: `${process.env.NEXT_PUBLIC_SUPABASE_URL?.replace('/rest/v1', '')}/pending`,
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