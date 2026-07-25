const jwt = require('jsonwebtoken');

/**
 * The Next.js dashboard backend (server-side only, never the browser) mints a
 * short-lived JWT signed with CONTROL_API_JWT_SECRET after verifying the
 * caller's Supabase session server-side. This worker only trusts that JWT —
 * it never talks to a browser directly.
 */
function requireAuth(secret) {
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing bearer token' });

    try {
      const payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
      req.admin = payload; // { sub: profileId, role }
      next();
    } catch (err) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  };
}

module.exports = { requireAuth };
