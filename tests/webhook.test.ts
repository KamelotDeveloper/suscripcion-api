// Route-level tests for app/api/webhook/route.ts (spec G5 + G7).
// Runner: node --test --experimental-strip-types (same as mp-contract.test.ts).
// No network: fetch → fake MercadoPago API, getSupabase → in-memory fake client.
// Covers: env fail-loud 500s, paymentId extraction, GET /v1/payments truth
// source, approved vs non-approved gate, external_reference first-':' parse,
// ERP- back-compat, unknown app_id → 400, idempotent re-delivery, expiry from
// plan dias (planes_suscripcion).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { handleWebhook } from '../app/api/webhook/route.ts';

type Json = any;

// ─── Fake Supabase client (in-memory, records upserts / reads) ─────────
interface UpsertLog {
  table: string;
  payload: Record<string, unknown>;
  onConflict: string | undefined;
}

class FakeSupabase {
  upserts: UpsertLog[] = [];
  store = new Map<string, Record<string, unknown>>();
  planDiasByKey = new Map<string, number>();
  planLookups: Array<{ appId: string; planId: string }> = [];
  upsertError: unknown = null;

  seedPlan(appId: string, planId: string, dias: number): void {
    this.planDiasByKey.set(`${appId}|${planId}`, dias);
  }

  from(table: string): any {
    const self = this;
    const builder: any = {
      _filters: [] as Array<[string, unknown]>,
      select(cols: string) {
        builder._select = cols;
        return builder;
      },
      eq(col: string, val: unknown) {
        builder._filters.push([col, val]);
        return builder;
      },
      maybeSingle() {
        if (table === 'planes_suscripcion') {
          const appId = builder._filters.find((f: [string, unknown]) => f[0] === 'app_id')?.[1] as string;
          const planId = builder._filters.find((f: [string, unknown]) => f[0] === 'id')?.[1] as string;
          self.planLookups.push({ appId, planId });
          const dias = self.planDiasByKey.get(`${appId}|${planId}`);
          return Promise.resolve({ data: dias === undefined ? null : { dias }, error: null });
        }
        if (table === 'suscripciones') {
          const clientId = builder._filters.find((f: [string, unknown]) => f[0] === 'client_id')?.[1] as string;
          const appId = builder._filters.find((f: [string, unknown]) => f[0] === 'app_id')?.[1] as string;
          const row = self.store.get(`${appId}|${clientId}`);
          return Promise.resolve({ data: row ?? null, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
      upsert(payload: Record<string, unknown>, options?: { onConflict?: string }) {
        const key = `${payload.app_id}|${payload.client_id}`;
        self.store.set(key, { ...(self.store.get(key) ?? {}), ...payload });
        self.upserts.push({ table, payload, onConflict: options?.onConflict });
        return builder;
      },
      then(resolve: (v: unknown) => void, reject: (e: unknown) => void) {
        return Promise.resolve({ data: null, error: self.upsertError }).then(resolve, reject);
      },
    };
    return builder;
  }
}

// ─── Fake global fetch (MercadoPago API) ───────────────────────────────
function makeFetch(handler: (url: string, init?: RequestInit) => Promise<Json>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const impl: typeof fetch = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  }) as typeof fetch;
  return { calls, impl };
}

function mpOk(payment: Json) {
  return { ok: true, status: 200, json: async () => payment };
}

function mpError(status: number) {
  return { ok: false, status, json: async () => ({}) };
}

// ─── Fixtures ───────────────────────────────────────────────────────────
const BASE_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://nrysusllouuytjlwdyvn.supabase.co',
  SUPABASE_SERVICE_KEY: 'svc-key-test',
  MP_ACCESS_TOKEN: 'test-mp-token',
};

const approvedPayment = (over: Json = {}) => ({
  id: 'mp-123',
  status: 'approved',
  external_reference: 'ordo:client-1',
  metadata: { app_id: 'ordo', client_id: 'client-1', plan: '6_meses', email: 'cli@example.com' },
  ...over,
});

function webhookRequest(body: unknown): Request {
  return new Request('https://suscipcion-api-kc5t.vercel.app/api/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function setup(
  over: {
    payment?: Json;
    paymentStatus?: number;
    env?: Record<string, string | undefined>;
  } = {}
) {
  const supabase = new FakeSupabase();
  supabase.seedPlan('ordo', '1_mes', 30);
  supabase.seedPlan('ordo', '6_meses', 180);
  supabase.seedPlan('ordo', '1_anio', 365);
  const payment = over.payment ?? approvedPayment();
  const env = over.env ?? BASE_ENV;
  const fetchStub = makeFetch(async () =>
    over.paymentStatus === undefined ? mpOk(payment) : mpError(over.paymentStatus)
  );
  const deps = { env, fetchImpl: fetchStub.impl, getSupabase: () => supabase };
  return { supabase, fetchStub, deps };
}

// ─── G5: env fail-loud ─────────────────────────────────────────────────
describe('webhook env fail-loud (G5)', () => {
  it('500 when SUPABASE_SERVICE_KEY missing, no MP call', async () => {
    const { supabase, fetchStub, deps } = setup({ env: { ...BASE_ENV, SUPABASE_SERVICE_KEY: undefined } });
    const res = await handleWebhook(webhookRequest({ type: 'payment', data: { id: 'mp-1' } }), deps);
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: 'SUPABASE_SERVICE_KEY missing' });
    assert.equal(fetchStub.calls.length, 0);
    assert.equal(supabase.upserts.length, 0);
  });

  it('500 when MP_ACCESS_TOKEN missing, no MP call', async () => {
    const { supabase, fetchStub, deps } = setup({ env: { ...BASE_ENV, MP_ACCESS_TOKEN: undefined } });
    const res = await handleWebhook(webhookRequest({ type: 'payment', data: { id: 'mp-1' } }), deps);
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: 'MP_ACCESS_TOKEN missing' });
    assert.equal(fetchStub.calls.length, 0);
    assert.equal(supabase.upserts.length, 0);
  });
});

