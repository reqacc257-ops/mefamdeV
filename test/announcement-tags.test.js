const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeAnnouncementTag, displayAnnouncementTag } = require('../lib/announcement-tags');

test('announcement tags are normalized consistently regardless of case or emoji', () => {
  assert.equal(normalizeAnnouncementTag('📅 Important'), 'important');
  assert.equal(normalizeAnnouncementTag('IMPORTANT'), 'important');
  assert.equal(normalizeAnnouncementTag('  important  '), 'important');
  assert.equal(normalizeAnnouncementTag('🕊️ Formation'), 'formation');
});

test('display labels preserve a readable tag for the UI', () => {
  assert.equal(displayAnnouncementTag('📅 Important'), '📅 Important');
  assert.equal(displayAnnouncementTag('important'), '📅 Important');
  assert.equal(displayAnnouncementTag('FORMATION'), '🕊️ Formation');
});
