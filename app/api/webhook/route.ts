import { createClient } from '@supabase/supabase-js';
import { handleWebhook, type WebhookSupabaseClient } from '../../../lib/webhook-handler.ts';

// POST es un thin wrapper: la política completa vive en handleWebhook
// (lib/webhook-handler.ts) para que los tests la importen sin red.
// Este archivo NO exporta nada fuera de los métodos HTTP (requisito de
// Next.js para route.ts — exportar helpers rompe `next build`).
//
// Import desde '../app/api/webhook/route' queda prohibido por la
// restricción de tipos de Next; los tests importan de lib/.

// Cliente lazy por request, creado DESPUÉS del fail-loud de entorno.
// Jamás key anónima hardcodeada ni fallbacks silenciosos (G5).
// El cast es un adapter boundary: el cliente real es compatible en runtime
// con la interfaz mínima del handler, pero los generics de postgrest no
// satisfacen el subset tipográfico exacto que la interfaz declara.
export async function POST(request: Request) {
  return handleWebhook(request, {
    env: process.env,
    fetchImpl: fetch,
    getSupabase: () =>
      createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_KEY!
      ) as unknown as WebhookSupabaseClient,
  });
}