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

const JWT_SECRET  = process.env.JWT_SECRET;
if (process.env.NODE_ENV === 'production' && !JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in production.');
}
const signingSecret = JWT_SECRET || 'local-development-only-jwt-secret';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '8h';
const directorOtpChallenges = new Map();
const trustedDevices = new Map();
const TRUSTED_DEVICE_MS = 24 * 60 * 60 * 1000;

function hashPassword(pw) {
  return crypto.createHash('sha256').update(pw).digest('hex');
}

function normalizeDeviceId(deviceId) {
  return String(deviceId || '').trim();
}

function getStaffEmail(staff) {
  return String(process.env.DIRECTOR_EMAIL || staff?.email || '').trim().toLowerCase();
}

function getTrustedDeviceKey(username, deviceId) {
  return `${String(username || '').trim()}:${normalizeDeviceId(deviceId)}`;
}

function isTrustedDevice(username, deviceId) {
  const key = getTrustedDeviceKey(username, deviceId);
  const entry = trustedDevices.get(key);
  return Boolean(entry && entry.expiresAt > Date.now());
}

function clearTrustedDevicesForUser(username) {
  for (const [key, value] of trustedDevices.entries()) {
    if (value && value.username === username) trustedDevices.delete(key);
  }
}

async function sendMailWithFallback(email, subject, html) {
  const resendApiKey = process.env.RESEND_API_KEY;
  if (resendApiKey) {
    try {
      const resend = new Resend(resendApiKey);
      const result = await resend.emails.send({ from: process.env.RESEND_FROM || 'onboarding@resend.dev', to: email, subject, html });
      if (result?.error) throw new Error(result.error.message || 'Resend returned an error');
      return true;
    } catch (error) {
      console.error('[staff-email] Resend delivery failed:', error.message);
    }
  }

  const smtpHost = process.env.SMTP_HOST;
  if (smtpHost) {
    try {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: Number(process.env.SMTP_PORT || 587),
        secure: String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      });
      await transporter.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: email, subject, html });
      return true;
    } catch (error) {
      console.error('[staff-email] SMTP delivery failed:', error.message);
    }
  }

  if (process.env.NODE_ENV !== 'production') {
    console.log(`[staff-email] ${subject} -> ${email}`);
    return 'development';
  }
  return false;
}

async function sendDirectorOtp(email, code) {
  const subject = 'MEFAMDEV Director verification code';
  const html = `<p>Your MEFAMDEV Director verification code is:</p><p style="font-size:28px;font-weight:700;letter-spacing:6px;">${code}</p><p>This code expires in 10 minutes.</p>`;
  const resendApiKey = process.env.RESEND_API_KEY;
  if (resendApiKey) {
    try {
      const resend = new Resend(resendApiKey);
      const result = await resend.emails.send({ from: process.env.RESEND_FROM || 'onboarding@resend.dev', to: email, subject, html });
      if (result?.error) throw new Error(result.error.message || 'Resend returned an error');
      return true;
    } catch (error) {
      console.error('[director-otp] Resend delivery failed:', error.message);
    }
  }

  const smtpHost = process.env.SMTP_HOST;
  if (smtpHost) {
    try {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: Number(process.env.SMTP_PORT || 587),
        secure: String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      });
      await transporter.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to: email, subject, html });
      return true;
    } catch (error) {
      console.error('[director-otp] SMTP delivery failed:', error.message);
    }
  }

  if (process.env.NODE_ENV !== 'production') {
    console.log(`[director-otp] No mail provider configured. Development OTP for ${email}: ${code}`);
    return 'development';
  }
  return false;
}

function buildResetUrl(token, baseUrlOverride) {
  const rawBaseUrl = baseUrlOverride || process.env.APP_BASE_URL || 'http://localhost:3000';

  let baseOrigin = rawBaseUrl;
  try {
    const parsed = new URL(rawBaseUrl);
    baseOrigin = `${parsed.protocol}//${parsed.host}`;
  } catch {
    const cleaned = String(rawBaseUrl || '').replace(/\/[^/]*\.html?$/i, '').replace(/\/$/, '');
    baseOrigin = cleaned || 'http://localhost:3000';
  }

  return `${baseOrigin.replace(/\/$/, '')}/reset_password.html?token=${encodeURIComponent(token)}`;
}

