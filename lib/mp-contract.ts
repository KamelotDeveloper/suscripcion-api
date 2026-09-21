// Pure plan / MercadoPago contract shared by the web API routes.
// Mirrors backend/pricing.py EXACTLY (known apps, prices, dias) so both
// codebases charge identical prices and derive identical expiries (G3/G6).
// Dependency-free: no imports, no server APIs — safe under plain node
// (slice C tests import this file directly with explicit .ts extension).

export type Plan = {
  id: string;
  nombre: string;
  descripcion: string;
  precio: number;
  dias: number;
  descuento: number;
};

export const KNOWN_APPS: string[] = ['ordo', 'canyp'];

// Canonical fallback catalog - MUST stay identical to backend/pricing.py.
export const PLAN_FALLBACK: Record<string, Plan[]> = {
  ordo: [
    { id: '1_mes', nombre: 'Mensual', descripcion: 'Acceso completo por 1 mes', precio: 70000, dias: 30, descuento: 0 },
    { id: '6_meses', nombre: 'Semestral', descripcion: 'Acceso completo por 6 meses', precio: 360000, dias: 180, descuento: 0 },
    { id: '1_anio', nombre: 'Anual', descripcion: 'Acceso completo por 1 año', precio: 720000, dias: 365, descuento: 0 },
  ],
  canyp: [
    { id: 'canyp_1_mes', nombre: 'Mensual', descripcion: 'Acceso completo por 1 mes', precio: 120000, dias: 30, descuento: 0 },
    { id: 'canyp_6_meses', nombre: 'Semestral', descripcion: 'Acceso completo por 6 meses', precio: 617000, dias: 180, descuento: 0 },
    { id: 'canyp_1_anio', nombre: 'Anual', descripcion: 'Acceso completo por 1 año', precio: 1234000, dias: 365, descuento: 0 },
  ],
};

// plan id -> dias, covering both apps (webhook fallback when Supabase fails).
export const PLAN_DIAS: Record<string, number> = {
  '1_mes': 30,
  '6_meses': 180,
  '1_anio': 365,
  'canyp_1_mes': 30,
  'canyp_6_meses': 180,
  'canyp_1_anio': 365,
};

// Vercel origin (NOT the Supabase domain): back_urls must resolve here.
export const CHECKOUT_ORIGIN = 'https://suscipcion-api-kc5t.vercel.app';
export const NOTIFICATION_URL = `${CHECKOUT_ORIGIN}/api/webhook`;

// Keyed by plan id -> {precio, dias, ...}; null when the app is unknown.
export function fallbackPrices(appId: string): Record<string, Plan> | null {
  const plans = PLAN_FALLBACK[appId];
  if (!plans) return null;
  return Object.fromEntries(plans.map((p) => [p.id, p]));
}

// Split `${app_id}:${client_id}` on the FIRST ':'. Legacy refs such as
// 'ERP-<uuid>' or a bare client id default to app 'ordo' (back-compat).
export function parseExternalReference(
  ref: string | null | undefined
): { appId: string | null; clientId: string | null } {
  if (!ref || typeof ref !== 'string') {
    return { appId: null, clientId: null };
  }
  const separator = ref.indexOf(':');
  if (separator !== -1) {
    return {
      appId: ref.slice(0, separator) || null,
      clientId: ref.slice(separator + 1) || null,
    };
  }
  return { appId: 'ordo', clientId: ref.replace(/^ERP-/, '') || null };
}

// Duration in days for a plan id; 30 days as last-resort fallback.
export function planDias(plan: string): number {
  return PLAN_DIAS[plan] ?? 30;
}

// Expiry = from + dias days, mirroring backend timedelta(days=dias).
// No calendar month math (G6): 6_meses === 180 days, 1_anio === 365 days.
export function expiryFromDias(dias: number, from: Date = new Date()): Date {
  return new Date(from.getTime() + dias * 86400000);
}

// Preference payload matching the backend contract (G1): metadata,
// external_reference `${app_id}:${client_id}`, notification_url, back_urls.
export function buildPreferencePayload({
  client_id,
  app_id,
  plan,
  email,
  unit_price,
  title,
  notification_url = NOTIFICATION_URL,
}: {
  client_id: string;
  app_id: string;
  plan: string;
  email?: string | null;
  unit_price: number;
  title: string;
  notification_url?: string;
}): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    items: [{ title, quantity: 1, currency_id: 'ARS', unit_price }],
    external_reference: `${app_id}:${client_id}`,
    metadata: { app_id, client_id, plan, email },
    notification_url,
    back_urls: {
      success: `${CHECKOUT_ORIGIN}/api/success`,
      failure: `${CHECKOUT_ORIGIN}/api/failure`,
      pending: `${CHECKOUT_ORIGIN}/api/pending`,
    },
    auto_return: 'approved',
  };
  if (email) payload.payer = { email };
  return payload;
}