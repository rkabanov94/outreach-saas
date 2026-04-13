import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';

const router = Router();

const scrapeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  keyGenerator: (req) => req.user?.sub || req.ip,
  message: { error: 'Rate limit exceeded. Please wait a minute.' },
});

// Anon: 1 scrape per day per IP
const dailyAnonScrapeLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  max: 1,
  keyGenerator: (req) => `scrapeanon:${req.ip}`,
  skip: (req) => req.user?.plan === 'paid',
  message: { error: 'Daily demo limit reached. Sign up to get full access.', upgrade: true },
});

function optionalAuth(req, res, next) {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    try { req.user = jwt.verify(header.slice(7), process.env.JWT_SECRET); }
    catch {}
  }
  if (!req.user) req.user = { plan: 'demo', sub: null };
  next();
}

const EMAIL_RE = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
const NOISE = ['example.com','sentry','schema.org','@2x','@3x','wixpress','cloudflare',
               'amazonaws','jsdelivr','github','noreply','no-reply','@gmail.com','@yahoo','@hotmail'];
const SKIP_DOMAINS = ['wikipedia.org','youtube.com','reddit.com','play.google.com',
  'apps.apple.com','amazon.','quora.com','medium.com','google.com',
  'twitter.com','facebook.com','linkedin.com','instagram.com','apple.com'];

function cleanEmails(text) {
  return [...new Set(
    (text.match(EMAIL_RE) || []).filter(e =>
      !e.match(/\.(png|jpg|gif|svg|ico|webp|css|js)$/) &&
      !NOISE.some(n => e.toLowerCase().includes(n))
    )
  )];
}

async function fetchPage(url, timeout = 7000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; OutreachBot/1.0)', 'Accept': 'text/html' },
    });
    return await res.text();
  } finally { clearTimeout(timer); }
}

router.post('/', optionalAuth, dailyAnonScrapeLimiter, scrapeLimiter, async (req, res) => {
  const { domain } = req.body;
  if (!domain || typeof domain !== 'string')
    return res.status(400).json({ error: 'domain is required' });

  if (SKIP_DOMAINS.some(d => domain.includes(d)))
    return res.json({ emails: [] });

  const pages = [
    `https://${domain}/contact`,
    `https://${domain}/contact-us`,
    `https://${domain}/about`,
    `https://${domain}/about-us`,
    `https://${domain}`,
  ];

  const emailSet = new Set();
  for (const url of pages) {
    try {
      const html = await fetchPage(url);
      const decoded = html
        .replace(/&amp;/g, '&').replace(/&#64;/g, '@')
        .replace(/\[at\]/gi, '@').replace(/\s*\(at\)\s*/gi, '@')
        .replace(/\[dot\]/gi, '.').replace(/\s*\(dot\)\s*/gi, '.');
      cleanEmails(decoded).forEach(e => emailSet.add(e));
    } catch {}
    if (emailSet.size > 0) break;
  }

  res.json({ emails: [...emailSet] });
});

router.post('/google', optionalAuth, dailyAnonScrapeLimiter, scrapeLimiter, async (req, res) => {
  const { domain } = req.body;
  if (!domain) return res.status(400).json({ error: 'domain is required' });

  const response = await fetch('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': process.env.SERPER_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: `${domain} contact email`, num: 10 }),
  });
  if (!response.ok) return res.json({ emails: [] });

  const data = await response.json();
  let text = '';
  if (data.answerBox) text += JSON.stringify(data.answerBox) + ' ';
  if (data.knowledgeGraph) text += JSON.stringify(data.knowledgeGraph) + ' ';
  for (const r of (data.organic || [])) text += (r.snippet || '') + ' ';

  res.json({ emails: cleanEmails(text) });
});

export default router;
