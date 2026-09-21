import { createClient } from '@supabase/supabase-js';
import { KNOWN_APPS, fallbackPrices, buildPreferencePayload } from '../../../lib/mp-contract';

const headers = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// Cliente lazy por request, claves solo desde el entorno
function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!
  );
}

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

    if (!KNOWN_APPS.includes(app_id)) {
      return Response.json(
        { ok: false, error: 'app_id inválido. Use: ordo o canyp' },
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

    // Fail-loud: sin token de MP o sin service key no se puede operar.
    // La fila 'pendiente' se escribe con la service key, NUNCA con la anónima
    // (RLS la rechazaría en silencio y la suscripción quedaría sin registrar).
    if (!process.env.MP_ACCESS_TOKEN) {
      return Response.json(
        { ok: false, error: 'MP_ACCESS_TOKEN no configurado' },
        { status: 500, headers }
      );
    }
    if (!process.env.SUPABASE_SERVICE_KEY) {
      return Response.json(
        { ok: false, error: 'SUPABASE_SERVICE_KEY no configurado' },
        { status: 500, headers }
      );
    }

    // Precio canónico (G3): tabla planes_suscripcion, con fallback al
    // catálogo del contrato. Sin precios hardcodeados en esta ruta.
    const { data: planDb, error: planError } = await getSupabase()
      .from('planes_suscripcion')
      .select('*')
      .eq('app_id', app_id)
      .eq('id', plan)
      .maybeSingle();
    const planInfo = (!planError && planDb) ? planDb : fallbackPrices(app_id)?.[plan];

    if (!planInfo) {
      return Response.json(
        { ok: false, error: 'Plan inválido para la app seleccionada. Use: 1_mes, 6_meses o 1_anio (ordo) / canyp_1_mes, canyp_6_meses o canyp_1_anio (canyp)' },
        { status: 400, headers }
      );
    }

    // Fila 'pendiente': la suscripción NO queda activa hasta que el webhook
    // reciba un pago aprobado (G2). Upsert por (client_id, app_id).
    const { error: rowError } = await getSupabase()
      .from('suscripciones')
      .upsert({
        client_id,
        app_id,
        email,
        plan,
        estado: 'pendiente',
        fecha_inicio: new Date().toISOString(),
        mp_payment_id: null,
      }, { onConflict: 'client_id,app_id' });

    if (rowError) {
      console.error('Error creando suscripcion pendiente:', rowError);
      return Response.json(
        { ok: false, error: 'Error al registrar la suscripción' },
        { status: 500, headers }
      );
    }

    // Referencia que codifica (app_id, client_id) para que el webhook registre
    // el pago en la fila correcta. Sin UUID random: la fuente de verdad es el par.
    const externalRef = `${app_id}:${client_id}`;
    const nombrePlan = `Suscripcion ${app_id === 'canyp' ? 'Canyp' : 'Ordo'} - ${plan}`;

    // Payload del contrato (G1): metadata, external_reference `${app_id}:${client_id}`,
    // notification_url y back_urls apuntando al origen de Vercel (no Supabase).
    const payload = buildPreferencePayload({
      client_id,
      app_id,
      plan,
      email,
      unit_price: planInfo.precio,
      title: nombrePlan,
      notification_url: process.env.NOTIFICATION_URL,
    });

    const mpResponse = await fetch(
      'https://api.mercadopago.com/checkout/preferences',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.MP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
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