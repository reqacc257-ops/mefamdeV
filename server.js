require('dotenv').config();

const express = require('express');
const path = require('path');
const cors = require('cors');
const { Resend } = require('resend');

const db = require('./db');
const authRouter = require('./routes/auth');
const appsRouter = require('./routes/applications');
const familiesRouter = require('./routes/families');
const eventsRouter = require('./routes/events');
const financialsRouter = require('./routes/financials');
const recordsRouter = require('./routes/records');
const gradeExtractionRouter = require('./routes/gradeExtraction');
const commsRouter = require('./routes/comms');
const gradesRouter = require('./routes/grades');
const schoolsRouter = require('./routes/schools');
const { requireAuth } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', true);

// Middleware
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '10mb' }));

let databaseReady;
app.use((req, res, next) => {
  if (!db.isPostgres) return next();
  databaseReady ||= db.initialize();
  databaseReady.then(() => next(), next);
});

// Prevent browsers and phones from serving stale login/dashboard pages
app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path.endsWith('.js') || req.path.endsWith('.css')) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
  next();
});

// Friendly entry points for the staff backend dashboard.
app.get(['/admin', '/backend'], (req, res) => {
  res.redirect('/admin_dashboard.html?director=1');
});
app.get('/director', (req, res) => {
  res.redirect('/admin_dashboard.html?director=1');
});

// Serve static files from the public/ folder
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/api/auth', authRouter);
app.use('/api/applications', requireAuth, appsRouter);
app.use('/api/families', requireAuth, familiesRouter);
app.use('/api/events', eventsRouter);
app.use('/api/financials', requireAuth, financialsRouter);
app.use('/api/records', requireAuth, recordsRouter);
app.use('/api/documents', requireAuth, require('./routes/documents'));
app.use('/api/grade-extraction', requireAuth, gradeExtractionRouter);
app.use('/api/comms', requireAuth, commsRouter);
app.use('/api/schools', requireAuth, schoolsRouter);
app.use('/api/grades', requireAuth, gradesRouter);

// Public submit route
const { submitPublicApplication, checkPublicUsernameAvailability } = require('./routes/applications');
app.post('/api/public/apply', submitPublicApplication);
app.get('/api/public/username-availability', checkPublicUsernameAvailability);

app.get('/api/site-config', (req, res) => {
  res.json({
    hcaptchaSiteKey: process.env.HCAPTCHA_SITE_KEY || '',
    hcaptchaEnabled: Boolean(process.env.HCAPTCHA_SITE_KEY && process.env.HCAPTCHA_SECRET_KEY)
  });
});

app.get('/api/hcaptcha-debug', (req, res) => {
  const token = String(req.query.token || '').trim();
  const siteKey = process.env.HCAPTCHA_SITE_KEY || '';
  const secretKeySet = Boolean(process.env.HCAPTCHA_SECRET_KEY);

  if (!token) {
    return res.json({
      ok: false,
      hasSiteKey: Boolean(siteKey),
      hasSecretKey: secretKeySet,
      message: 'Missing hCaptcha token in query string.'
    });
  }

  res.json({
    ok: true,
    hasSiteKey: Boolean(siteKey),
    hasSecretKey: secretKeySet,
    tokenLength: token.length,
    message: 'Token received. Use it in a POST to api.hcaptcha.com/siteverify to test verification.'
  });
});

// Health check
app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.get('/test-email', async (req, res) => {
  const apiKey = process.env.RESEND_API_KEY;
  const recipient = req.query.to || process.env.TEST_EMAIL_RECIPIENT || 'reqacc257@gmail.com';

  if (!apiKey) {
    return res.status(500).json({ ok: false, error: 'RESEND_API_KEY is not set' });
  }

  try {
    const resend = new Resend(apiKey);
    const result = await resend.emails.send({
      from: process.env.RESEND_FROM || 'onboarding@resend.dev',
      to: recipient,
      subject: 'MEFAMDEV Resend test',
      html: '<p>This is a test email from MEFAMDEV on Render.</p>'
    });

    res.json({ ok: true, result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

if (require.main === module) {
  db.initialize().then(() => app.listen(PORT, () => {
    console.log(`\n✅ MEFAMDEV Server running at http://localhost:${PORT}`);
    console.log(`    API base: http://localhost:${PORT}/api`);
    console.log(`    Dashboard: http://localhost:${PORT}/admin_dashboard.html\n`);
  })).catch(error => {
    console.error('Database initialization failed:', error);
    process.exitCode = 1;
  });
}

module.exports = app;
