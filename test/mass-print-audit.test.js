const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('mass print UI and API wrapper expose an audit-log print surface', () => {
  const apiSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'mefamdev-api.js'), 'utf8');
  const pageSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'mass_print.html'), 'utf8');

  assert.match(apiSource, /async getAuditLogs\(\) \{ return this\._get\('\/events\/audit-logs'\); \}/);
  assert.match(pageSource, /data-type="audit"/);
  assert.match(pageSource, /type === 'audit'/);
  assert.match(pageSource, /buildAuditLogsPrint/);
});

test('api error parser converts rate-limit responses into a user-friendly message', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'mefamdev-api.js'), 'utf8');
  assert.match(source, /Too many attempts\. Please wait, then try again\./);
  assert.match(source, /response\.status === 429/);
});
