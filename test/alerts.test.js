const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMonitoringAlerts, buildMonitoringSummary } = require('../routes/events');

test('buildMonitoringAlerts flags low grades and attendance issues', () => {
  const alerts = buildMonitoringAlerts(
    [{ id: 1, name: 'Ana Santos', status: 'Accepted' }],
    [{ app_id: '1', grade_val: 72 }],
    [{ app_id: '1', days: 4, reason: 'Sickness' }]
  );

  assert.equal(alerts.length, 2);
  assert.equal(alerts[0].type, 'academic');
  assert.equal(alerts[1].type, 'attendance');
  assert.match(alerts[0].message, /grade/i);
});

test('buildMonitoringSummary reports counts and risk levels', () => {
  const summary = buildMonitoringSummary(
    [{ id: 1, name: 'Ana Santos', status: 'Accepted' }],
    [{ app_id: '1', grade_val: 72 }],
    [{ app_id: '1', days: 4, reason: 'Sickness' }]
  );

  assert.equal(summary.activeScholars, 1);
  assert.equal(summary.atRisk, 2);
  assert.equal(summary.alertLevel, 'high');
});

test('buildMonitoringAlerts flags a single logged absence', () => {
  const alerts = buildMonitoringAlerts(
    [{ id: 1, name: 'Ana Santos', status: 'Accepted' }],
    [],
    [{ app_id: '1', days: 1, reason: 'Illness' }]
  );

  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].type, 'attendance');
  assert.match(alerts[0].message, /1/i);
});

test('buildMonitoringAlerts uses the most recent grade entry across semesters', () => {
  const alerts = buildMonitoringAlerts(
    [{ id: 1, name: 'Ana Santos', status: 'Accepted' }],
    [
      { app_id: '1', grade_val: 85, semester: '2024-2025 1st Sem', updated_at: '2025-01-10T10:00:00Z' },
      { app_id: '1', grade_val: 72, semester: '2025-2026 1st Sem', updated_at: '2025-08-15T10:00:00Z' }
    ],
    []
  );

  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].type, 'academic');
  assert.match(alerts[0].message, /72/);
});
