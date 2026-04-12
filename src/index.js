import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';

import authRoutes    from './routes/auth.js';
import searchRoutes  from './routes/search.js';
import scrapeRoutes  from './routes/scrape.js';
import billingRoutes from './routes/billing.js';

const app = express();

// ── CORS ──────────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  'https://outreachminer.com',
  'https://www.outreachminer.com',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:3001',
];

app.use(cors({
  origin: (origin, cb) => {
    // No origin = same-origin request (curl, server-to-server) — allow
    if (!origin) return cb(null, true);
    // Exact match
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    // Any Vercel preview deploy for this project
    if (/^https:\/\/outreach-saas[a-z0-9\-]*\.vercel\.app$/.test(origin)) return cb(null, true);
    // Reject everything else
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '1mb' }));

// ── Global rate limiter ───────────────────────────────────────────────────────
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down.' },
}));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth',    authRoutes);
app.use('/api/search',  searchRoutes);
app.use('/api/scrape',  scrapeRoutes);
app.use('/api/billing', billingRoutes);

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// ── CORS debug — shows what origin was received ───────────────────────────────
app.get('/cors-debug', (req, res) => {
  res.json({ origin: req.headers.origin || 'none', host: req.headers.host });
});

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error(err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`✓ OutreachMiner backend :${PORT}`));
