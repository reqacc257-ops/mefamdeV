/**
 * routes/auth.js
 * POST /api/auth/login   — staff login (username + password)
 * POST /api/auth/applicant — applicant portal login (ref no + name)
 */

const router = require('express').Router();
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const db = require('../db');

const JWT_SECRET  = process.env.JWT_SECRET  || 'mefamdev-secret-change-in-production';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '8h';

function hashPassword(pw) {
  return crypto.createHash('sha256').update(pw).digest('hex');
}

// ── Staff login ───────────────────────────────────────────────────────────────
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username) return res.status(400).json({ error: 'Username required' });
  if (!password) return res.status(400).json({ error: 'Password required' });

  const staff = db.prepare('SELECT * FROM staff WHERE username = ?').get(username);
  if (!staff) return res.status(401).json({ error: 'Invalid username or password' });
  if (staff.password !== hashPassword(password)) return res.status(401).json({ error: 'Invalid username or password' });

  const payload = { type: 'staff', id: staff.id, username: staff.username, role: staff.role, name: staff.name };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
  res.json({ token, user: payload });
});

function findApplicantByIdentifier(identifier) {
  const rows = db.prepare('SELECT * FROM applications').all();
  if (!identifier) return null;

  const clean = String(identifier).trim();
  const normalized = clean.toLowerCase();

  if (!clean) return null;

  const byUsername = rows.find(row => String(row.portal_username || '').toLowerCase() === normalized);
  if (byUsername) return byUsername;

  const byRef = clean.replace(/^app-/i, '').trim();
  if (/^\d+$/.test(byRef)) {
    return db.prepare('SELECT * FROM applications WHERE id = ?').get(byRef);
  }

  return null;
}

router.post('/lookup', (req, res) => {
  const identifier = String(req.body?.identifier || req.body?.username || req.body?.refNo || '').trim();
  if (!identifier) return res.status(400).json({ error: 'Reference number or portal username required' });

  const app = findApplicantByIdentifier(identifier);
  if (!app) return res.status(404).json({ error: 'Application not found' });

  res.json({
    ok: true,
    applicant: {
      id: app.id,
      name: app.name,
      username: app.portal_username || null,
      status: app.status,
    }
  });
});

// ── Applicant portal login ────────────────────────────────────────────────────
router.post('/applicant', (req, res) => {
  const { refNo, name, password, username } = req.body;
  const identifier = String(username || refNo || '').trim();
  if (!identifier) return res.status(400).json({ error: 'Reference number or portal username required' });

  const app = findApplicantByIdentifier(identifier);
  if (!app) return res.status(404).json({ error: 'Application not found' });

  if (!app) return res.status(404).json({ error: 'Application not found' });

  // Lenient name check (if provided)
  if (name && name.trim().length > 2) {
    const fn = (app.name || '').toLowerCase();
    const parts = fn.split(/[\s,]+/);
    const input = name.trim().toLowerCase();
    const match = parts.some(p => p && input.includes(p)) || fn.includes(input);
    if (!match) return res.status(401).json({ error: 'Name does not match application on file' });
  }

  // If a password is set, require it; if none is set, reject an entered password
  if (app.password_hash) {
    const hashed = crypto.createHash('sha256').update(String(password || '')).digest('hex');
    if (!password || hashed !== app.password_hash) return res.status(401).json({ error: 'Invalid password' });
  } else if (password) {
    return res.status(401).json({ error: 'No application password is set. Leave the password blank to continue.' });
  }

  const payload = { type: 'applicant', appId: app.id, name: app.name };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES });
  res.json({ token, user: payload });
});

// ── Change staff password ─────────────────────────────────────────────────────
router.post('/change-password', require('../middleware/auth').requireAuth, (req, res) => {
  if (req.user.type !== 'staff') return res.status(403).json({ error: 'Staff only' });
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) return res.status(400).json({ error: 'Both passwords required' });

  const staff = db.prepare('SELECT * FROM staff WHERE id = ?').get(req.user.id);
  if (staff.password !== hashPassword(oldPassword)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  db.prepare('UPDATE staff SET password = ? WHERE id = ?').run(hashPassword(newPassword), req.user.id);
  res.json({ ok: true });
});

module.exports = router;
