/**
 * middleware/auth.js
 * Verifies the JWT token sent in the Authorization header.
 * Usage: app.use('/api/protected', requireAuth, router)
 */
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET;
if (process.env.NODE_ENV === 'production' && !JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in production.');
}
const signingSecret = JWT_SECRET || 'local-development-only-jwt-secret';
function requireAuth(req, res, next) {
  const header = req.headers['authorization'];
  if (!header) return res.status(401).json({ error: 'No token provided' });
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return res.status(401).json({ error: 'Invalid authorization header' });
  const token = match[1].trim();
  if (!token) return res.status(401).json({ error: 'Invalid authorization header' });
  try {
    req.user = jwt.verify(token, signingSecret);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (req.user.type !== 'staff' || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}
module.exports = { requireAuth, requireRole };
