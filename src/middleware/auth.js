import jwt from 'jsonwebtoken';

/**
 * Verifies the Bearer JWT from the Authorization header.
 * Attaches decoded payload to req.user.
 * req.user.plan = 'demo' | 'paid'
 */
export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or malformed Authorization header' });
  }

  const token = header.slice(7);
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/**
 * Allows only paid users. Use after requireAuth.
 */
export function requirePaid(req, res, next) {
  if (req.user?.plan !== 'paid') {
    return res.status(403).json({
      error: 'This feature requires a paid plan.',
      upgrade: true,
    });
  }
  next();
}
