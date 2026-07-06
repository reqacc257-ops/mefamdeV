const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../memory-store');

test('SELECT queries can read persisted rows from tables', () => {
  db.data.grades = [];
  db.prepare('INSERT INTO grades (app_id, grade_val, semester) VALUES (?, ?, ?)').run(42, 88, '2025-2026 1st Sem');

  const rows = db.prepare('SELECT * FROM grades').all();

  assert.equal(rows.length, 1);
  assert.equal(rows[0].app_id, 42);
  assert.equal(rows[0].grade_val, 88);
  assert.equal(rows[0].semester, '2025-2026 1st Sem');
});

test('INSERT OR IGNORE stores attendance rows with the expected columns', () => {
  db.data.event_attendance = [];
  db.prepare('INSERT OR IGNORE INTO event_attendance (event_id, app_id) VALUES (?, ?)').run(7, 21);

  const rows = db.prepare('SELECT * FROM event_attendance').all();

  assert.equal(rows.length, 1);
  assert.equal(rows[0].event_id, 7);
  assert.equal(rows[0].app_id, 21);
});
