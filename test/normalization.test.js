const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../db');
const {
  cleanText,
  normalizeSubject,
  parsePeriodText,
  normalizePeriod,
  validateGrade,
  buildGradeEntryCandidate,
} = require('../lib/normalization');

function resetNormalizationFixtures() {
  db.data = db.data || {};
  db.data.subject_aliases = [
    { id: 1, canonical_subject_id: 1, school_id: null, alias_text: 'math' },
    { id: 2, canonical_subject_id: 1, school_id: null, alias_text: 'mathematics' },
    { id: 3, canonical_subject_id: 2, school_id: null, alias_text: 'english' },
    { id: 4, canonical_subject_id: 5, school_id: null, alias_text: 'araling panlipunan' },
    { id: 5, canonical_subject_id: 5, school_id: null, alias_text: 'social studies' },
    { id: 6, canonical_subject_id: 5, school_id: 77, alias_text: 'social studies' },
    { id: 7, canonical_subject_id: 5, school_id: 77, alias_text: 'araling panlipunan' },
    { id: 8, canonical_subject_id: 4, school_id: null, alias_text: 'filipino' },
    { id: 9, canonical_subject_id: 6, school_id: null, alias_text: 'pe' },
  ];

  db.data.schools = [
    { id: 77, name: 'School A', default_period_type: 'trimester' },
    { id: 99, name: 'School B', default_period_type: 'quarter' },
  ];

  db.data.grading_periods = [
    { id: 1, school_id: 77, period_type: 'trimester', period_number: 1, label: '1st Trimester', school_year: '2025-2026' },
    { id: 2, school_id: 77, period_type: 'trimester', period_number: 2, label: '2nd Trimester', school_year: '2025-2026' },
    { id: 3, school_id: 99, period_type: 'quarter', period_number: 2, label: 'Quarter 2', school_year: '2025-2026' },
  ];
}

test('cleanText strips punctuation and collapses whitespace', () => {
  assert.equal(cleanText('  Math!!!  /  Science  '), 'math science');
});

test('normalizeSubject resolves exact match before fuzzy fallback', async () => {
  resetNormalizationFixtures();

  const exactResult = await normalizeSubject('Mathematics', 99);
  assert.equal(exactResult.method, 'exact-global');
  assert.equal(exactResult.canonicalSubjectId, 1);

  const fuzzyResult = await normalizeSubject('Mathemtics', 99);
  assert.equal(fuzzyResult.method, 'fuzzy');
  assert.equal(fuzzyResult.canonicalSubjectId, 1);

  const unresolved = await normalizeSubject('Mystery Subject', 99);
  assert.equal(unresolved.canonicalSubjectId, null);
  assert.equal(unresolved.method, 'unresolved');
});

test('school-scoped alias overrides the same global alias text', async () => {
  resetNormalizationFixtures();

  const scoped = await normalizeSubject('social studies', 77);
  assert.equal(scoped.canonicalSubjectId, 5);
  assert.equal(scoped.matchedAlias, 'social studies');
  assert.equal(scoped.method, 'exact-school');

  const globalOnly = await normalizeSubject('social studies', 99);
  assert.equal(globalOnly.canonicalSubjectId, 5);
  assert.equal(globalOnly.method, 'exact-global');
});

test('parsePeriodText handles quarter, trimester, and term inputs', () => {
  assert.deepEqual(parsePeriodText('Quarter 2', 'quarter'), { periodType: 'quarter', periodNumber: 2, confidence: 0.95 });
  assert.deepEqual(parsePeriodText('1st Trimester', 'quarter'), { periodType: 'trimester', periodNumber: 1, confidence: 0.96 });
  assert.deepEqual(parsePeriodText('3rd Term', 'quarter'), { periodType: 'term', periodNumber: 3, confidence: 0.94 });
});

test('normalizePeriod resolves a matching grading_period row or returns null when it does not exist', async () => {
  resetNormalizationFixtures();

  const found = await normalizePeriod('Quarter 2', 99, '2025-2026');
  assert.equal(found.gradingPeriodId, 3);
  assert.equal(found.periodType, 'quarter');

  const missing = await normalizePeriod('Quarter 4', 99, '2025-2026');
  assert.equal(missing.gradingPeriodId, null);
  assert.equal(missing.periodType, 'quarter');
  assert.ok(missing.confidence < 1);
});

test('validateGrade supports valid, out-of-range, and unparseable grades', () => {
  const valid = validateGrade('88%', 60, 100);
  assert.equal(valid.valid, true);
  assert.equal(valid.normalizedValue, 88);

  const outOfRange = validateGrade('110', 60, 100);
  assert.equal(outOfRange.valid, false);
  assert.ok(outOfRange.reason.includes('out of range'));

  const unparseable = validateGrade('N/A', 60, 100);
  assert.equal(unparseable.valid, false);
  assert.ok(unparseable.reason.includes('unparseable'));
});

test('buildGradeEntryCandidate resolves a clean candidate and flags single-field failures', async () => {
  resetNormalizationFixtures();

  const resolved = await buildGradeEntryCandidate({
    studentId: 42,
    schoolId: 99,
    schoolYear: '2025-2026',
    rawSubjectText: 'Mathematics',
    rawPeriodText: 'Quarter 2',
    rawGrade: '88',
  });

  assert.equal(resolved.needs_review, false);
  assert.equal(resolved.canonical_subject_id, 1);
  assert.equal(resolved.grading_period_id, 3);
  assert.equal(resolved.normalized_grade, 88);

  const badSubject = await buildGradeEntryCandidate({
    studentId: 42,
    schoolId: 99,
    schoolYear: '2025-2026',
    rawSubjectText: 'Unknown course',
    rawPeriodText: 'Quarter 2',
    rawGrade: '88',
  });
  assert.equal(badSubject.needs_review, true);
  assert.match(badSubject.review_notes, /subject/i);

  const badPeriod = await buildGradeEntryCandidate({
    studentId: 42,
    schoolId: 99,
    schoolYear: '2025-2026',
    rawSubjectText: 'Math',
    rawPeriodText: 'Quarter 99',
    rawGrade: '88',
  });
  assert.equal(badPeriod.needs_review, true);
  assert.match(badPeriod.review_notes, /period/i);

  const badGrade = await buildGradeEntryCandidate({
    studentId: 42,
    schoolId: 99,
    schoolYear: '2025-2026',
    rawSubjectText: 'Math',
    rawPeriodText: 'Quarter 2',
    rawGrade: '120',
  });
  assert.equal(badGrade.needs_review, true);
  assert.match(badGrade.review_notes, /grade/i);
});
