/**
 * routes/events.js
 */
const router = require('express').Router();
const db = require('../db');
const { requireRole } = require('../middleware/auth');

function generateAttendanceCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 5 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
}

function ensureTable(tableName) {
  if (!Array.isArray(db.data[tableName])) {
    db.data[tableName] = [];
  }
  return db.data[tableName];
}

function getActiveAttendanceSession(eventId) {
  const sessions = ensureTable('event_sessions').filter(row => Number(row.event_id) === Number(eventId) && (row.active === 1 || row.active === true));
  return sessions.sort((a, b) => Number(b.id || 0) - Number(a.id || 0))[0] || null;
}

function getEventCheckins(eventId) {
  return ensureTable('event_checkins').filter(row => Number(row.event_id) === Number(eventId));
}

function buildEventPayload(event) {
  const eventId = event.id;
  const activeSession = db.prepare('SELECT * FROM event_sessions WHERE event_id = ? AND active = 1 ORDER BY id DESC LIMIT 1').get(eventId);
  const checkins = db.prepare('SELECT * FROM event_checkins WHERE event_id = ?').all(eventId);
  return {
    ...event,
    activeAttendanceSession: activeSession ? {
      id: activeSession.id,
      code: activeSession.code,
      expiresAt: activeSession.expires_at,
      active: activeSession.active === 1,
      startedAt: activeSession.started_at,
    } : null,
    checkinCount: checkins.length,
  };
}

function getLatestGradesByApp(grades = []) {
  const gradeMap = new Map();
  (grades || []).forEach(row => {
    const appId = String(row.app_id || row.appId);
    if (!appId) return;
    const current = gradeMap.get(appId);
    const currentTs = current ? Number(new Date(current.updated_at || current.updatedAt || 0)) || 0 : 0;
    const rowTs = Number(new Date(row.updated_at || row.updatedAt || 0)) || 0;
    if (!current || rowTs >= currentTs) {
      gradeMap.set(appId, row);
    }
  });
  return gradeMap;
}

