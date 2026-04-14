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

const NOISE = [
  'example.com', 'sentry.io', 'schema.org', 'wixpress.com', 'cloudflare.com',
  'amazonaws.com', 'jsdelivr.net', 'github.com', 'noreply', 'no-reply',
  '@2x', '@3x', 'jquery', 'webpack', 'postcss', 'babel', 'eslint',
  '.png', '.jpg', '.gif', '.svg', '.ico', '.webp', '.css', '.js', '.woff',
];

const SKIP_DOMAINS = [
  'wikipedia.org', 'youtube.com', 'reddit.com', 'play.google.com',
  'apps.apple.com', 'amazon.', 'quora.com', 'medium.com', 'google.com',
  'twitter.com', 'facebook.com', 'linkedin.com', 'instagram.com', 'apple.com',
];

function cleanEmails(text) {
  return [...new Set(
    (text.match(EMAIL_RE) || []).filter(e => {
      const lower = e.toLowerCase();
      return !NOISE.some(n => lower.includes(n.toLowerCase()));
    })
  )];
}

// Decode common email obfuscation techniques
function decodeObfuscated(html) {
  return html
    .replace(/&amp;/g, '&')
    .replace(/&#64;/gi, '@')
    .replace(/&#x40;/gi, '@')
    .replace(/\[at\]/gi, '@')
    .replace(/\s*\(at\)\s*/gi, '@')
    .replace(/\s+at\s+(?=[a-z0-9.-]+\s*[\[\(]?dot[\]\)]?\s*[a-z]{2,})/gi, '@')
    .replace(/\[dot\]/gi, '.')
    .replace(/\s*\(dot\)\s*/gi, '.')
    .replace(/&#46;/gi, '.')
    // Remove HTML tags but keep text content
    .replace(/<[^>]+>/g, ' ')
    // Collapse whitespace
    .replace(/\s+/g, ' ');
}

async function fetchPage(url, timeout = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function scrapeEmails(domain) {
  // Priority order — contact/about pages first, then legal pages which often have real emails
  const pages = [
    `https://${domain}/contact`,
    `https://${domain}/contact-us`,
    `https://${domain}/about`,
    `https://${domain}/about-us`,
    `https://${domain}/team`,
    `https://${domain}/advertise`,
    `https://${domain}/advertise-with-us`,
    `https://${domain}/terms`,
    `https://${domain}/terms-of-service`,
    `https://${domain}/terms-and-conditions`,
    `https://${domain}/privacy`,
    `https://${domain}/privacy-policy`,
    `https://${domain}/imprint`,
    `https://${domain}/impressum`,
    `https://${domain}/legal`,
    `https://${domain}`,
  ];

  const emailSet = new Set();

  for (const url of pages) {
    const html = await fetchPage(url);
    if (!html) continue;

    const decoded = decodeObfuscated(html);
    const found = cleanEmails(decoded);
    found.forEach(e => emailSet.add(e));

    // If we found good emails on contact/about pages, stop early
    const earlyStopPages = ['/contact', '/contact-us', '/about', '/about-us', '/team'];
    if (emailSet.size > 0 && earlyStopPages.some(p => url.endsWith(p))) break;
  }

  return [...emailSet];
}

// ── POST /api/scrape ──────────────────────────────────────────────────────────
router.post('/', optionalAuth, dailyAnonScrapeLimiter, scrapeLimiter, async (req, res) => {
  const { domain } = req.body;
  if (!domain || typeof domain !== 'string')
    return res.status(400).json({ error: 'domain is required' });

  if (SKIP_DOMAINS.some(d => domain.includes(d)))
    return res.json({ emails: [] });

  const emails = await scrapeEmails(domain);
  res.json({ emails });
});

// ── POST /api/scrape/google — Serper fallback ─────────────────────────────────
router.post('/google', optionalAuth, dailyAnonScrapeLimiter, scrapeLimiter, async (req, res) => {
  const { domain } = req.body;
  if (!domain) return res.status(400).json({ error: 'domain is required' });

  try {
    const response = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': process.env.SERPER_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: `"${domain}" email contact`, num: 10 }),
    });
    if (!response.ok) return res.json({ emails: [] });

    const data = await response.json();
    let text = '';
    if (data.answerBox) text += JSON.stringify(data.answerBox) + ' ';
    if (data.knowledgeGraph) text += JSON.stringify(data.knowledgeGraph) + ' ';
    for (const r of (data.organic || [])) {
      text += (r.snippet || '') + ' ' + (r.title || '') + ' ';
    }

    res.json({ emails: cleanEmails(decodeObfuscated(text)) });
  } catch {
    res.json({ emails: [] });
  }
});

export default router;
