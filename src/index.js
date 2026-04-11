import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';

import authRoutes from './routes/auth.js';
import searchRoutes from './routes/search.js';
import scrapeRoutes from './routes/scrape.js';
import billingRoutes from './routes/billing.js';

const app = express();

// ── CORS ──────────────────────────────────────────────────────────────────────
const allowedOrigins = [
  process.env.CLIENT_URL,
  'http://localhost:3000',
  'http://localhost:5173',
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (curl, Postman, same-origin)
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

// ── Body parsing ──────────────────────────────────────────────────────────────
// Stripe webhooks need raw body — mount before json()
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '1mb' }));

// ── Global rate limiter (per IP) ──────────────────────────────────────────────
app.use(rateLimit({
  windowMs: 60 * 1000,   // 1 minute
  max: 60,               // 60 requests/min per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down.' },
}));

// ── Routes ─────────────────────────────────────────────────────────────────────
app.use('/api/auth',    authRoutes);
app.use('/api/search',  searchRoutes);
app.use('/api/scrape',  scrapeRoutes);
app.use('/api/billing', billingRoutes);

// ── Health check ───────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ ok: true }));

// ── Error handler ──────────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`✓ Outreach backend listening on :${PORT}`));
