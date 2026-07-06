/**
 * routes/events.js
 */
const router = require('express').Router();
const db = require('../db');
const { requireRole } = require('../middleware/auth');

function buildMonitoringAlerts(applications = [], grades = [], absences = []) {
  const alerts = [];
  const appMap = new Map((applications || []).map(app => [String(app.id), app]));
  const gradeMap = new Map((grades || []).map(g => [String(g.app_id || g.appId), g]));
  const absenceMap = new Map((absences || []).map(a => [String(a.app_id || a.appId), a]));

  for (const [appId, app] of appMap.entries()) {
    const grade = Number(gradeMap.get(appId)?.grade_val || gradeMap.get(appId)?.grade || 0);
    const absence = Number(absenceMap.get(appId)?.days || 0);
    if (app?.status === 'Accepted' || app?.status === 'Interviewing' || app?.status === 'Pending Review') {
      if (grade && grade < 80) {
        alerts.push({ id: `${appId}-academic`, appId, type: 'academic', severity: 'high', message: `${app.name || 'Scholar'} has a low grade of ${grade}.` });
      }
      if (absence >= 3) {
        alerts.push({ id: `${appId}-attendance`, appId, type: 'attendance', severity: 'medium', message: `${app.name || 'Scholar'} has ${absence} missed days.` });
      }
    }
  }

  return alerts;
}

function buildMonitoringSummary(applications = [], grades = [], absences = []) {
  const alerts = buildMonitoringAlerts(applications, grades, absences);
  const activeScholars = (applications || []).filter(app => app?.status === 'Accepted').length;
  return {
    activeScholars,
    atRisk: alerts.length,
    alertLevel: alerts.length >= 3 ? 'high' : alerts.length >= 1 ? 'medium' : 'low',
    alerts,
  };
}

// List events with attendance counts
router.get('/', (req, res) => {
  const events = db.prepare('SELECT * FROM events ORDER BY date DESC').all();
  const attData = {};
  db.prepare('SELECT event_id, app_id FROM event_attendance').all().forEach(r => {
    if (!attData[r.event_id]) attData[r.event_id] = [];
    attData[r.event_id].push(r.app_id);
  });
  res.json(events.map(e => ({ ...e, attendees: attData[e.id] || [] })));
});

// Create event
router.post('/', (req, res) => {
  const b = req.body;
  if (!b.name) return res.status(400).json({ error: 'Event name required' });
  const info = db.prepare(
    'INSERT INTO events (name, date, venue, max_att) VALUES (?, ?, ?, ?)'
  ).run(b.name, b.date || '', b.venue || '', b.max || 75);
  res.json({ ok: true, id: info.lastInsertRowid });
});

// Delete event
router.delete('/:id', requireRole('director','program'), (req, res) => {
  db.prepare('DELETE FROM events WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Save attendance for an event
router.put('/:id/attendance', (req, res) => {
  const eventId = parseInt(req.params.id);
  const appIds  = req.body.appIds || [];  // array of application IDs

  // Replace attendance for this event
  const del = db.prepare('DELETE FROM event_attendance WHERE event_id = ?');
  const ins = db.prepare('INSERT OR IGNORE INTO event_attendance (event_id, app_id) VALUES (?, ?)');
  db.transaction(() => {
    del.run(eventId);
    appIds.forEach(id => ins.run(eventId, id));
  })();
  res.json({ ok: true });
});

// Get absence log
router.get('/absences', (req, res) => {
  res.json(db.prepare('SELECT * FROM absences').all());
});
router.post('/absences', (req, res) => {
  const { appId, days, reason } = req.body;
  db.prepare(`
    INSERT INTO absences (app_id, days, reason) VALUES (?, ?, ?)
    ON CONFLICT(app_id) DO UPDATE SET
      days = days + excluded.days,
      reason = COALESCE(excluded.reason, absences.reason)
  `).run(appId, days || 1, reason || '');
  res.json({ ok: true });
});
router.delete('/absences/:appId', (req, res) => {
  db.prepare('DELETE FROM absences WHERE app_id = ?').run(req.params.appId);
  res.json({ ok: true });
});

// Grades
router.get('/grades', (req, res) => {
  res.json(db.prepare('SELECT * FROM grades').all());
});
router.get('/monitoring', (req, res) => {
  const applications = db.prepare('SELECT id, name, status FROM applications').all();
  const grades = db.prepare('SELECT * FROM grades').all();
  const absences = db.prepare('SELECT * FROM absences').all();
  res.json(buildMonitoringSummary(applications, grades, absences));
});
router.put('/grades/:appId', (req, res) => {
  const { grade, semester } = req.body;
  db.prepare(`
    INSERT INTO grades (app_id, grade_val, semester, updated_at) VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(app_id) DO UPDATE SET grade_val = excluded.grade_val, semester = excluded.semester, updated_at = excluded.updated_at
  `).run(req.params.appId, grade, semester || '');
  res.json({ ok: true });
});

module.exports = router;
module.exports.buildMonitoringAlerts = buildMonitoringAlerts;
module.exports.buildMonitoringSummary = buildMonitoringSummary;
