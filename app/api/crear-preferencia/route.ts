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
      '1_mes': 1,
      '6_meses': 1,
      '1_anio': 1,
    };

    if (!precios[plan]) {
      return Response.json(
        { ok: false, error: 'Plan inválido. Use: 1_mes, 6_meses, o 1_anio' },
        { status: 400, headers }
      );
    }

    const nombrePlanes: Record<string, string> = {
      '1_mes': 'Suscripcion ERP Mes #T' + Date.now(),
      '6_meses': 'Suscripcion ERP Semestral #T' + Date.now(),
      '1_anio': 'Suscripcion ERP Anual #T' + Date.now(),
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
          external_reference: client_id,
          metadata: {
            client_id: client_id,
            plan: plan,
            email: email,
          },
          notification_url: `${process.env.NEXT_PUBLIC_SUPABASE_URL?.replace('/rest/v1', '')}/api/webhook`,
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
    }, { headers });

  } catch (error) {
    console.error('Error:', error);
    return Response.json(
      { ok: false, error: 'Error interno del servidor' },
      { status: 500, headers }
    );
  }
}