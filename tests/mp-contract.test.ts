// Tests for suscripcion-api/lib/mp-contract.ts
// Runner: node --test --experimental-strip-types
// Pure helpers only — no server APIs, no external deps.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  KNOWN_APPS,
  PLAN_FALLBACK,
  PLAN_DIAS,
  CHECKOUT_ORIGIN,
  NOTIFICATION_URL,
  fallbackPrices,
  parseExternalReference,
  planDias,
  expiryFromDias,
  buildPreferencePayload,
} from '../lib/mp-contract.ts';

// ─── Pricing parity with backend/pricing.py ───────────────────────────
describe('pricing parity (ordo)', () => {
  const ordo = PLAN_FALLBACK.ordo;

  it('has exactly 3 plans', () => {
    assert.equal(ordo.length, 3);
  });

  it('1_mes: precio 70000, dias 30', () => {
    const p = ordo.find((x) => x.id === '1_mes')!;
    assert.equal(p.precio, 70000);
    assert.equal(p.dias, 30);
  });

  it('6_meses: precio 360000, dias 180', () => {
    const p = ordo.find((x) => x.id === '6_meses')!;
    assert.equal(p.precio, 360000);
    assert.equal(p.dias, 180);
  });

  it('1_anio: precio 720000, dias 365', () => {
    const p = ordo.find((x) => x.id === '1_anio')!;
    assert.equal(p.precio, 720000);
    assert.equal(p.dias, 365);
  });
});

describe('pricing parity (canyp)', () => {
  const canyp = PLAN_FALLBACK.canyp;

  it('has exactly 3 plans', () => {
    assert.equal(canyp.length, 3);
  });

  it('canyp_1_mes: precio 120000, dias 30', () => {
    const p = canyp.find((x) => x.id === 'canyp_1_mes')!;
    assert.equal(p.precio, 120000);
    assert.equal(p.dias, 30);
  });

  it('canyp_6_meses: precio 617000, dias 180', () => {
    const p = canyp.find((x) => x.id === 'canyp_6_meses')!;
    assert.equal(p.precio, 617000);
    assert.equal(p.dias, 180);
  });

  it('canyp_1_anio: precio 1234000, dias 365', () => {
    const p = canyp.find((x) => x.id === 'canyp_1_anio')!;
    assert.equal(p.precio, 1234000);
    assert.equal(p.dias, 365);
  });
});

describe('KNOWN_APPS', () => {
  it('contains exactly ordo and canyp', () => {
    assert.deepEqual([...KNOWN_APPS].sort(), ['canyp', 'ordo']);
  });
});

// ─── parseExternalReference ───────────────────────────────────────────
describe('parseExternalReference', () => {
  it('parses "ordo:c-123" → appId ordo, clientId c-123', () => {
    assert.deepEqual(parseExternalReference('ordo:c-123'), {
      appId: 'ordo',
      clientId: 'c-123',
    });
  });

  it('parses "canyp:abc-456" → appId canyp, clientId abc-456', () => {
    assert.deepEqual(parseExternalReference('canyp:abc-456'), {
      appId: 'canyp',
      clientId: 'abc-456',
    });
  });

  it('bare "some-id" → appId ordo (back-compat), clientId some-id', () => {
    assert.deepEqual(parseExternalReference('some-id'), {
      appId: 'ordo',
      clientId: 'some-id',
    });
  });

  it('"ERP-uuid-123" → appId ordo, clientId uuid-123 (ERP- prefix stripped)', () => {
    assert.deepEqual(parseExternalReference('ERP-uuid-123'), {
      appId: 'ordo',
      clientId: 'uuid-123',
    });
  });

  it('splits on FIRST colon only: "ordo:a:b" → clientId "a:b"', () => {
    assert.deepEqual(parseExternalReference('ordo:a:b'), {
      appId: 'ordo',
      clientId: 'a:b',
    });
  });

  it('null → both null', () => {
    assert.deepEqual(parseExternalReference(null), { appId: null, clientId: null });
  });

  it('undefined → both null', () => {
    assert.deepEqual(parseExternalReference(undefined), { appId: null, clientId: null });
  });

  it('empty string → both null (no non-null clientId)', () => {
    assert.deepEqual(parseExternalReference(''), { appId: null, clientId: null });
  });
});

// ─── planDias ─────────────────────────────────────────────────────────
describe('planDias', () => {
  it('1_mes → 30', () => assert.equal(planDias('1_mes'), 30));
  it('6_meses → 180', () => assert.equal(planDias('6_meses'), 180));
  it('1_anio → 365', () => assert.equal(planDias('1_anio'), 365));
  it('canyp_6_meses → 180', () => assert.equal(planDias('canyp_6_meses'), 180));
  it('unknown plan → 30 (default fallback)', () => assert.equal(planDias('bogus'), 30));
});

