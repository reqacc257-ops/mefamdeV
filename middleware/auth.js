/**
 * middleware/auth.js
 * Verifies the JWT token sent in the Authorization header.
 * Usage: app.use('/api/protected', requireAuth, router)
 */
const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.JWT_SECRET || 'mefamdev-secret-change-in-production';
function requireAuth(req, res, next) {
  if (req.user) return next();
  const header = req.headers['authorization'];
  if (!header) return res.status(401).json({ error: 'No token provided' });
  const token = header.startsWith('Bearer ') ? header.slice(7) : header;
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user?.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}
module.exports = { requireAuth, requireRole };
