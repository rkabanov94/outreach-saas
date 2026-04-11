# Outreach Backend — API Proxy + Auth + Billing

Express.js backend that:
- **Hides the Serper API key** from the browser
- **Authenticates users** via Supabase + JWT
- **Enforces demo limits** (1 country, 1 keyword, search only)
- **Handles Stripe subscriptions** for paid access

---

## Stack

| Layer | Service |
|-------|---------|
| Runtime | Node.js 20 + Express |
| Database / Auth | Supabase |
| Payments | Stripe |
| Deploy | Vercel (or Railway) |

---

## Quick Start

### 1. Clone and install

```bash
git clone <your-repo>
cd outreach-backend
npm install
```

### 2. Set up Supabase

1. Create a new project at https://supabase.com
2. Go to **SQL Editor** and run the contents of `supabase-migration.sql`
3. Copy your **Project URL** and **service_role key** from Project Settings → API

### 3. Set up Stripe

1. Create a product + monthly price at https://dashboard.stripe.com/products
2. Copy the **Price ID** (starts with `price_`)
3. Add a webhook endpoint: `https://your-backend.vercel.app/api/billing/webhook`
   - Events to listen for: `checkout.session.completed`, `customer.subscription.deleted`, `invoice.payment_failed`
4. Copy the **Webhook signing secret** (starts with `whsec_`)

### 4. Configure environment

```bash
cp .env.example .env
# Fill in all values in .env
```

### 5. Run locally

```bash
npm run dev
# → http://localhost:3001
```

---

## Deploy to Vercel

```bash
npm i -g vercel
vercel login
vercel --prod

# Set env vars (do NOT commit .env to git):
vercel env add SERPER_API_KEY
vercel env add SUPABASE_URL
vercel env add SUPABASE_SERVICE_ROLE_KEY
vercel env add JWT_SECRET
vercel env add STRIPE_SECRET_KEY
vercel env add STRIPE_WEBHOOK_SECRET
vercel env add STRIPE_PRICE_ID
vercel env add CLIENT_URL
```

## Deploy to Railway (alternative)

1. Push code to GitHub
2. New project → Deploy from GitHub repo
3. Add environment variables in the Railway dashboard
4. Railway auto-detects Node.js and runs `npm start`

---

## API Reference

### Auth

| Method | Path | Body | Auth required |
|--------|------|------|---------------|
| POST | `/api/auth/register` | `{ email, password }` | No |
| POST | `/api/auth/login` | `{ email, password }` | No |
| GET | `/api/auth/me` | — | Yes |

**Response** (register / login):
```json
{ "token": "eyJ...", "plan": "demo" }
```

Store the token in `localStorage` and send it as `Authorization: Bearer <token>` on every request.

---

### Search (Serper proxy)

| Method | Path | Body | Plan |
|--------|------|------|------|
| POST | `/api/search` | `{ queries: [...] }` | demo (limited) / paid (full) |

**Query object:**
```json
{ "q": "crypto wallet", "gl": "es", "hl": "en", "label": "🇪🇸 Spain" }
```

**Demo limits:** 1 country × 1 keyword per request.

**Response:**
```json
{
  "results": [{ "q": "...", "gl": "es", "label": "Spain", "organic": [...] }],
  "demo": true
}
```

---

### Scrape

| Method | Path | Body | Plan |
|--------|------|------|------|
| POST | `/api/scrape` | `{ domain: "example.com" }` | demo + paid |
| POST | `/api/scrape/google` | `{ domain: "example.com" }` | paid only |

**Response:**
```json
{ "emails": ["info@example.com", "contact@example.com"] }
```

---

### Billing

| Method | Path | Body | Auth |
|--------|------|------|------|
| POST | `/api/billing/checkout` | — | Yes |
| POST | `/api/billing/portal` | — | Yes |
| POST | `/api/billing/webhook` | (Stripe event) | No (verified by signature) |

**Checkout response:**
```json
{ "url": "https://checkout.stripe.com/pay/cs_..." }
```
Redirect the user to this URL.

---

## Frontend integration (key snippet)

```js
// Replace your direct Serper call with this:
async function apiSearch(queries, token) {
  const res = await fetch('https://your-backend.vercel.app/api/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ queries }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
```

---

## Security checklist

- [ ] `SERPER_API_KEY` is never in the frontend
- [ ] `SUPABASE_SERVICE_ROLE_KEY` is never in the frontend
- [ ] `JWT_SECRET` is a random 64-char hex string
- [ ] Stripe webhook signature is verified on every event
- [ ] Rate limiters are active (20 searches/min per user)
- [ ] CORS only allows your frontend origin
