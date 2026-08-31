/**
 * middleware/auth.js
 * Verifies the JWT token sent in the Authorization header.
 * Usage: app.use('/api/protected', requireAuth, router)
 */
const jwt = require('jsonwebtoken');
const staffSessions = require('../lib/staff-sessions');
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
    if (req.user.type === 'staff' && req.user.sid && !staffSessions.isActiveSession(req.user.username, req.user.sid, req.user.exp)) {
      return res.status(401).json({ error: 'Staff session is no longer active' });
    }
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });

    const tokenType = req.user.type;
    const role = req.user.role || (tokenType === 'staff' ? 'staff' : null);
    const isStaff = tokenType === 'staff' || (tokenType !== 'applicant' && Boolean(role));

    if (!isStaff || !roles.includes(role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}
module.exports = { requireAuth, requireRole };
