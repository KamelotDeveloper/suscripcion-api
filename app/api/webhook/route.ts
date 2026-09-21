import { createClient } from '@supabase/supabase-js';
import { KNOWN_APPS, parseExternalReference, planDias, expiryFromDias } from '../../../lib/mp-contract.ts';

// ── Injectable deps (slice C: route-level tests under plain node) ──────
// handleWebhook holds the full policy; POST is a thin wrapper. Tests stub
// fetch + Supabase with no network (G7). HTTP contract is unchanged: same
// statuses, same messages, same ordering (env fail-loud before parsing).

export interface WebhookEnv {
  [key: string]: string | undefined;
}

export interface WebhookSelectResult<T = any> {
  data: T | null;
  error: unknown;
}

export interface WebhookUpsertResult {
  data: unknown;
  error: unknown;
}

export interface WebhookQueryBuilder<T = any> {
  select(columns: string): WebhookQueryBuilder<T>;
  eq(column: string, value: unknown): WebhookQueryBuilder<T>;
  maybeSingle(): PromiseLike<WebhookSelectResult<T>>;
  upsert(
    payload: Record<string, unknown>,
    options?: { onConflict?: string }
  ): WebhookQueryBuilder<T> & PromiseLike<WebhookUpsertResult>;
}

export interface WebhookSupabaseClient {
  from(table: string): WebhookQueryBuilder<any>;
}

export interface WebhookDeps {
  env: WebhookEnv;
  fetchImpl: typeof fetch;
  getSupabase: () => WebhookSupabaseClient;
}

export async function handleWebhook(request: Request, deps: WebhookDeps): Promise<Response> {
  const { env, fetchImpl, getSupabase } = deps;
  try {
    // Fail-loud (G5): sin estas variables NO se procesa nada.
    // Sin la service key, el upsert fallaría por RLS en silencio.
    if (!env.SUPABASE_SERVICE_KEY) {
      return Response.json({ error: 'SUPABASE_SERVICE_KEY missing' }, { status: 500 });
    }
    if (!env.MP_ACCESS_TOKEN) {
      return Response.json({ error: 'MP_ACCESS_TOKEN missing' }, { status: 500 });
    }

    const body = await request.json();

    console.log('Webhook recibido:', JSON.stringify(body, null, 2));

    // Las notificaciones reales de MP solo mandan { type: 'payment', data: { id }, ... }.
    // El pago se valida llamando a la API de MercadoPago con el id.
    const paymentId = body.data?.id || body.id || body.payment_id;

    if (!paymentId) {
      console.log('Webhook sin payment id, se ignora');
      return Response.json({ received: true });
    }

    // Fuente de verdad: pedir el pago a MercadoPago
    const mpResp = await fetchImpl(
      `https://api.mercadopago.com/v1/payments/${paymentId}`,
      { headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}` } }
    );

    if (!mpResp.ok) {
      console.error('Error verificando pago en MP:', paymentId, mpResp.status);
      return Response.json({ error: 'Failed to verify payment' }, { status: 500 });
    }

    const payment = await mpResp.json();

    if (payment.status !== 'approved') {
      console.log('Pago no aprobado, se ignora:', paymentId, payment.status);
      return Response.json({ received: true });
    }

    // external_reference trae `${app_id}:${client_id}` (sin ':' en los valores).
    // El split por el primer ':' y el back-compat ERP- viven en el contrato (lib).
    const externalRef = payment.external_reference || payment.metadata?.ref;
    let { appId, clientId } = parseExternalReference(externalRef);

    if (!appId && payment.metadata?.app_id) appId = payment.metadata.app_id;
    if (!clientId && payment.metadata?.client_id) clientId = payment.metadata.client_id;

    // App desconocida => 400 explícito, NUNCA default silencioso a 'ordo' (G5).
    if (appId && !KNOWN_APPS.includes(appId)) {
      console.error('Webhook con app_id desconocido:', appId);
      return Response.json({ error: 'Unknown app_id' }, { status: 400 });
    }

    if (!appId || !clientId) {
      console.log('Webhook sin client_id/app_id, se ignora:', paymentId);
      return Response.json({ received: true });
    }

    // El pago fue aprobado - activar la suscripción en la fila (client_id, app_id)
    const planDuration = payment.metadata?.plan || '1_mes';

    // Duración canónica (G6): dias de planes_suscripcion, fallback al contrato.
    // expiración = ahora + dias (espejo de timedelta(days=dias), sin addMonths).
    const { data: planDb } = await getSupabase()
      .from('planes_suscripcion')
      .select('dias')
      .eq('app_id', appId)
      .eq('id', planDuration)
      .maybeSingle();
    const dias = planDb?.dias ?? planDias(planDuration);
    const fechaExpiracion = expiryFromDias(dias);

    // Guarda de idempotencia: mismo payment_id ya activado => no reescribir (G5).
    const { data: existente } = await getSupabase()
      .from('suscripciones')
      .select('mp_payment_id, estado')
      .eq('client_id', clientId)
      .eq('app_id', appId)
      .maybeSingle();

    if (existente?.mp_payment_id === paymentId && existente?.estado === 'activo') {
      console.log('Webhook duplicado, sin cambios:', paymentId);
      return Response.json({ received: true });
    }

    // Guardar suscripción (una fila por (client_id, app_id))
    const { error: insertError } = await getSupabase()
      .from('suscripciones')
      .upsert({
        client_id: clientId,
        app_id: appId,
        plan: planDuration,
        email: payment.metadata?.email || null,
        estado: 'activo',
        fecha_inicio: new Date().toISOString(),
        fecha_expiracion: fechaExpiracion.toISOString(),
        mp_payment_id: paymentId,
        mp_response: JSON.stringify(payment)
      }, { onConflict: 'client_id,app_id' });

    if (insertError) {
      console.error('Error guardando suscripción:', insertError);
      return Response.json({ error: 'Error saving subscription' }, { status: 500 });
    }

    console.log(`Suscripción activada para (${appId}, ${clientId}) hasta:`, fechaExpiracion);
    return Response.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return Response.json({ error: 'Error processing webhook' }, { status: 500 });
  }
}

// Cliente lazy por request, creado DESPUÉS del fail-loud de entorno.
// Jamás key anónima hardcodeada ni fallbacks silenciosos (G5).
export async function POST(request: Request) {
  return handleWebhook(request, {
    env: process.env,
    fetchImpl: fetch,
    getSupabase: () =>
      createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_KEY!
      ),
  });
}