function getApplicantGreeting(app) {
  const displayName = app?.name || 'Applicant';
  const username = app?.portal_username || app?.username || '';
  return username ? `Hello ${displayName} (${username}),` : `Hello ${displayName},`;
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
          <p>${getApplicantGreeting(app)}</p>
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
      <p>${getApplicantGreeting(app)}</p>
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
router.post('/login', async (req, res) => {
  const { username, password, deviceId } = req.body;
  if (!username) return res.status(400).json({ error: 'Username required' });
  if (!password) return res.status(400).json({ error: 'Password required' });

  const staff = await db.prepare('SELECT * FROM staff WHERE username = ?').get(username);
  if (!staff) return res.status(401).json({ error: 'Invalid username or password' });
  if (staff.password !== hashPassword(password)) return res.status(401).json({ error: 'Invalid username or password' });

  if (staff.role === 'director') {
    const email = getStaffEmail(staff);
    if (!email) return res.status(503).json({ error: 'Director email verification is not configured. Set DIRECTOR_EMAIL.' });
    const normalizedDeviceId = normalizeDeviceId(deviceId);
    const trusted = isTrustedDevice(staff.username, normalizedDeviceId);
    if (trusted) {
      const payload = { type: 'staff', id: staff.id, username: staff.username, role: 'director', name: staff.name };
      const token = jwt.sign(payload, signingSecret, { expiresIn: JWT_EXPIRES });
      return res.json({ token, user: payload, trustedDevice: true });
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    const challengeId = crypto.randomBytes(24).toString('hex');
    const sent = sendDirectorOtp(email, code);
    return Promise.resolve(sent).then(delivery => {
      if (!delivery) return res.status(502).json({ error: 'Unable to send Director verification code.' });
      directorOtpChallenges.set(challengeId, {
        username: staff.username,
        codeHash: hashPassword(code),
        expiresAt: Date.now() + 10 * 60 * 1000,
        attempts: 0,
        deviceId: normalizedDeviceId,
      });
      const response = { requiresOtp: true, challengeId, expiresIn: 600, message: `Verification code sent to ${email.replace(/(.{2}).+(@.*)/, '$1***$2')}` };
      if (delivery === 'development') response.developmentOtp = code;
      return res.json(response);
    });
  }

  const payload = { type: 'staff', id: staff.id, username: staff.username, role: staff.role, name: staff.name };
  const token = jwt.sign(payload, signingSecret, { expiresIn: JWT_EXPIRES });
  res.json({ token, user: payload });
});

router.post('/director/verify-otp', async (req, res) => {
  const challengeId = String(req.body?.challengeId || '').trim();
  const otp = String(req.body?.otp || '').trim();
  const deviceId = normalizeDeviceId(req.body?.deviceId);
  const trustDevice = Boolean(req.body?.trustDevice);
  const challenge = directorOtpChallenges.get(challengeId);
  if (!challenge || challenge.expiresAt < Date.now()) {
    directorOtpChallenges.delete(challengeId);
    return res.status(401).json({ error: 'Verification code expired. Sign in again.' });
  }
  challenge.attempts += 1;
  if (challenge.attempts > 5) {
    directorOtpChallenges.delete(challengeId);
    return res.status(429).json({ error: 'Too many verification attempts. Sign in again.' });
  }
  if (hashPassword(otp) !== challenge.codeHash) return res.status(401).json({ error: 'Incorrect verification code.' });

  const staff = await db.prepare('SELECT * FROM staff WHERE username = ?').get(challenge.username);
  directorOtpChallenges.delete(challengeId);
  if (!staff || staff.role !== 'director') return res.status(403).json({ error: 'Director access required.' });

  if (trustDevice && deviceId) {
    trustedDevices.set(getTrustedDeviceKey(staff.username, deviceId), { username: staff.username, expiresAt: Date.now() + TRUSTED_DEVICE_MS });
  }

  const payload = { type: 'staff', id: staff.id, username: staff.username, role: 'director', name: staff.name };
  const token = jwt.sign(payload, signingSecret, { expiresIn: JWT_EXPIRES });
  res.json({ token, user: payload, trustedDevice: Boolean(trustDevice && deviceId) });
});

async function findApplicantByIdentifier(identifier, name) {
  const rows = await db.prepare('SELECT * FROM applications').all();
  if (!identifier) return null;

  const clean = String(identifier).trim();
  const normalized = clean.toLowerCase();
  if (!clean) return null;

  const matchingUsernameRows = rows.filter(row => String(row.portal_username || row.username || '').toLowerCase() === normalized);
  if (matchingUsernameRows.length === 1) return matchingUsernameRows[0];
  if (matchingUsernameRows.length > 1) {
    const normalizedName = String(name || '').trim().toLowerCase();
    if (normalizedName) {
      const byName = matchingUsernameRows.find(row => {
        const nameValue = String(row.name || '').trim().toLowerCase();
        if (!nameValue) return false;
        if (nameValue === normalizedName) return true;
        const normalizedParts = nameValue.split(/\s+/).filter(Boolean);
        return normalizedParts.length > 0 && normalizedParts.every(part => normalizedName.includes(part));
      });
      if (byName) return byName;
    }
    return matchingUsernameRows[0];
  }

  const byRef = clean.replace(/^app-/i, '').trim();
  if (/^\d+$/.test(byRef)) {
    const appById = await db.prepare('SELECT * FROM applications WHERE id = ?').get(byRef);
    if (appById) return appById;
  }

  const normalizeReference = (value) => String(value || '').trim().toLowerCase();
  const compareDigits = (value) => normalizeReference(value).replace(/\D+/g, '');
  const targetDigits = compareDigits(clean);

  const byName = rows.find(row => {
    const nameValue = String(row.name || '').trim().toLowerCase();
    if (!nameValue) return false;
    if (nameValue === normalized) return true;
    const normalizedParts = nameValue.split(/\s+/).filter(Boolean);
    return normalizedParts.length > 0 && normalizedParts.every(part => normalized.includes(part));
  });
  if (byName) return byName;

  return rows.find(row => {
    const reference = normalizeReference(row.reference_number || row.referenceNumber || '');
    if (!reference) return false;
    if (reference === normalized) return true;
    if (targetDigits && compareDigits(reference) === targetDigits) return true;
    return false;
  }) || null;
}

router.post('/lookup', async (req, res) => {
  const identifier = String(req.body?.identifier || req.body?.username || req.body?.refNo || '').trim();
  if (!identifier) return res.status(400).json({ error: 'Reference number or portal username required' });

  const app = await findApplicantByIdentifier(identifier);
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

async function handleForgotPassword(req, res) {
  const email = String(req.body?.email || req.query?.email || '').trim().toLowerCase();
  if (!email) return res.status(400).json({ error: 'Email required' });

  const apps = await db.prepare('SELECT * FROM applications').all();
  const app = apps.find(row => String(row.email || '').trim().toLowerCase() === email);
  if (!app) return res.status(404).json({ error: 'No application found for that email.' });

  const resetToken = crypto.randomBytes(16).toString('hex');
  await db.prepare('UPDATE applications SET reset_token = ? WHERE id = ?').run(resetToken, app.id);

  const sent = await sendPasswordResetEmail(app, resetToken, req);
  if (!sent) return res.status(502).json({ error: 'Unable to send reset email right now.' });

  console.log(`[password-reset] ${email} -> APP-${app.id} token=${resetToken}`);
  return res.json({ ok: true, message: 'Check your email for a reset link.' });
}

router.post('/applicant/forgot-password', handleForgotPassword);
router.get('/applicant/forgot-password', handleForgotPassword);

router.post('/applicant/reset-password', async (req, res) => {
  const token = String(req.body?.token || '').trim();
  const password = String(req.body?.password || '').trim();
  if (!token) return res.status(400).json({ error: 'Reset token required' });
  if (!password) return res.status(400).json({ error: 'New password required' });

  const app = await db.prepare('SELECT * FROM applications WHERE reset_token = ?').get(token);
  if (!app) return res.status(404).json({ error: 'Invalid or expired reset link.' });

  const hashed = crypto.createHash('sha256').update(password).digest('hex');
  await db.prepare('UPDATE applications SET password_hash = ?, reset_token = NULL WHERE id = ?').run(hashed, app.id);
  res.json({ ok: true, message: 'Your password has been reset successfully.' });
});

// ── Applicant portal login ────────────────────────────────────────────────────
router.post('/applicant', async (req, res) => {
  const { refNo, name, password, username } = req.body;
  const identifier = String(username || refNo || '').trim();
  if (!identifier) return res.status(400).json({ error: 'Reference number or portal username required' });

  const app = await findApplicantByIdentifier(identifier, name);
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
  const token = jwt.sign(payload, signingSecret, { expiresIn: JWT_EXPIRES });
  res.json({ token, user: payload });
});

// ── Change staff password ─────────────────────────────────────────────────────
router.post('/change-password', require('../middleware/auth').requireAuth, async (req, res) => {
  if (req.user.type !== 'staff') return res.status(403).json({ error: 'Staff only' });
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) return res.status(400).json({ error: 'Both passwords required' });

  const staff = await db.prepare('SELECT * FROM staff WHERE id = ?').get(req.user.id);
  if (staff.password !== hashPassword(oldPassword)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  await db.prepare('UPDATE staff SET password = ? WHERE id = ?').run(hashPassword(newPassword), req.user.id);
  clearTrustedDevicesForUser(staff.username);

  const email = getStaffEmail(staff);
  if (email) {
    const subject = 'MEFAMDEV staff password changed';
    const html = `
      <p>Hello ${staff.name || staff.username},</p>
      <p>Your MEFAMDEV staff password was changed successfully.</p>
      <p>If you did not make this change, please reset your password immediately and contact the system administrator.</p>
    `;
    await sendMailWithFallback(email, subject, html);
  }

  res.json({ ok: true });
});

router.put('/profile', require('../middleware/auth').requireAuth, async (req, res) => {
  if (req.user.type !== 'staff') return res.status(403).json({ error: 'Staff only' });
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (name.length > 80) return res.status(400).json({ error: 'Name must be 80 characters or fewer' });
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '??';
  await db.prepare('UPDATE staff SET name = ?, initials = ? WHERE id = ?').run(name, initials, req.user.id);
  res.json({ ok: true, user: { name, initials } });
});

router.post('/director/trusted-device/revoke', require('../middleware/auth').requireAuth, async (req, res) => {
  if (req.user.type !== 'staff' || req.user.role !== 'director') return res.status(403).json({ error: 'Director only' });
  const deviceId = normalizeDeviceId(req.body?.deviceId);
  if (deviceId) trustedDevices.delete(getTrustedDeviceKey(req.user.username, deviceId));
  res.json({ ok: true });
});

module.exports = router;
