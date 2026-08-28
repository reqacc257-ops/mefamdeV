/**
 * routes/events.js
 */
const router = require('express').Router();
const db = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

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

async function getActiveAttendanceSession(eventId) {
  if (db.isPostgres) return db.prepare('SELECT * FROM event_sessions WHERE event_id = ? AND active = 1 ORDER BY id DESC LIMIT 1').get(eventId);
  const sessions = ensureTable('event_sessions').filter(row => Number(row.event_id) === Number(eventId) && (row.active === 1 || row.active === true));
  return sessions.sort((a, b) => Number(b.id || 0) - Number(a.id || 0))[0] || null;
}

async function getEventCheckins(eventId) {
  if (db.isPostgres) return db.prepare('SELECT * FROM event_checkins WHERE event_id = ?').all(eventId);
  return ensureTable('event_checkins').filter(row => Number(row.event_id) === Number(eventId));
}

async function buildEventPayload(event) {
  const eventId = event.id;
  const activeSession = await db.prepare('SELECT * FROM event_sessions WHERE event_id = ? AND active = 1 ORDER BY id DESC LIMIT 1').get(eventId);
  const checkins = await db.prepare('SELECT * FROM event_checkins WHERE event_id = ?').all(eventId);
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
router.get('/', requireAuth, async (req, res) => {
  const events = await db.prepare('SELECT * FROM events ORDER BY date DESC').all();
  const attData = {};
  (await db.prepare('SELECT event_id, app_id FROM event_attendance').all()).forEach(r => {
    if (!attData[r.event_id]) attData[r.event_id] = [];
    attData[r.event_id].push(r.app_id);
  });
  res.json(await Promise.all(events.map(async e => ({ ...await buildEventPayload(e), attendees: attData[e.id] || [] }))));
});

// Create event
router.post('/', requireAuth, requireRole('director','program','edu'), async (req, res) => {
  const b = req.body;
  if (!b.name) return res.status(400).json({ error: 'Event name required' });
  const info = await db.prepare(
    'INSERT INTO events (name, date, venue, max_att) VALUES (?, ?, ?, ?)'
  ).run(b.name, b.date || '', b.venue || '', b.max || 75);
  res.json({ ok: true, id: info.lastInsertRowid });
});

// Start an attendance session for an event
router.post('/:id/start', requireAuth, requireRole('director','program','edu'), async (req, res) => {
  const eventId = parseInt(req.params.id);
  const expiresInMinutes = Math.max(1, parseInt(req.body.expiresInMinutes || req.body.expiresIn || 15) || 15);
  const code = generateAttendanceCode();
  const startedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000).toISOString();

  if (db.isPostgres) {
    await db.prepare('UPDATE event_sessions SET active = 0 WHERE event_id = ?').run(eventId);
    const info = await db.prepare('INSERT INTO event_sessions (event_id, code, started_at, expires_at, active) VALUES (?, ?, ?, ?, ?)').run(eventId, code, startedAt, expiresAt, 1);
    return res.json({ ok: true, session: { id: info.lastInsertRowid, code, expiresAt, startedAt, active: true } });
  }
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
  if (typeof db.save === 'function') db.save();

  res.json({ ok: true, session: { id: newSession.id, code, expiresAt, startedAt, active: true } });
});

// End an active attendance session
router.post('/:id/end', requireAuth, requireRole('director','program','edu'), async (req, res) => {
  const eventId = parseInt(req.params.id);
  if (db.isPostgres) await db.prepare('UPDATE event_sessions SET active = 0 WHERE event_id = ?').run(eventId);
  const sessions = db.isPostgres ? [] : ensureTable('event_sessions');
  sessions.forEach(row => {
    if (Number(row.event_id) === eventId) row.active = 0;
  });
  if (typeof db.save === 'function') db.save();
  res.json({ ok: true });
});

