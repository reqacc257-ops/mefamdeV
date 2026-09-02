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
const staffSessions = require('../lib/staff-sessions');

const JWT_SECRET  = process.env.JWT_SECRET;
if (process.env.NODE_ENV === 'production' && !JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in production.');
}
const signingSecret = JWT_SECRET || 'local-development-only-jwt-secret';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '8h';
const directorOtpChallenges = new Map();
const trustedDevices = new Map();
const TRUSTED_DEVICE_MS = 24 * 60 * 60 * 1000;

function isDirectorVerificationEnabled() {
  const value = process.env.DIRECTOR_VERIFICATION_ENABLED;
  if (value === undefined) return false;
  return String(value).toLowerCase() === 'true';
}

function hashPassword(pw) {
  return crypto.createHash('sha256').update(pw).digest('hex');
}

function issueStaffToken(staff) {
  const sessionId = crypto.randomBytes(24).toString('hex');
  const payload = { type: 'staff', id: staff.id, username: staff.username, role: staff.role, name: staff.name, sid: sessionId };
  const token = jwt.sign(payload, signingSecret, { expiresIn: JWT_EXPIRES });
  const decoded = jwt.decode(token);
  staffSessions.createSession(staff.username, sessionId, decoded.exp * 1000);
  return { token, payload };
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

// ── Unified login (staff or applicant) ────────────────────────────────────────
router.post('/login', async (req, res) => {
  const { username, password, deviceId } = req.body;
  if (!username) return res.status(400).json({ error: 'Username required' });
  if (!password) return res.status(400).json({ error: 'Password required' });

  // Try staff login first
  const staff = await db.prepare('SELECT * FROM staff WHERE username = ?').get(username);
  if (staff && staff.password === hashPassword(password)) {
    if (staffSessions.hasActiveSession(staff.username)) return res.status(409).json({ error: 'This staff account is already logged in on another device or browser.' });

    if (staff.role === 'director' && isDirectorVerificationEnabled()) {
      const email = getStaffEmail(staff);
      if (!email) return res.status(503).json({ error: 'Director email verification is not configured. Set DIRECTOR_EMAIL.' });
      const normalizedDeviceId = normalizeDeviceId(deviceId);
      const trusted = isTrustedDevice(staff.username, normalizedDeviceId);
      if (trusted) {
        const issued = issueStaffToken({ ...staff, role: 'director' });
        return res.json({ token: issued.token, user: issued.payload, trustedDevice: true });
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

    const issued = issueStaffToken(staff);
    return res.json({ token: issued.token, user: issued.payload });
  }

  // Try applicant login
  const apps = await db.prepare('SELECT * FROM applications').all();
  const app = apps.find(row => String(row.portal_username || row.username || '').toLowerCase() === username.toLowerCase());
  
  if (!app) return res.status(401).json({ error: 'Invalid username or password' });

  // Check password
  if (app.password_hash) {
    const hashed = crypto.createHash('sha256').update(String(password || '')).digest('hex');
    if (!password || hashed !== app.password_hash) return res.status(401).json({ error: 'Invalid username or password' });
  } else if (password) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const payload = { type: 'applicant', appId: app.id, name: app.name };
  const token = jwt.sign(payload, signingSecret, { expiresIn: JWT_EXPIRES });
  return res.json({ token, user: payload });
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
  if (staffSessions.hasActiveSession(staff.username)) return res.status(409).json({ error: 'This staff account is already logged in on another device or browser.' });

  if (trustDevice && deviceId) {
    trustedDevices.set(getTrustedDeviceKey(staff.username, deviceId), { username: staff.username, expiresAt: Date.now() + TRUSTED_DEVICE_MS });
  }

  const issued = issueStaffToken({ ...staff, role: 'director' });
  res.json({ token: issued.token, user: issued.payload, trustedDevice: Boolean(trustDevice && deviceId) });
});

router.post('/logout', require('../middleware/auth').requireAuth, (req, res) => {
  if (req.user?.type === 'staff' && req.user.username && req.user.sid) {
    staffSessions.revokeSession(req.user.username, req.user.sid);
  }
  res.json({ ok: true });
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
  const referenceNumber = String(req.body?.referenceNumber || req.body?.reference_number || req.query?.referenceNumber || req.query?.reference_number || '').trim();
  if (!email) return res.status(400).json({ error: 'Email required' });
  if (!referenceNumber) return res.status(400).json({ error: 'Reference number required' });

  const apps = await db.prepare('SELECT * FROM applications').all();
  const normalizeReference = value => String(value || '').trim().toLowerCase();
  const compareDigits = value => normalizeReference(value).replace(/\D+/g, '');
  const targetReference = normalizeReference(referenceNumber);
  const targetDigits = compareDigits(referenceNumber);
  const app = apps.find(row => {
    if (String(row.email || '').trim().toLowerCase() !== email) return false;
    const storedReference = normalizeReference(row.reference_number || row.referenceNumber || '');
    return storedReference === targetReference || (targetDigits && compareDigits(storedReference) === targetDigits);
  });
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

// ── Applicant portal login (username + password only) ────────────────────────
router.post('/applicant', async (req, res) => {
  const { username, password } = req.body;
  if (!username) return res.status(400).json({ error: 'Username required' });

  const apps = await db.prepare('SELECT * FROM applications').all();
  const app = apps.find(row => String(row.portal_username || row.username || '').toLowerCase() === username.toLowerCase());
  
  if (!app) return res.status(401).json({ error: 'Invalid username or password' });

  // Check password
  if (app.password_hash) {
    const hashed = crypto.createHash('sha256').update(String(password || '')).digest('hex');
    if (!password || hashed !== app.password_hash) return res.status(401).json({ error: 'Invalid username or password' });
  } else if (password) {
    return res.status(401).json({ error: 'Invalid username or password' });
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
  const username = String(req.body?.username || '').trim().toLowerCase();
  const currentPassword = String(req.body?.currentPassword || '');
  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (!username) return res.status(400).json({ error: 'Username is required' });
  if (name.length > 80) return res.status(400).json({ error: 'Name must be 80 characters or fewer' });
  if (!/^[a-z0-9._-]{3,40}$/.test(username)) return res.status(400).json({ error: 'Username must be 3-40 characters and use letters, numbers, dot, underscore, or hyphen' });
  if (!currentPassword) return res.status(400).json({ error: 'Current password is required' });
  const staff = await db.prepare('SELECT * FROM staff WHERE id = ?').get(req.user.id);
  if (!staff || staff.password !== hashPassword(currentPassword)) return res.status(401).json({ error: 'Current password is incorrect' });
  const existing = await db.prepare('SELECT id FROM staff WHERE username = ? AND id <> ?').get(username, req.user.id);
  if (existing) return res.status(409).json({ error: 'That username is already in use' });
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase() || '??';
  await db.prepare('UPDATE staff SET username = ?, name = ?, initials = ? WHERE id = ?').run(username, name, initials, req.user.id);
  res.json({ ok: true, user: { username, name, initials } });
});

router.post('/director/trusted-device/revoke', require('../middleware/auth').requireAuth, async (req, res) => {
  if (req.user.type !== 'staff' || req.user.role !== 'director') return res.status(403).json({ error: 'Director only' });
  const deviceId = normalizeDeviceId(req.body?.deviceId);
  if (deviceId) trustedDevices.delete(getTrustedDeviceKey(req.user.username, deviceId));
  res.json({ ok: true });
});

module.exports = router;
