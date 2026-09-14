const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const app = require('../server');
const db = require('../db');

const JWT_SECRET = process.env.JWT_SECRET || 'local-development-only-jwt-secret';
const appId = 7001;
const bypassAppId = 7002;

test('director can close a school year and applicant can reapply without losing grades', async () => {
  db.prepare('DELETE FROM applications WHERE id = ?').run(appId);
  db.prepare('DELETE FROM grades WHERE app_id = ?').run(appId);
  db.prepare('INSERT INTO applications (id, name, portal_username, status, sy) VALUES (?, ?, ?, ?, ?)')
    .run(appId, 'Cycle Applicant', 'cycle-applicant', 'Accepted', '2025-2026');
  db.prepare('INSERT INTO grades (app_id, grade_val, semester, updated_at) VALUES (?, ?, ?, ?)')
    .run(appId, 91, '2025-2026 1st Quarter', new Date().toISOString());

  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const directorToken = jwt.sign({ id: 'director', username: 'director', role: 'director' }, JWT_SECRET);
  const applicantToken = jwt.sign({ type: 'applicant', appId, name: 'Cycle Applicant' }, JWT_SECRET);

  try {
    const endRes = await fetch(`${base}/applications/${appId}/end-year`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${directorToken}` }
    });
    assert.equal(endRes.status, 200);
    assert.equal((await endRes.json()).gradesRetained, true);

    const reapplyRes = await fetch(`${base}/applications/${appId}/reapply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${applicantToken}` },
      body: JSON.stringify({
        schoolYear: '2026-2027',
        school: 'New College University',
        eduLevel: 'College',
        grade: '1st Year College'
      })
    });
    assert.equal(reapplyRes.status, 200);
    assert.equal((await reapplyRes.json()).gradesRetained, true);

    const savedGrade = db.prepare('SELECT * FROM grades WHERE app_id = ?').get(appId);
    const savedApp = db.prepare('SELECT status, sy, school, edu_level, grade FROM applications WHERE id = ?').get(appId);
    assert.equal(savedGrade.grade_val, 91);
    assert.equal(savedApp.status, 'Pending Review');
    assert.equal(savedApp.sy, '2026-2027');
    assert.equal(savedApp.school, 'New College University');
    assert.equal(savedApp.edu_level, 'College');
    assert.equal(savedApp.grade, '1st Year College');
  } finally {
    server.close();
    db.prepare('DELETE FROM applications WHERE id = ?').run(appId);
    db.prepare('DELETE FROM grades WHERE app_id = ?').run(appId);
  }
});

test('recent grade records cannot be deleted before seven years', async () => {
  db.prepare('DELETE FROM grades WHERE app_id = ?').run(appId);
  db.prepare('INSERT INTO grades (app_id, grade_val, semester, updated_at) VALUES (?, ?, ?, ?)')
    .run(appId, 88, '2026-2027 1st Quarter', new Date().toISOString());

  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const directorToken = jwt.sign({ id: 'director', username: 'director', role: 'director' }, JWT_SECRET);

  try {
    const retentionRes = await fetch(`${base}/grades/retention/${appId}`, {
      headers: { Authorization: `Bearer ${directorToken}` }
    });
    const retention = await retentionRes.json();
    assert.equal(retention.eligible, false);
    assert.equal(retention.recordCount, 1);

    const deleteRes = await fetch(`${base}/grades/retention/${appId}/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${directorToken}` },
      body: JSON.stringify({ confirm: true })
    });
    assert.equal(deleteRes.status, 400);
    assert.equal(db.prepare('SELECT * FROM grades WHERE app_id = ?').all(appId).length, 1);
  } finally {
    server.close();
    db.prepare('DELETE FROM grades WHERE app_id = ?').run(appId);
  }
});

test('director password override can bypass the seven-year grade-retention gate', async () => {
  db.prepare('DELETE FROM applications WHERE id = ?').run(bypassAppId);
  db.prepare('DELETE FROM grades WHERE app_id = ?').run(bypassAppId);
  db.prepare('INSERT INTO applications (id, name, portal_username, status, sy) VALUES (?, ?, ?, ?, ?)')
    .run(bypassAppId, 'Retention Bypass Applicant', 'retention-bypass-applicant', 'Accepted', '2025-2026');
  db.prepare('INSERT INTO grades (app_id, grade_val, semester, updated_at) VALUES (?, ?, ?, ?)')
    .run(bypassAppId, 92, '2026-2027 1st Quarter', new Date().toISOString());

  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const directorToken = jwt.sign({ type: 'staff', id: 1, username: 'director', role: 'director', name: 'Director' }, JWT_SECRET);

  try {
    const wrongPasswordRes = await fetch(`${base}/grades/retention/${bypassAppId}/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${directorToken}` },
      body: JSON.stringify({ confirm: true, password: 'wrong-password' })
    });
    assert.equal(wrongPasswordRes.status, 401);

    const deleteRes = await fetch(`${base}/grades/retention/${bypassAppId}/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${directorToken}` },
      body: JSON.stringify({ confirm: true, password: 'uVP-OzXLaTSm7pga3hM6rUgrii-nzyy9' })
    });
    assert.equal(deleteRes.status, 200);
    const body = await deleteRes.json();
    assert.equal(body.ok, true);
    assert.equal(db.prepare('SELECT * FROM grades WHERE app_id = ?').all(bypassAppId).length, 0);
  } finally {
    server.close();
    db.prepare('DELETE FROM applications WHERE id = ?').run(bypassAppId);
    db.prepare('DELETE FROM grades WHERE app_id = ?').run(bypassAppId);
  }
});
