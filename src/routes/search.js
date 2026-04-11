import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';

const router = Router();

const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  keyGenerator: (req) => req.user?.sub || req.ip,
  message: { error: 'Search rate limit exceeded. Please wait a minute.' },
});

const DEMO_LIMITS = { maxCountries: 1, maxKeywords: 3 };

function optionalAuth(req, res, next) {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try { req.user = jwt.verify(header.slice(7), process.env.JWT_SECRET); }
    catch { /* invalid — treat as anon */ }
  }
  if (!req.user) req.user = { plan: 'demo', sub: null };
  next();
}

async function callSerper(query, gl, hl) {
  const body = { q: query, num: 10 };
  if (gl && /^[a-z]{2}$/.test(gl)) body.gl = gl;
  if (hl && /^[a-z]{2}$/.test(hl)) body.hl = hl;
  const res = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': process.env.SERPER_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Serper error ${res.status}: ${await res.text()}`);
  return res.json();
}

router.post('/', optionalAuth, searchLimiter, async (req, res) => {
  let { queries } = req.body;
  if (!Array.isArray(queries) || queries.length === 0)
    return res.status(400).json({ error: 'queries must be a non-empty array' });

  const isPaid = req.user?.plan === 'paid';

  if (!isPaid) {
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

  queries = queries.slice(0, isPaid ? 200 : DEMO_LIMITS.maxKeywords);

  const results = [];
  for (const { q, gl, hl, label } of queries) {
    try {
      const data = await callSerper(q, gl, hl || 'en');
      results.push({ q, gl, label, organic: data.organic || [] });
    } catch (err) {
      results.push({ q, gl, label, error: err.message });
    }
    if (queries.length > 1) await sleep(300);
  }

  res.json({ results, demo: !isPaid });
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
export default router;
