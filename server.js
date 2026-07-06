const express = require('express');
const path = require('path');
const cors = require('cors');

const db = require('./db');
const authRouter = require('./routes/auth');
const appsRouter = require('./routes/applications');
const familiesRouter = require('./routes/families');
const eventsRouter = require('./routes/events');
const financialsRouter = require('./routes/financials');
const recordsRouter = require('./routes/records');
const commsRouter = require('./routes/comms');
const { requireAuth } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '5mb' }));

// Prevent browsers and phones from serving stale login/dashboard pages
app.use((req, res, next) => {
  if (req.path.endsWith('.html') || req.path.endsWith('.js') || req.path.endsWith('.css')) {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
  next();
});

// Serve static files from the public/ folder
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/api/auth', authRouter);
app.use('/api/applications', requireAuth, appsRouter);
app.use('/api/families', requireAuth, familiesRouter);
app.use('/api/events', requireAuth, eventsRouter);
app.use('/api/financials', requireAuth, financialsRouter);
app.use('/api/records', requireAuth, recordsRouter);
app.use('/api/documents', requireAuth, require('./routes/documents'));
app.use('/api/comms', requireAuth, commsRouter);

// Public submit route
const { submitPublicApplication } = require('./routes/applications');
app.post('/api/public/apply', submitPublicApplication);

// Health check
app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n✅ MEFAMDEV Server running at http://localhost:${PORT}`);
    console.log(`    API base: http://localhost:${PORT}/api`);
    console.log(`    Dashboard: http://localhost:${PORT}/admin_dashboard.html\n`);
  });
}

module.exports = app;