// ─── Body parsing / paymentId extraction ───────────────────────────────
describe('webhook body parsing', () => {
  it('body without any payment id → 200 ack, no MP call, no upsert', async () => {
    const { supabase, fetchStub, deps } = setup();
    const res = await handleWebhook(webhookRequest({ type: 'payment' }), deps);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { received: true });
    assert.equal(fetchStub.calls.length, 0);
    assert.equal(supabase.upserts.length, 0);
  });

  it('extracts paymentId from data.id and verifies via GET /v1/payments/{id} with Bearer token', async () => {
    const { fetchStub, deps } = setup({ payment: approvedPayment({ id: 'mp-123' }) });
    const res = await handleWebhook(webhookRequest({ type: 'payment', data: { id: 'mp-123' } }), deps);
    assert.equal(res.status, 200);
    assert.equal(fetchStub.calls.length, 1);
    assert.equal(fetchStub.calls[0].url, 'https://api.mercadopago.com/v1/payments/mp-123');
    const headers = (fetchStub.calls[0].init as RequestInit).headers as Record<string, string>;
    assert.equal(headers.Authorization, 'Bearer test-mp-token');
  });

  it('falls back to flat body.id when data.id is absent', async () => {
    const { fetchStub, supabase, deps } = setup({ payment: approvedPayment({ id: 'mp-9' }) });
    const res = await handleWebhook(webhookRequest({ id: 'mp-9' }), deps);
    assert.equal(res.status, 200);
    assert.equal(fetchStub.calls[0].url, 'https://api.mercadopago.com/v1/payments/mp-9');
    assert.equal(supabase.upserts[0].payload.mp_payment_id, 'mp-9');
  });

  it('malformed JSON body → 500 Error processing webhook', async () => {
    const { deps } = setup();
    const bad = new Request('https://suscipcion-api-kc5t.vercel.app/api/webhook', {
      method: 'POST',
      body: '{not-json',
    });
    const res = await handleWebhook(bad, deps);
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: 'Error processing webhook' });
  });
});

// ─── Approved gate (G2/G5) ─────────────────────────────────────────────
describe('webhook approved gate', () => {
  it('non-approved payment → 200 ack, NO upsert, NO supabase reads', async () => {
    const { supabase, deps } = setup({ payment: approvedPayment({ status: 'pending' }) });
    const res = await handleWebhook(webhookRequest({ type: 'payment', data: { id: 'mp-x' } }), deps);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { received: true });
    assert.equal(supabase.upserts.length, 0);
    assert.equal(supabase.planLookups.length, 0);
    assert.equal(supabase.store.size, 0);
  });

  it('MP verification fails (GET !ok) → 500 Failed to verify payment', async () => {
    const { supabase, deps } = setup({ paymentStatus: 404 });
    const res = await handleWebhook(webhookRequest({ type: 'payment', data: { id: 'mp-404' } }), deps);
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: 'Failed to verify payment' });
    assert.equal(supabase.upserts.length, 0);
  });
});

