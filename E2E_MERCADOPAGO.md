# E2E MercadoPago — Manual Testing Checklist

End-to-end verification for the MercadoPago integration (cobros-reales-mercadopago).
This doc covers the full flow from preference creation through webhook confirmation.

## Prerequisites

### Vercel Environment Variables

Set these in Vercel → Project → Settings → Environment Variables:

| Variable | Scope | Required | Notes |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | All | ✅ | `https://nrysusllouuytjlwdyvn.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_KEY` | All | ✅ | Supabase anon key (public, safe for client) |
| `SUPABASE_SERVICE_KEY` | Server only | ✅ | **Secret** — Supabase service_role key (used by webhook + crear-preferencia) |
| `MP_ACCESS_TOKEN` | Server only | ✅ | **Secret** — MercadoPago access token (TEST mode for sandbox) |
| `NOTIFICATION_URL` | Server | Auto | Derived in code from Vercel origin; do NOT set manually |

> ⚠️ `SUPABASE_SERVICE_KEY` and `MP_ACCESS_TOKEN` are **server-only Secrets**. Never expose them to the client.

### Getting a TEST Token

1. Go to [MercadoPago Developers](https://www.mercadopago.com.ar/developers)
2. Create or select an application
3. Under **Credenciales**, copy the TEST access token (starts with `TEST-`)
4. Set `MP_ACCESS_TOKEN` to that TEST token in Vercel

### Sandbox Test Card

| Field | Value |
|---|---|
| Card number | `5031 7555 5552 0004` |
| Expiry | Any future date |
| CVV | `123` |
| DNI | `12345678` |

### Backend Local Server

The backend (FastAPI) runs on **port 8001** in development. Port 8000 is occupied by `canyp-backend.exe`.

```bash
cd backend
venv\Scripts\activate
uvicorn main:app --reload --port 8001
```

### Backend .env — MP_ACCESS_TOKEN

The backend also needs `MP_ACCESS_TOKEN` in `backend/.env` for the `/suscripcion/crear-preferencia` endpoint. Use the same TEST token.

## E2E Test Flow

### Step 1: Create Preference (Web or Backend)

**Web (Vercel):**
```
POST https://suscipcion-api-kc5t.vercel.app/api/crear-preferencia
Content-Type: application/json

{
  "client_id": "test-e2e-001",
  "app_id": "ordo",
  "plan": "1_mes",
  "email": "test@example.com"
}
```

**Backend (local):**
```
POST http://127.0.0.1:8001/suscripcion/crear-preferencia
Content-Type: application/json

{
  "client_id": "test-e2e-001",
  "app_id": "ordo",
  "plan": "1_mes",
  "email": "test@example.com"
}
```

**Expected:** Response contains `init_point` (checkout URL) and `id` (preference ID).
Verify: `external_reference` is `ordo:test-e2e-001`, `metadata` contains `app_id`, `client_id`, `plan`, `email`.

### Step 2: Complete Checkout

1. Open `init_point` URL in browser
2. Log in to MercadoPago sandbox (or use test credentials)
3. Enter the sandbox card details (5031 7555 5552 0004)
4. Approve the payment

**Expected:** Redirects to `https://suscipcion-api-kc5t.vercel.app/api/success` (or failure/pending).

> ⚠️ **Known Issue — Broken Redirect Routes:** The files `app/api/{success,failure,pending}/route.ts` contain raw HTML in TypeScript and break `next build`. They are the MP `back_urls` redirect targets. This is a **pre-existing issue** OUT OF SCOPE of this change. The redirect will show a Vercel 404 or build error, but the webhook should still fire. Fix these routes in a separate change.

### Step 3: Verify Webhook Received

**Option A — Vercel Logs:**
1. Go to Vercel → Project → Deployments → select latest → Logs
2. Filter for `/api/webhook`
3. Look for `payment_id` extraction and upsert logs

**Option B — MercadoPago Developers:**
1. Go to [MercadoPago Developers](https://www.mercadopago.com.ar/developers)
2. Select your app → **Webhooks** → **Historial**
3. Verify the payment notification was received and processed (HTTP 200)

**Expected:** Webhook received the `payment` event, extracted `payment_id`, called GET `/v1/payments/{id}`, confirmed `approved` status, upserted `suscripciones` row with `estado: 'activo'` and correct `fecha_expiracion`.

### Step 4: Verify Subscription

```
POST https://suscipcion-api-kc5t.vercel.app/api/verificar
Content-Type: application/json

{
  "client_id": "test-e2e-001"
}
```

**Expected:**
```json
{
  "activo": true,
  "mensaje": "Suscripción activa",
  "fecha_expiracion": "2026-10-15T..."
}
```

### Step 5: Check Supabase Row

In Supabase → Table Editor → `suscripciones`:
- `client_id`: `test-e2e-001`
- `app_id`: `ordo`
- `estado`: `activo`
- `mp_payment_id`: (the payment ID from MercadoPago)
- `fecha_expiracion`: ~30 days from now (for 1_mes plan)

## Rollback Points

Each PR slice can be rolled back independently:

| Slice | Files | Rollback |
|---|---|---|
| **PR A (backend)** | `backend/pricing.py`, `backend/routers/suscripcion.py`, `backend/tests/test_suscripcion_mercadopago.py` | Delete `pricing.py`, revert suscripcion.py hunks, delete test file |
| **PR B (web core)** | `suscripcion-api/lib/mp-contract.ts`, 4 route files, `tsconfig.json` | Delete `mp-contract.ts`, revert route hunks, remove `allowImportingTsExtensions` |
| **PR C (tests + doc)** | `suscripcion-api/tests/mp-contract.test.ts`, `package.json` test script, `E2E_MERCADOPAGO.md`, `.env.example`, `README.md` | Delete test file + doc, revert package.json, revert README |

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---|---|---|
| `MP_ACCESS_TOKEN` missing error (500) | Not set in Vercel env | Add as server-only Secret |
| Webhook returns 500 | `SUPABASE_SERVICE_KEY` missing or wrong | Verify in Vercel env |
| `Unknown app_id` 400 | `app_id` not in `['ordo', 'canyp']` | Check the request body |
| Webhook fires but subscription not updated | Payment status not `approved` | Check MercadoPago dashboard for payment status |
| Redirect shows error | `app/api/{success,failure,pending}/route.ts` broken (pre-existing) | Fix those routes separately |
| Backend port conflict | Port 8000 occupied by `canyp-backend.exe` | Use `--port 8001` |
