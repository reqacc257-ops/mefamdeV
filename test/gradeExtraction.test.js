const test = require('node:test');
const assert = require('assert');
const { normalizeExtractionResult, parseNumber } = require('../lib/gradeExtraction');

test('parseNumber handles numeric strings and nulls', () => {
  assert.strictEqual(parseNumber('86'), 86);
  assert.strictEqual(parseNumber(' 87 '), 87);
  assert.strictEqual(parseNumber(''), null);
  assert.strictEqual(parseNumber(null), null);
  assert.strictEqual(parseNumber('86.5'), 86.5);
});

test('normalizeExtractionResult merges MAPEH subcomponents and parses values', () => {
  const raw = {
    schoolYear: '2025-2026',
    subjects: [
      { name: 'Music', q1: '86', q2: '87' },
      { name: 'Arts', q1: '85', q2: '86' },
      { name: 'PE', q1: '86', q2: '88' },
      { name: 'Technology and Livelihood', q1: null, q2: '91' },
      { name: 'Education (TLE)', q1: '90', q2: null },
      { name: 'Filipino', q1: '80', q2: '84' },
    ],
    generalAverage: '86.2',
    confidence: '0.92',
    uncertainFields: ['Science Q3']
  };

  const norm = normalizeExtractionResult(raw);
  assert.strictEqual(norm.schoolYear, '2025-2026');
  assert.strictEqual(norm.generalAverage, 86.2);
  assert.strictEqual(Math.round(norm.confidence * 100), 92);
  assert.strictEqual(Array.isArray(norm.uncertainFields) && norm.uncertainFields.length, 1);

  const mapeh = norm.subjects.find(s => String(s.name).toLowerCase() === 'mapeh');
  assert.ok(mapeh, 'MAPEH combined row should exist');
  // q1 average of [86,85,86] = 85.666... -> rounded to one decimal -> 85.7
  assert.ok(Math.abs(mapeh.q1 - 85.7) < 0.05, `unexpected mapeh.q1: ${mapeh.q1}`);
  // q2 average of [87,86,88] = 87
  assert.ok(Math.abs(mapeh.q2 - 87) < 0.01, `unexpected mapeh.q2: ${mapeh.q2}`);

  const fil = norm.subjects.find(s => String(s.name).toLowerCase() === 'filipino');
  assert.ok(fil && fil.q1 === 80, 'Filipino q1 should be 80');
  const tleRows = norm.subjects.filter(s => /technology|tle/i.test(s.name));
  assert.strictEqual(tleRows.length, 1, 'TLE variants should merge into one row');
  assert.strictEqual(tleRows[0].q1, 90);
  assert.strictEqual(tleRows[0].q2, 91);
});