// ─── expiryFromDias ──────────────────────────────────────────────────
describe('expiryFromDias', () => {
  it('180 dias from fixed date → exactly +180 days', () => {
    const from = new Date('2026-01-01T00:00:00Z');
    const expiry = expiryFromDias(180, from);
    assert.equal(expiry.toISOString(), new Date('2026-06-30T00:00:00Z').toISOString());
  });

  it('365 dias from fixed date → exactly +365 days (not calendar year)', () => {
    const from = new Date('2026-01-01T00:00:00Z');
    const expiry = expiryFromDias(365, from);
    assert.equal(expiry.toISOString(), new Date('2027-01-01T00:00:00Z').toISOString());
  });

  it('30 dias from fixed date → exactly +30 days', () => {
    const from = new Date('2026-03-01T00:00:00Z');
    const expiry = expiryFromDias(30, from);
    assert.equal(expiry.toISOString(), new Date('2026-03-31T00:00:00Z').toISOString());
  });

  it('0 dias → same time', () => {
    const from = new Date('2026-09-15T12:00:00Z');
    const expiry = expiryFromDias(0, from);
    assert.equal(expiry.getTime(), from.getTime());
  });
});

// ─── fallbackPrices ──────────────────────────────────────────────────
describe('fallbackPrices', () => {
  it('ordo returns keyed map with 3 entries', () => {
    const prices = fallbackPrices('ordo')!;
    assert.ok(prices);
    assert.equal(Object.keys(prices).length, 3);
    assert.equal(prices['1_mes'].precio, 70000);
  });

  it('canyp returns keyed map with 3 entries', () => {
    const prices = fallbackPrices('canyp')!;
    assert.ok(prices);
    assert.equal(prices['canyp_1_anio'].precio, 1234000);
  });

  it('unknown app → null', () => {
    assert.equal(fallbackPrices('unknown'), null);
  });
});

// ─── buildPreferencePayload ──────────────────────────────────────────
describe('buildPreferencePayload', () => {
  const base = {
    client_id: 'c-999',
    app_id: 'ordo',
    plan: '6_meses',
    email: 'test@example.com',
    unit_price: 360000,
    title: 'Suscripción Ordo',
  };

  const payload = buildPreferencePayload(base);

  it('has items array with correct unit_price', () => {
    const items = payload.items as Array<Record<string, unknown>>;
    assert.equal(items.length, 1);
    assert.equal(items[0].unit_price, 360000);
    assert.equal(items[0].currency_id, 'ARS');
  });

  it('external_reference is "app_id:client_id"', () => {
    assert.equal(payload.external_reference, 'ordo:c-999');
  });

  it('metadata contains app_id, client_id, plan, email', () => {
    const meta = payload.metadata as Record<string, unknown>;
    assert.equal(meta.app_id, 'ordo');
    assert.equal(meta.client_id, 'c-999');
    assert.equal(meta.plan, '6_meses');
    assert.equal(meta.email, 'test@example.com');
  });

  it('notification_url defaults to NOTIFICATION_URL constant', () => {
    assert.equal(payload.notification_url, NOTIFICATION_URL);
    assert.ok((payload.notification_url as string).endsWith('/api/webhook'));
  });

  it('back_urls use Vercel CHECKOUT_ORIGIN (not Supabase)', () => {
    const back = payload.back_urls as Record<string, string>;
    assert.ok(back.success.startsWith(CHECKOUT_ORIGIN));
    assert.ok(back.failure.startsWith(CHECKOUT_ORIGIN));
    assert.ok(back.pending.startsWith(CHECKOUT_ORIGIN));
    assert.ok(!back.success.includes('supabase'));
  });

  it('auto_return is "approved"', () => {
    assert.equal(payload.auto_return, 'approved');
  });

  it('payer.email is set when email is provided', () => {
    const payer = payload.payer as Record<string, string>;
    assert.equal(payer.email, 'test@example.com');
  });

  it('no payer when email is null/undefined', () => {
    const noEmail = buildPreferencePayload({ ...base, email: null });
    assert.equal(noEmail.payer, undefined);
  });
});

// ─── Constants sanity ────────────────────────────────────────────────
describe('constants', () => {
  it('CHECKOUT_ORIGIN is the Vercel URL', () => {
    assert.equal(CHECKOUT_ORIGIN, 'https://suscipcion-api-kc5t.vercel.app');
  });

  it('NOTIFICATION_URL ends with /api/webhook', () => {
    assert.equal(NOTIFICATION_URL, 'https://suscipcion-api-kc5t.vercel.app/api/webhook');
  });

  it('PLAN_DIAS has 6 entries (3 ordo + 3 canyp)', () => {
    assert.equal(Object.keys(PLAN_DIAS).length, 6);
  });
});