// Student self-checkin using an active code
router.post('/:id/checkin', async (req, res) => {
  const eventId = parseInt(req.params.id);
  const { code, name, studentId } = req.body || {};

  if (!code || !name) {
    return res.status(400).json({ error: 'Attendance code and name are required.' });
  }

  const session = await getActiveAttendanceSession(eventId);
  if (!session) {
    return res.status(400).json({ error: 'The attendance session is inactive or expired.' });
  }

  const now = new Date();
  const expiresAt = session.expires_at ? new Date(session.expires_at) : null;
  if (expiresAt && now > expiresAt) {
    session.active = 0;
    if (db.isPostgres) await db.prepare('UPDATE event_sessions SET active = 0 WHERE id = ?').run(session.id); else db.save();
    return res.status(400).json({ error: 'That attendance code has expired. Please ask staff for a new one.' });
  }

  const normalizedCode = String(code).trim().toUpperCase();
  if (normalizedCode !== String(session.code).trim().toUpperCase()) {
    return res.status(400).json({ error: 'That attendance code is invalid. Please try again.' });
  }

  const existingRows = await getEventCheckins(eventId);
  const existing = existingRows.find(row => Number(row.session_id) === Number(session.id) && String(row.student_id) === String(studentId || name));
  if (existing) {
    return res.json({ ok: true, duplicate: true, message: 'You have already checked in for this event.' });
  }

  if (db.isPostgres) {
    await db.prepare('INSERT INTO event_checkins (event_id, session_id, student_id, student_name, checked_in_at) VALUES (?, ?, ?, ?, ?)').run(eventId, session.id, studentId || name, name, now.toISOString());
    return res.json({ ok: true, duplicate: false, message: 'Attendance recorded successfully.' });
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
  if (typeof db.save === 'function') db.save();
  res.json({ ok: true, duplicate: false, message: 'Attendance recorded successfully.' });
});

// Public check-in by code (students may not know the event id)
router.post('/checkin', async (req, res) => {
  const { code, name, studentId } = req.body || {};
  if (!code || !name) {
    return res.status(400).json({ error: 'Attendance code and name are required.' });
  }

  const normalizedCode = String(code).trim().toUpperCase();
  const sessions = db.isPostgres ? await db.prepare('SELECT * FROM event_sessions WHERE active = 1 AND UPPER(code) = ? ORDER BY id DESC LIMIT 1').all(normalizedCode) : ensureTable('event_sessions');
  const session = db.isPostgres ? sessions[0] : sessions.find(s => s && (s.active === 1 || s.active === true) && String(s.code || '').trim().toUpperCase() === normalizedCode);
  if (!session) return res.status(400).json({ error: 'That attendance code is invalid or inactive.' });

  const now = new Date();
  const expiresAt = session.expires_at ? new Date(session.expires_at) : null;
  if (expiresAt && now > expiresAt) {
    session.active = 0;
    if (db.isPostgres) await db.prepare('UPDATE event_sessions SET active = 0 WHERE id = ?').run(session.id); else db.save();
    return res.status(400).json({ error: 'That attendance code has expired.' });
  }

  const eventId = Number(session.event_id);
  const existingRows = await getEventCheckins(eventId);
  const existing = existingRows.find(row => Number(row.session_id) === Number(session.id) && String(row.student_id) === String(studentId || name));
  if (existing) return res.json({ ok: true, duplicate: true, message: 'You have already checked in for this event.' });

  if (db.isPostgres) {
    await db.prepare('INSERT INTO event_checkins (event_id, session_id, student_id, student_name, checked_in_at) VALUES (?, ?, ?, ?, ?)').run(eventId, session.id, studentId || name, name, now.toISOString());
    return res.json({ ok: true, duplicate: false, message: 'Attendance recorded successfully.', eventId });
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
  if (typeof db.save === 'function') db.save();
  res.json({ ok: true, duplicate: false, message: 'Attendance recorded successfully.', eventId });
});

// List check-in roster for the active session
router.get('/:id/checkins', requireAuth, requireRole('director','program','edu'), async (req, res) => {
  const eventId = parseInt(req.params.id);
  const list = (await getEventCheckins(eventId)).slice().sort((a, b) => String(b.checked_in_at || '').localeCompare(String(a.checked_in_at || '')));
  res.json(list);
});

// Delete event
router.delete('/:id', requireAuth, requireRole('director','program'), async (req, res) => {
  await db.prepare('DELETE FROM events WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Save attendance for an event
router.put('/:id/attendance', requireAuth, async (req, res) => {
  const eventId = parseInt(req.params.id);
  const appIds  = req.body.appIds || [];  // array of application IDs

  // Replace attendance for this event
  const del = db.prepare('DELETE FROM event_attendance WHERE event_id = ?');
  const ins = db.prepare('INSERT OR IGNORE INTO event_attendance (event_id, app_id) VALUES (?, ?)');
  await del.run(eventId);
  for (const id of appIds) await ins.run(eventId, id);
  if (typeof db.save === 'function') db.save();
  res.json({ ok: true });
});

// Get absence log
router.get('/absences', async (req, res) => {
  res.json(await db.prepare('SELECT * FROM absences').all());
});
router.post('/absences', async (req, res) => {
  const { appId, days, reason } = req.body;
  await db.prepare(`
    INSERT INTO absences (app_id, days, reason) VALUES (?, ?, ?)
    ON CONFLICT(app_id) DO UPDATE SET
      days = days + excluded.days,
      reason = COALESCE(excluded.reason, absences.reason)
  `).run(appId, days || 1, reason || '');
  res.json({ ok: true });
});
router.delete('/absences/:appId', async (req, res) => {
  await db.prepare('DELETE FROM absences WHERE app_id = ?').run(req.params.appId);
  res.json({ ok: true });
});

// Grades
router.get('/grades', async (req, res) => {
  const semester = req.query.semester;
  const appId = req.query.appId;
  const schoolYear = req.query.schoolYear;
  
  if (appId && schoolYear) {
    return res.json(await db.prepare('SELECT * FROM grades WHERE app_id = ? AND school_year = ? ORDER BY quarter ASC, subject ASC').all(appId, schoolYear));
  }
  if (semester) {
    return res.json(await db.prepare('SELECT * FROM grades WHERE semester = ?').all(semester));
  }
  res.json(await db.prepare('SELECT * FROM grades').all());
});
router.get('/grades/:appId/report', async (req, res) => {
  const appId = req.params.appId;
  const schoolYear = req.query.schoolYear || '';
  const grades = await db.prepare('SELECT * FROM grades WHERE app_id = ? AND school_year = ? ORDER BY quarter ASC, subject ASC').all(appId, schoolYear);
  res.json(grades || []);
});

// Subjects (persistent list shared across staff)
router.get('/subjects', async (req, res) => {
  // stored as an array in db.data.subjects
  const list = db.isPostgres ? (await db.prepare('SELECT subjects FROM app_settings WHERE key = ?').get('subjects'))?.subjects || [] : (Array.isArray(db.data.subjects) ? db.data.subjects : []);
  res.json(list);
});

router.put('/subjects', requireRole('director','edu'), async (req, res) => {
  // Expect { subjects: ["Subject A", "Subject B", ...] }
  if (!req.body || !Array.isArray(req.body.subjects)) return res.status(400).json({ error: 'Request must include a subjects array in the body.' });

  // Normalize: trim, collapse internal whitespace, filter empties
  const raw = req.body.subjects.map(s => String(s || '').replace(/\s+/g, ' ').trim()).filter(Boolean);

  // Dedupe while preserving order (case-insensitive)
  const seen = new Set();
  const normalized = [];
  for (const s of raw) {
    const key = s.toLowerCase();
    if (!seen.has(key)) { seen.add(key); normalized.push(s); }
  }

  // Basic limits for safety
  if (normalized.length > 200) return res.status(400).json({ error: 'Too many subjects; limit is 200.' });
  if (normalized.some(s => s.length > 120)) return res.status(400).json({ error: 'Each subject must be 120 characters or fewer.' });

  if (db.isPostgres) await db.prepare('INSERT INTO app_settings (key, subjects) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET subjects = EXCLUDED.subjects').run('subjects', normalized);
  else db.data.subjects = normalized;
  try { if (typeof db.save === 'function') db.save(); } catch (e) {
    console.error('Failed saving subjects:', e);
    return res.status(500).json({ error: 'Failed to persist subjects.' });
  }

  res.json({ ok: true, subjects: normalized });
});
router.get('/monitoring', async (req, res) => {
  const applications = await db.prepare('SELECT id, name, status FROM applications').all();
  const grades = await db.prepare('SELECT * FROM grades').all();
  const absences = await db.prepare('SELECT * FROM absences').all();
  res.json(buildMonitoringSummary(applications, grades, absences));
});
router.put('/grades/:appId', async (req, res) => {
  const { grade, semester, subject, quarter, schoolYear } = req.body;
  const timestamp = new Date().toISOString();
  const appId = req.params.appId;
  
  // Support both old (semester) and new (subject+quarter) format
  if (subject && quarter && schoolYear) {
    const existing = await db.prepare('SELECT * FROM grades WHERE app_id = ? AND school_year = ? AND subject = ? AND quarter = ?').get(appId, schoolYear, subject, quarter);
    if (existing) {
      await db.prepare('UPDATE grades SET grade_val = ?, updated_at = ? WHERE id = ?').run(grade, timestamp, existing.id);
    } else {
      await db.prepare('INSERT INTO grades (app_id, school_year, subject, quarter, grade_val, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(appId, schoolYear, subject, quarter, grade, timestamp);
    }
  } else {
    // Legacy semester-based grades
    const sem = semester || '';
    const existing = await db.prepare('SELECT * FROM grades WHERE app_id = ? AND semester = ?').get(appId, sem);
    if (existing) {
      await db.prepare('UPDATE grades SET grade_val = ?, updated_at = ? WHERE id = ?').run(grade, timestamp, existing.id);
    } else {
      await db.prepare('INSERT INTO grades (app_id, grade_val, semester, updated_at) VALUES (?, ?, ?, ?)').run(appId, grade, sem, timestamp);
    }
  }
  if (typeof db.save === 'function') db.save();
  res.json({ ok: true });
});

module.exports = router;
module.exports.buildMonitoringAlerts = buildMonitoringAlerts;
module.exports.buildMonitoringSummary = buildMonitoringSummary;