function buildMonitoringAlerts(applications = [], grades = [], absences = []) {
  const alerts = [];
  const appMap = new Map((applications || []).map(app => [String(app.id), app]));
  const gradeMap = getLatestGradesByApp(grades);
  const absenceMap = new Map((absences || []).map(a => [String(a.app_id || a.appId), a]));

  for (const [appId, app] of appMap.entries()) {
    const grade = Number(gradeMap.get(appId)?.grade_val || gradeMap.get(appId)?.grade || 0);
    const absence = Number(absenceMap.get(appId)?.days || 0);
    if (app?.status === 'Accepted' || app?.status === 'Interviewing' || app?.status === 'Pending Review') {
      if (grade && grade < 80) {
        alerts.push({ id: `${appId}-academic`, appId, type: 'academic', severity: 'high', message: `${app.name || 'Scholar'} has a low grade of ${grade}.` });
      }
      if (absence >= 1) {
        alerts.push({ id: `${appId}-attendance`, appId, type: 'attendance', severity: 'medium', message: `${app.name || 'Scholar'} has ${absence} missed day${absence === 1 ? '' : 's'}.` });
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
    alertLevel: alerts.length >= 2 ? 'high' : alerts.length >= 1 ? 'medium' : 'low',
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
  res.json(events.map(e => ({ ...buildEventPayload(e), attendees: attData[e.id] || [] })));
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

// Start an attendance session for an event
router.post('/:id/start', requireRole('director','program','edu'), (req, res) => {
  const eventId = parseInt(req.params.id);
  const expiresInMinutes = Math.max(1, parseInt(req.body.expiresInMinutes || req.body.expiresIn || 15) || 15);
  const code = generateAttendanceCode();
  const startedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000).toISOString();

  const sessions = ensureTable('event_sessions');
  sessions.forEach(row => {
    if (Number(row.event_id) === eventId) row.active = 0;
  });

  const newSession = {
    id: (sessions[sessions.length - 1]?.id || 0) + 1,
    event_id: eventId,
    code,
    started_at: startedAt,
    expires_at: expiresAt,
    active: 1,
  };
  sessions.push(newSession);
  db.save();

  res.json({ ok: true, session: { id: newSession.id, code, expiresAt, startedAt, active: true } });
});

// End an active attendance session
router.post('/:id/end', requireRole('director','program','edu'), (req, res) => {
  const eventId = parseInt(req.params.id);
  const sessions = ensureTable('event_sessions');
  sessions.forEach(row => {
    if (Number(row.event_id) === eventId) row.active = 0;
  });
  db.save();
  res.json({ ok: true });
});

// Student self-checkin using an active code
router.post('/:id/checkin', (req, res) => {
  const eventId = parseInt(req.params.id);
  const { code, name, studentId } = req.body || {};

  if (!code || !name) {
    return res.status(400).json({ error: 'Attendance code and name are required.' });
  }

  const session = getActiveAttendanceSession(eventId);
  if (!session) {
    return res.status(400).json({ error: 'There is no active attendance session for this event right now.' });
  }

  const now = new Date();
  const expiresAt = session.expires_at ? new Date(session.expires_at) : null;
  if (expiresAt && now > expiresAt) {
    session.active = 0;
    db.save();
    return res.status(400).json({ error: 'That attendance code has expired. Please ask staff for a new one.' });
  }

  const normalizedCode = String(code).trim().toUpperCase();
  if (normalizedCode !== String(session.code).trim().toUpperCase()) {
    return res.status(400).json({ error: 'That attendance code is invalid. Please try again.' });
  }

  const existing = getEventCheckins(eventId).find(row => Number(row.session_id) === Number(session.id) && String(row.student_id) === String(studentId || name));
  if (existing) {
    return res.json({ ok: true, duplicate: true, message: 'You have already checked in for this event.' });
  }

  const checkins = ensureTable('event_checkins');
  checkins.push({
    id: (checkins[checkins.length - 1]?.id || 0) + 1,
    event_id: eventId,
    session_id: session.id,
    student_id: studentId || name,
    student_name: name,
    checked_in_at: now.toISOString(),
  });
  db.save();
  res.json({ ok: true, duplicate: false, message: 'Attendance recorded successfully.' });
});

// Public check-in by code (students may not know the event id)
router.post('/checkin', (req, res) => {
  const { code, name, studentId } = req.body || {};
  if (!code || !name) {
    return res.status(400).json({ error: 'Attendance code and name are required.' });
  }

  const normalizedCode = String(code).trim().toUpperCase();
  const sessions = ensureTable('event_sessions');
  const session = sessions.find(s => s && (s.active === 1 || s.active === true) && String(s.code || '').trim().toUpperCase() === normalizedCode);
  if (!session) return res.status(400).json({ error: 'That attendance code is invalid or inactive.' });

  const now = new Date();
  const expiresAt = session.expires_at ? new Date(session.expires_at) : null;
  if (expiresAt && now > expiresAt) {
    session.active = 0;
    db.save();
    return res.status(400).json({ error: 'That attendance code has expired.' });
  }

  const eventId = Number(session.event_id);
  const existing = getEventCheckins(eventId).find(row => Number(row.session_id) === Number(session.id) && String(row.student_id) === String(studentId || name));
  if (existing) return res.json({ ok: true, duplicate: true, message: 'You have already checked in for this event.' });

  const checkins = ensureTable('event_checkins');
  checkins.push({
    id: (checkins[checkins.length - 1]?.id || 0) + 1,
    event_id: eventId,
    session_id: session.id,
    student_id: studentId || name,
    student_name: name,
    checked_in_at: now.toISOString(),
  });
  db.save();
  res.json({ ok: true, duplicate: false, message: 'Attendance recorded successfully.', eventId });
});

// List check-in roster for the active session
router.get('/:id/checkins', requireRole('director','program','edu'), (req, res) => {
  const eventId = parseInt(req.params.id);
  const list = getEventCheckins(eventId).slice().sort((a, b) => String(b.checked_in_at || '').localeCompare(String(a.checked_in_at || '')));
  res.json(list);
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
  del.run(eventId);
  appIds.forEach(id => ins.run(eventId, id));
  if (typeof db.save === 'function') db.save();
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
  const semester = req.query.semester;
  if (semester) {
    return res.json(db.prepare('SELECT * FROM grades WHERE semester = ?').all(semester));
  }
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
  const sem = semester || '';
  const timestamp = new Date().toISOString();
  const existing = db.prepare('SELECT * FROM grades WHERE app_id = ? AND semester = ?').get(req.params.appId, sem);
  if (existing) {
    db.prepare('UPDATE grades SET grade_val = ?, updated_at = ? WHERE id = ?').run(grade, timestamp, existing.id);
  } else {
    db.prepare('INSERT INTO grades (app_id, grade_val, semester, updated_at) VALUES (?, ?, ?, ?)').run(req.params.appId, grade, sem, timestamp);
  }
  if (typeof db.save === 'function') db.save();
  res.json({ ok: true });
});

module.exports = router;
module.exports.buildMonitoringAlerts = buildMonitoringAlerts;
module.exports.buildMonitoringSummary = buildMonitoringSummary;
