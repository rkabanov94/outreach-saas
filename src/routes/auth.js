import { Router } from 'express';
import jwt from 'jsonwebtoken';
import supabase from '../lib/supabase.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// ── Helper: sign a JWT for a user ────────────────────────────────────────────
function signToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      plan: user.plan || 'demo',
    },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// ── POST /api/auth/register ───────────────────────────────────────────────────
router.post('/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  // Create user in Supabase Auth
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,   // skip email verification for now; remove if you want confirmation emails
  });

  if (error) {
    return res.status(400).json({ error: error.message });
  }

  // Insert profile row with default 'demo' plan
  await supabase.from('profiles').insert({
    id: data.user.id,
    email: data.user.email,
    plan: 'demo',
  });

  const token = signToken({ id: data.user.id, email: data.user.email, plan: 'demo' });
  res.json({ token, plan: 'demo' });
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  // Authenticate with Supabase
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  // Fetch plan from profiles table
  const { data: profile } = await supabase
    .from('profiles')
    .select('plan')
    .eq('id', data.user.id)
    .single();

  const plan = profile?.plan || 'demo';
  const token = signToken({ id: data.user.id, email: data.user.email, plan });
  res.json({ token, plan });
});

// ── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get('/me', requireAuth, async (req, res) => {
  const { data: profile } = await supabase
    .from('profiles')
    .select('email, plan, stripe_customer_id')
    .eq('id', req.user.sub)
    .single();

  res.json({ user: profile || { email: req.user.email, plan: req.user.plan } });
});

export default router;
