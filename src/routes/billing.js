import { Router } from 'express';
import Stripe from 'stripe';
import supabase from '../lib/supabase.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// ── POST /api/billing/checkout ────────────────────────────────────────────────
// Creates a Stripe Checkout session and returns the URL
router.post('/checkout', requireAuth, async (req, res) => {
  const userId = req.user.sub;
  const email  = req.user.email;

  // Get or create Stripe customer
  let { data: profile } = await supabase
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', userId)
    .single();

  let customerId = profile?.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({ email, metadata: { supabase_id: userId } });
    customerId = customer.id;
    await supabase.from('profiles').update({ stripe_customer_id: customerId }).eq('id', userId);
  }

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    payment_method_types: ['card'],
    mode: 'subscription',
    line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
    success_url: `${process.env.CLIENT_URL}/?payment=success`,
    cancel_url:  `${process.env.CLIENT_URL}/?payment=cancelled`,
    allow_promotion_codes: true,
  });

  res.json({ url: session.url });
});

// ── POST /api/billing/portal ──────────────────────────────────────────────────
// Opens the Stripe customer portal (cancel, update card, etc.)
router.post('/portal', requireAuth, async (req, res) => {
  const userId = req.user.sub;
  const { data: profile } = await supabase
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', userId)
    .single();

  if (!profile?.stripe_customer_id) {
    return res.status(400).json({ error: 'No billing account found' });
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: profile.stripe_customer_id,
    return_url: process.env.CLIENT_URL,
  });

  res.json({ url: session.url });
});

// ── POST /api/billing/webhook ─────────────────────────────────────────────────
// Stripe sends events here. Must use raw body (mounted before express.json).
router.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).json({ error: 'Invalid webhook signature' });
  }

  const session = event.data.object;

  switch (event.type) {
    case 'checkout.session.completed': {
      // Subscription created — upgrade user to paid
      const customerId = session.customer;
      await upgradePlan(customerId, 'paid', session.subscription);
      break;
    }
    case 'customer.subscription.deleted': {
      // Subscription cancelled / expired
      const customerId = session.customer;
      await upgradePlan(customerId, 'demo', null);
      break;
    }
    case 'invoice.payment_failed': {
      // Optional: notify user or downgrade
      console.warn('Payment failed for customer:', session.customer);
      break;
    }
  }

  res.json({ received: true });
});

async function upgradePlan(stripeCustomerId, plan, subscriptionId) {
  const update = { plan };
  if (subscriptionId) update.stripe_subscription_id = subscriptionId;

  const { error } = await supabase
    .from('profiles')
    .update(update)
    .eq('stripe_customer_id', stripeCustomerId);

  if (error) console.error('Failed to update plan:', error);
  else console.log(`✓ Plan updated to '${plan}' for customer ${stripeCustomerId}`);
}

export default router;
