const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('mass print UI and API wrapper expose an audit-log print surface', () => {
  const apiSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'mefamdev-api.js'), 'utf8');
  const pageSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'mass_print.html'), 'utf8');

  assert.match(apiSource, /async getAuditLogs\(\) \{ return this\._get\('\/events\/audit-logs'\); \}/);
  assert.match(apiSource, /async getAllApplications\(extraOpts = \{\}\)/);
  assert.match(apiSource, /async getAllFamilies\(\)/);
  assert.match(apiSource, /async getAllGrades\(\)/);
  assert.match(apiSource, /async getAllIntakeSheets\(\)/);
  assert.match(apiSource, /async _getAllPages\(path, pageSize = 500, maxPages = 50/);
  assert.match(pageSource, /data-type="audit"/);
  assert.match(pageSource, /type === 'audit'/);
  assert.match(pageSource, /buildAuditLogsPrint/);
  assert.match(apiSource, /async recordAuditLog\(action, payload = \{\}\)/);
  assert.doesNotMatch(pageSource, /window\.AuditLog\?\.log\(AUDIT_ACTIONS\.PRINT_GENERATED/);
  assert.match(pageSource, /AuditLog\.getAll\(\)/);
  assert.match(pageSource, /MefamAPI\.getAllApplications\(\)/);
  assert.match(pageSource, /MefamAPI\.getAllFamilies\(\)/);
  assert.match(pageSource, /MefamAPI\.getAllGrades\(\)/);
  assert.match(pageSource, /MefamAPI\.getAllIntakeSheets\(\)/);
  assert.doesNotMatch(pageSource, /<th>Change<\/th>/);
  assert.doesNotMatch(pageSource, /status: \$\{/);
});

test('audit sources exclude print-generated noise', () => {
  const auditSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'audit.js'), 'utf8');
  const clientSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'audit-log.js'), 'utf8');

  assert.match(auditSource, /DELETE FROM audit_logs WHERE action = 'print\.generated'/);
  assert.match(clientSource, /filter\(row => row\?\.action !== 'print\.generated'\)/);
  assert.match(auditSource, /purgePrintAuditLogs/);
  assert.match(auditSource, /normalizeLegacyAuditActors/);
  assert.match(clientSource, /actorName: 'Director'/);
});

test('api error parser converts rate-limit responses into a user-friendly message', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'mefamdev-api.js'), 'utf8');
  assert.match(source, /Too many attempts\. Please wait, then try again\./);
  assert.match(source, /response\.status === 429/);
});
