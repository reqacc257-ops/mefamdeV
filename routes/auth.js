/**
 * routes/auth.js
 * POST /api/auth/login   — staff login (username + password)
 * POST /api/auth/applicant — applicant portal login (ref no + name)
 */

const router = require('express').Router();
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { Resend } = require('resend');
const db = require('../db');

const JWT_SECRET  = process.env.JWT_SECRET  || 'mefamdev-secret-change-in-production';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '8h';

function hashPassword(pw) {
  return crypto.createHash('sha256').update(pw).digest('hex');
}

function buildResetUrl(token, baseUrlOverride) {
  const baseUrl = baseUrlOverride || process.env.APP_BASE_URL || 'http://localhost:3000';
  return `${baseUrl.replace(/\/$/, '')}/reset_password.html?token=${encodeURIComponent(token)}`;
}

async function sendPasswordResetEmail(app, token, req) {
  const baseUrl = process.env.APP_BASE_URL || (req && req.protocol && req.get('host') ? `${req.protocol}://${req.get('host')}` : 'http://localhost:3000');
  const resetUrl = buildResetUrl(token, baseUrl);
  const resendApiKey = process.env.RESEND_API_KEY;
  if (resendApiKey) {
    try {
      const resend = new Resend(resendApiKey);
      const result = await resend.emails.send({
        from: process.env.RESEND_FROM || 'onboarding@resend.dev',
        to: app.email,
        subject: 'MEFAMDEV password reset request',
        html: `
          <p>Hello ${app.name || 'applicant'},</p>
          <p>We received a request to reset your applicant portal password.</p>
          <p>Use the button below to choose a new password and continue accessing your MEFAMDEV account.</p>
          <p><a href="${resetUrl}" style="display:inline-block;padding:10px 16px;background:#1a2e44;color:#ffffff;text-decoration:none;border-radius:8px;">Reset my password</a></p>
          <p>If you did not make this request, you can safely ignore this email.</p>
        `,
      });
      if (result?.error) {
        throw new Error(result.error.message || 'Resend returned an error');
      }
      return true;
    } catch (error) {
      console.error('[password-reset] Resend delivery failed:', error.message);
    }
  }

  const smtpHost = process.env.SMTP_HOST;
  if (!smtpHost) {
    console.log(`[password-reset] No mail provider configured. Reset link: ${resetUrl}`);
    return true;
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  const mailOptions = {
    from: process.env.SMTP_FROM || process.env.SMTP_USER || 'mefamdev@example.com',
    to: app.email,
    subject: 'MEFAMDEV password reset request',
    html: `
      <p>Hello ${app.name || 'applicant'},</p>
      <p>We received a request to reset your applicant portal password.</p>
      <p>Use the button below to choose a new password and continue accessing your MEFAMDEV account.</p>
      <p><a href="${resetUrl}" style="display:inline-block;padding:10px 16px;background:#1a2e44;color:#ffffff;text-decoration:none;border-radius:8px;">Reset my password</a></p>
      <p>If you did not make this request, you can safely ignore this email.</p>
    `,
  };

  try {
    await transporter.sendMail(mailOptions);
    return true;
  } catch (error) {
    console.error('[password-reset] Email delivery failed:', error.message);
    return false;
  }
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

router.post('/applicant/forgot-password', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'Email required' });

  const apps = db.prepare('SELECT * FROM applications').all();
  const app = apps.find(row => String(row.email || '').trim().toLowerCase() === email);
  if (!app) return res.status(404).json({ error: 'No application found for that email.' });

  const resetToken = crypto.randomBytes(16).toString('hex');
  db.prepare('UPDATE applications SET reset_token = ? WHERE id = ?').run(resetToken, app.id);

  const sent = await sendPasswordResetEmail(app, resetToken, req);
  if (!sent) return res.status(502).json({ error: 'Unable to send reset email right now.' });

  console.log(`[password-reset] ${email} -> APP-${app.id} token=${resetToken}`);
  res.json({ ok: true, message: 'Check your email for a reset link.' });
});

router.post('/applicant/reset-password', (req, res) => {
  const token = String(req.body?.token || '').trim();
  const password = String(req.body?.password || '').trim();
  if (!token) return res.status(400).json({ error: 'Reset token required' });
  if (!password) return res.status(400).json({ error: 'New password required' });

  const app = db.prepare('SELECT * FROM applications WHERE reset_token = ?').get(token);
  if (!app) return res.status(404).json({ error: 'Invalid or expired reset link.' });

  const hashed = crypto.createHash('sha256').update(password).digest('hex');
  db.prepare('UPDATE applications SET password_hash = ?, reset_token = NULL WHERE id = ?').run(hashed, app.id);
  res.json({ ok: true, message: 'Your password has been reset successfully.' });
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
