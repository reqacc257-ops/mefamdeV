const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../memory-store');
const eventsRouter = require('../routes/events');

test('active attendance codes prevent duplicate check-ins and expire cleanly', async () => {
  db.data.events = [];
  db.data.event_sessions = [];
  db.data.event_attendance = [];
  db.data.event_checkins = [];
  db.data.applications = [];

  const eventId = db.prepare('INSERT INTO events (name, date, venue, max_att) VALUES (?, ?, ?, ?)').run('Orientation', '2026-07-24', 'Office', 50).lastInsertRowid;
  db.prepare('INSERT INTO applications (name, status) VALUES (?, ?)').run('Student One', 'Accepted');

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { type: 'staff', role: 'program', appId: 1 };
    next();
  });
  app.use('/api/events', eventsRouter);

  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));

  try {
    const { port } = server.address();
    const authHeader = { Authorization: `Bearer ${jwt.sign({ type: 'staff', role: 'program' }, 'local-development-only-jwt-secret')}` };

    const startRes = await fetch(`http://127.0.0.1:${port}/api/events/${eventId}/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeader },
      body: JSON.stringify({ expiresInMinutes: 5 })
    });
    const startBody = await startRes.json();
    assert.equal(startRes.status, 200);
    assert.equal(startBody.ok, true);
    assert.match(startBody.session?.code || '', /[A-Z0-9]{4,}/);

    const firstCheckin = await fetch(`http://127.0.0.1:${port}/api/events/${eventId}/checkin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: startBody.session.code, name: 'Student One', studentId: 'ST-001' })
    });
    const firstBody = await firstCheckin.json();
    assert.equal(firstCheckin.status, 200);
    assert.equal(firstBody.ok, true);
    assert.equal(firstBody.duplicate, false);

    const duplicateCheckin = await fetch(`http://127.0.0.1:${port}/api/events/${eventId}/checkin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: startBody.session.code, name: 'Student One', studentId: 'ST-001' })
    });
    const duplicateBody = await duplicateCheckin.json();
    assert.equal(duplicateCheckin.status, 200);
    assert.equal(duplicateBody.duplicate, true);

    const closeRes = await fetch(`http://127.0.0.1:${port}/api/events/${eventId}/end`, { method: 'POST', headers: authHeader });
    const closeBody = await closeRes.json();
    assert.equal(closeRes.status, 200);
    assert.equal(closeBody.ok, true);

    const expiredCheckin = await fetch(`http://127.0.0.1:${port}/api/events/${eventId}/checkin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: startBody.session.code, name: 'Student One', studentId: 'ST-001' })
    });
    const expiredBody = await expiredCheckin.json();
    assert.equal(expiredCheckin.status, 400);
    assert.match(expiredBody.error || '', /expired|inactive/i);
  } finally {
    server.close();
  }
});
