const test = require('node:test');
const assert = require('node:assert/strict');
const { translateQuery } = require('../postgres-store');

test('translates positional and named parameters without a live database', () => {
  const positional = translateQuery("SELECT * FROM applications WHERE id = ? AND submitted_at > datetime('now', '-5 minutes')", [7]);
  assert.equal(positional.text, "SELECT * FROM applications WHERE id = $1 AND submitted_at > CURRENT_TIMESTAMP - INTERVAL '-5 minutes'");
  assert.deepEqual(positional.values, [7]);

  const named = translateQuery('INSERT INTO applications (name, submitted_data) VALUES (@name, @submitted_data)', {
    name: 'A', submitted_data: { source: 'form' }
  });
  assert.equal(named.text, 'INSERT INTO applications (name, submitted_data) VALUES ($1, $2)');
  assert.deepEqual(named.values, ['A', '{"source":"form"}']);
});

test('translates SQLite JSON extraction and preserves insert-ignore intent', () => {
  const query = translateQuery('INSERT OR IGNORE INTO event_attendance (event_id, app_id) VALUES (?, ?)', [1, 2]);
  assert.equal(query.text, 'INSERT OR IGNORE INTO event_attendance (event_id, app_id) VALUES ($1, $2)');
  assert.deepEqual(query.values, [1, 2]);
  assert.equal(translateQuery('SELECT json_extract(data,"$.name") as name FROM intake_sheets', []).text,
    "SELECT (data::jsonb)->>'name' as name FROM intake_sheets");
});