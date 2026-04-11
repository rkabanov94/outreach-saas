import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth, requirePaid } from '../middleware/auth.js';

const router = Router();

// ── Per-user rate limiter for search (more restrictive than global) ────────────
const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,          // 20 searches/min per IP
  keyGenerator: (req) => req.user?.sub || req.ip,
  message: { error: 'Search rate limit exceeded. Please wait a minute.' },
  skip: (req) => false,
});

// ── Demo limits ───────────────────────────────────────────────────────────────
const DEMO_LIMITS = {
  maxCountries: 1,
  maxKeywords: 1,
};

// ── Core Serper call (server-side, key never leaves this file) ────────────────
async function callSerper(query, gl, hl) {
  const body = { q: query, num: 10 };
  if (gl && /^[a-z]{2}$/.test(gl)) body.gl = gl;
  if (hl && /^[a-z]{2}$/.test(hl)) body.hl = hl;

  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: {
      'X-API-KEY': process.env.SERPER_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Serper error ${res.status}: ${text}`);
  }
  return res.json();
}

// ── POST /api/search ──────────────────────────────────────────────────────────
// Body: { queries: [{ q, gl, hl, label }] }
// Returns: { results: [{ q, gl, label, organic: [...] }] }
router.post('/', requireAuth, searchLimiter, async (req, res) => {
  let { queries } = req.body;
  if (!Array.isArray(queries) || queries.length === 0) {
    return res.status(400).json({ error: 'queries must be a non-empty array' });
  }

  const isPaid = req.user.plan === 'paid';

  // Enforce demo limits
  if (!isPaid) {
    // Limit to 1 country × 1 keyword
    const countrySeen = new Set();
    const filtered = [];
    for (const q of queries) {
      const key = q.gl || '_';
      if (countrySeen.size >= DEMO_LIMITS.maxCountries && !countrySeen.has(key)) continue;
      if (filtered.filter(x => x.gl === key).length >= DEMO_LIMITS.maxKeywords) continue;
      countrySeen.add(key);
      filtered.push(q);
    }
    queries = filtered;
  }

  // Cap absolute number of queries to prevent abuse
  const maxQueries = isPaid ? 200 : 1;
  queries = queries.slice(0, maxQueries);

  const results = [];
  for (const { q, gl, hl, label } of queries) {
    try {
      const data = await callSerper(q, gl, hl || 'en');
      results.push({ q, gl, label, organic: data.organic || [] });
    } catch (err) {
      results.push({ q, gl, label, error: err.message });
    }
    // Small delay between queries to respect Serper's rate limits
    if (queries.length > 1) await sleep(300);
  }

  res.json({ results, demo: !isPaid });
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export default router;
