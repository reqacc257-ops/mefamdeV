const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const { requireAuth, requireRole } = require('../middleware/auth');

const secret = process.env.JWT_SECRET || 'mefamdev-secret-change-in-production';

test('requireAuth does not trust a pre-populated request user', () => {
  const req = { user: { type: 'staff', role: 'director' }, headers: {} };
  let nextCalled = false;
  const res = { status: () => res, json: body => body };

  const result = requireAuth(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.deepEqual(result, { error: 'No token provided' });
});

test('requireAuth accepts only a verified Bearer token', () => {
  const req = { headers: { authorization: `Bearer ${jwt.sign({ type: 'staff', role: 'director' }, secret)}` } };
  let nextCalled = false;
  const res = { status: () => res, json: body => body };

  requireAuth(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.equal(req.user.role, 'director');
});

test('requireRole rejects authenticated applicant tokens', () => {
  const req = { user: { type: 'applicant', role: 'director' } };
  let nextCalled = false;
  const res = { status: () => res, json: body => body };

  const result = requireRole('director')(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.deepEqual(result, { error: 'Insufficient permissions' });
});