// ─── Approved upsert (G5/G7) ───────────────────────────────────────────
describe('webhook approved upsert', () => {
  it('approved "ordo:client-1" → upsert activo with contract metadata', async () => {
    const { supabase, deps } = setup();
    const res = await handleWebhook(webhookRequest({ type: 'payment', data: { id: 'mp-123' } }), deps);
    assert.equal(res.status, 200);
    assert.equal(supabase.upserts.length, 1);
    const u = supabase.upserts[0];
    assert.equal(u.table, 'suscripciones');
    assert.equal(u.onConflict, 'client_id,app_id');
    const p = u.payload;
    assert.equal(p.app_id, 'ordo');
    assert.equal(p.client_id, 'client-1');
    assert.equal(p.plan, '6_meses');
    assert.equal(p.estado, 'activo');
    assert.equal(p.mp_payment_id, 'mp-123');
    assert.equal(p.email, 'cli@example.com');
    assert.ok(typeof p.fecha_inicio === 'string' && !Number.isNaN(Date.parse(p.fecha_inicio as string)));
    assert.ok(String(p.mp_response).includes('"approved"'));
  });

  it('ERP- back-compat ref → app ordo, ERP- prefix stripped from client', async () => {
    const { supabase, deps } = setup({
      payment: approvedPayment({
        external_reference: 'ERP-uuid-123',
        metadata: { plan: '6_meses' },
      }),
    });
    const res = await handleWebhook(webhookRequest({ type: 'payment', data: { id: 'mp-123' } }), deps);
    assert.equal(res.status, 200);
    assert.equal(supabase.upserts.length, 1);
    const p = supabase.upserts[0].payload;
    assert.equal(p.app_id, 'ordo');
    assert.equal(p.client_id, 'uuid-123');
    assert.ok(!p.client_id.includes('ERP-'));
    assert.equal(p.plan, '6_meses');
  });

  it('unknown app_id in external_reference → explicit 400, no upsert', async () => {
    const { supabase, deps } = setup({
      payment: approvedPayment({
        external_reference: 'unknown-app:c-123',
        metadata: { plan: '6_meses' },
      }),
    });
    const res = await handleWebhook(webhookRequest({ type: 'payment', data: { id: 'mp-x' } }), deps);
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: 'Unknown app_id' });
    assert.equal(supabase.upserts.length, 0);
    assert.equal(supabase.planLookups.length, 0);
  });
});

// ─── Expiry from plan dias (G6) ────────────────────────────────────────
describe('webhook expiry (G6)', () => {
  it('6_meses plan → fecha_expiracion = now + 180 days from planes_suscripcion', async () => {
    const { supabase, deps } = setup();
    const before = Date.now();
    const res = await handleWebhook(webhookRequest({ type: 'payment', data: { id: 'mp-123' } }), deps);
    const after = Date.now();
    assert.equal(res.status, 200);
    assert.deepEqual(supabase.planLookups, [{ appId: 'ordo', planId: '6_meses' }]);
    const expiry = Date.parse(supabase.upserts[0].payload.fecha_expiracion as string);
    assert.ok(expiry >= before + 180 * 86400000 - 5000, 'expiry not before now+180d');
    assert.ok(expiry <= after + 180 * 86400000 + 5000, 'expiry not after now+180d');
  });

  it('plan absent from planes_suscripcion → contract fallback dias (planDias) applies', async () => {
    // Custom fake seeded with ONLY 6_meses so '1_mes' resolves to null in DB
    // and the route falls back to planDias('1_mes') = 30 (G6 fallback).
    const supabase = new FakeSupabase();
    supabase.seedPlan('ordo', '6_meses', 180);
    const fetchStub = makeFetch(async () =>
      mpOk(approvedPayment({ metadata: { app_id: 'ordo', client_id: 'client-1', plan: '1_mes', email: null } }))
    );
    const deps = { env: BASE_ENV, fetchImpl: fetchStub.impl, getSupabase: () => supabase };
    const before = Date.now();
    const res = await handleWebhook(webhookRequest({ type: 'payment', data: { id: 'mp-123' } }), deps);
    const after = Date.now();
    assert.equal(res.status, 200);
    assert.deepEqual(supabase.planLookups, [{ appId: 'ordo', planId: '1_mes' }]);
    const expiry = Date.parse(supabase.upserts[0].payload.fecha_expiracion as string);
    assert.ok(expiry >= before + 30 * 86400000 - 5000, 'expiry not before now+30d');
    assert.ok(expiry <= after + 30 * 86400000 + 5000, 'expiry not after now+30d');
  });
});

// ─── Idempotency (G5/G7) ───────────────────────────────────────────────
describe('webhook idempotency (G5)', () => {
  it('re-delivery of same mp_payment_id → second call does NOT re-write', async () => {
    const { supabase, deps } = setup({ payment: approvedPayment({ id: 'mp-123' }) });
    const r1 = await handleWebhook(webhookRequest({ type: 'payment', data: { id: 'mp-123' } }), deps);
    const r2 = await handleWebhook(webhookRequest({ type: 'payment', data: { id: 'mp-123' } }), deps);
    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
    assert.deepEqual(await r2.json(), { received: true });
    assert.equal(supabase.upserts.length, 1, 'second delivery must not re-write');
    assert.equal(supabase.store.size, 1);
  });

  it('upsert error from Supabase → 500 Error saving subscription', async () => {
    const { supabase, deps } = setup();
    supabase.upsertError = { message: 'boom' };
    const res = await handleWebhook(webhookRequest({ type: 'payment', data: { id: 'mp-123' } }), deps);
    assert.equal(res.status, 500);
    assert.deepEqual(await res.json(), { error: 'Error saving subscription' });
  });
});