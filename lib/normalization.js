const db = require('../db');

const DEFAULT_GRADE_MIN = 60;
const DEFAULT_GRADE_MAX = 100;
const DEFAULT_CONFIDENCE_THRESHOLD = 0.75;

function cleanText(raw) {
  if (raw === null || raw === undefined) return '';
  return String(raw)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshteinDistance(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const matrix = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) matrix[0][j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[a.length][b.length];
}

function textSimilarity(a, b) {
  const normalizedA = cleanText(a);
  const normalizedB = cleanText(b);
  if (!normalizedA && !normalizedB) return 1;
  if (!normalizedA || !normalizedB) return 0;
  const maxLen = Math.max(normalizedA.length, normalizedB.length);
  if (!maxLen) return 1;
  return 1 - (levenshteinDistance(normalizedA, normalizedB) / maxLen);
}

async function getSubjectAliasRows(schoolId) {
  // This repo's memory-store does not reliably support OR/IS NULL filtering, so we fetch
  // the alias table in one pass and apply school/global precedence in JavaScript.
  const rows = await db.prepare('SELECT * FROM subject_aliases').all();
  return Array.isArray(rows) ? rows : [];
}

async function normalizeSubject(rawText, schoolId) {
  const input = cleanText(rawText);
  if (!input) {
    return { canonicalSubjectId: null, matchedAlias: null, confidence: 0, method: 'unresolved' };
  }

  const aliasRows = await getSubjectAliasRows(schoolId);
  if (!Array.isArray(aliasRows) || aliasRows.length === 0) {
    return { canonicalSubjectId: null, matchedAlias: null, confidence: 0, method: 'unresolved' };
  }

  const schoolExact = aliasRows.filter(row => Number(row.school_id) === Number(schoolId) && cleanText(row.alias_text) === input);
  if (schoolExact.length > 0) {
    const row = schoolExact[0];
    return {
      canonicalSubjectId: Number(row.canonical_subject_id || row.canonicalSubjectId || null),
      matchedAlias: row.alias_text,
      confidence: 1,
      method: 'exact-school',
    };
  }

  const globalExact = aliasRows.filter(row => row.school_id === null && cleanText(row.alias_text) === input);
  if (globalExact.length > 0) {
    const row = globalExact[0];
    return {
      canonicalSubjectId: Number(row.canonical_subject_id || row.canonicalSubjectId || null),
      matchedAlias: row.alias_text,
      confidence: 1,
      method: 'exact-global',
    };
  }

  const schoolCandidates = aliasRows.filter(row => Number(row.school_id) === Number(schoolId));
  const globalCandidates = aliasRows.filter(row => row.school_id === null);
  const rankedCandidates = [...schoolCandidates, ...globalCandidates];

  let bestMatch = null;
  for (const row of rankedCandidates) {
    const score = textSimilarity(row.alias_text, input);
    if (score >= 0.82 && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { row, score };
    }
  }

  if (bestMatch) {
    const { row, score } = bestMatch;
    return {
      canonicalSubjectId: Number(row.canonical_subject_id || row.canonicalSubjectId || null),
      matchedAlias: row.alias_text,
      confidence: Number(score.toFixed(3)),
      method: 'fuzzy',
    };
  }

  return { canonicalSubjectId: null, matchedAlias: null, confidence: 0, method: 'unresolved' };
}

function parsePeriodText(rawText, schoolDefaultPeriodType) {
  const text = cleanText(rawText || '');
  const defaultType = schoolDefaultPeriodType || 'quarter';

  if (!text) {
    return { periodType: defaultType, periodNumber: null, confidence: 0.15 };
  }

  const quarterMatch = text.match(/(?:quarter|q)\s*([1-9]|10)/i) || text.match(/\b([1-9]|10)\b.*(?:quarter|q)\b/i);
  if (quarterMatch) {
    const number = Number((quarterMatch[1] || quarterMatch[0]).replace(/[^0-9]/g, ''));
    if (Number.isFinite(number)) {
      return { periodType: 'quarter', periodNumber: number, confidence: 0.95 };
    }
  }

  const trimesterMatch = text.match(/(?:1st|2nd|3rd|4th|5th|6th|7th|8th|9th|10th|[1-9]|10)\s*(?:trimester|tri)/i) || text.match(/(?:trimester|tri)\s*(?:1st|2nd|3rd|4th|5th|6th|7th|8th|9th|10th|[1-9]|10)/i);
  if (trimesterMatch) {
    const number = Number(String(trimesterMatch[0]).match(/(?:1st|2nd|3rd|4th|5th|6th|7th|8th|9th|10th|[1-9]|10)/i)?.[0]?.replace(/[^0-9]/g, '') || 0);
    if (Number.isFinite(number) && number > 0) {
      return { periodType: 'trimester', periodNumber: number, confidence: 0.96 };
    }
  }

  const termMatch = text.match(/(?:1st|2nd|3rd|4th|5th|6th|7th|8th|9th|10th|[1-9]|10)\s*(?:term|terms)/i) || text.match(/(?:term|terms)\s*(?:1st|2nd|3rd|4th|5th|6th|7th|8th|9th|10th|[1-9]|10)/i);
  if (termMatch) {
    const number = Number(String(termMatch[0]).match(/(?:1st|2nd|3rd|4th|5th|6th|7th|8th|9th|10th|[1-9]|10)/i)?.[0]?.replace(/[^0-9]/g, '') || 0);
    if (Number.isFinite(number) && number > 0) {
      return { periodType: 'term', periodNumber: number, confidence: 0.94 };
    }
  }

  const numericOnly = text.match(/(?:^|\s)([1-9]|10)(?:$|\s)/i);
  if (numericOnly) {
    const number = Number(numericOnly[1]);
    if (Number.isFinite(number)) {
      return { periodType: defaultType, periodNumber: number, confidence: 0.65 };
    }
  }

  return { periodType: defaultType, periodNumber: null, confidence: 0.2 };
}

async function normalizePeriod(rawText, schoolId, schoolYear) {
  const schoolRow = await db.prepare('SELECT * FROM schools WHERE id = ?').get(schoolId);
  const defaultType = (schoolRow && schoolRow.default_period_type) || 'quarter';
  const parsed = parsePeriodText(rawText, defaultType);

  if (!parsed.periodNumber) {
    return {
      gradingPeriodId: null,
      periodType: parsed.periodType || defaultType,
      periodNumber: null,
      confidence: Number(Math.min(parsed.confidence || 0, 0.5).toFixed(3)),
    };
  }

  const existing = await db.prepare(
    'SELECT * FROM grading_periods WHERE school_id = ? AND school_year = ? AND period_type = ? AND period_number = ?'
  ).get(schoolId, schoolYear, parsed.periodType, parsed.periodNumber);

  if (existing) {
    return {
      gradingPeriodId: Number(existing.id),
      periodType: existing.period_type || parsed.periodType,
      periodNumber: Number(existing.period_number || parsed.periodNumber),
      confidence: Number((parsed.confidence || 0.5).toFixed(3)),
    };
  }

  return {
    gradingPeriodId: null,
    periodType: parsed.periodType || defaultType,
    periodNumber: Number(parsed.periodNumber),
    confidence: Number(Math.max((parsed.confidence || 0) * 0.6, 0.35).toFixed(3)),
  };
}

async function getSchoolGradeBounds(schoolId) {
  try {
    const row = await db.prepare('SELECT grade_min, grade_max FROM schools WHERE id = ?').get(schoolId);
    if (row && row.grade_min !== undefined && row.grade_max !== undefined) {
      return {
        min: Number(row.grade_min),
        max: Number(row.grade_max),
      };
    }
  } catch (_error) {
    // The project does not add grade_min/grade_max columns by default, so we intentionally
    // fall back to the standard DepEd-style range rather than assuming a Postgres-only schema.
  }

  return {
    min: DEFAULT_GRADE_MIN,
    max: DEFAULT_GRADE_MAX,
  };
}

function validateGrade(rawGrade, min, max) {
  const lowerBound = Number.isFinite(Number(min)) ? Number(min) : DEFAULT_GRADE_MIN;
  const upperBound = Number.isFinite(Number(max)) ? Number(max) : DEFAULT_GRADE_MAX;

  if (rawGrade === null || rawGrade === undefined || String(rawGrade).trim() === '') {
    return { valid: false, normalizedValue: null, confidence: 0, reason: 'unparseable grade: empty value' };
  }

  const numMatch = String(rawGrade).match(/-?\d+(?:\.\d+)?/);
  if (!numMatch) {
    return { valid: false, normalizedValue: null, confidence: 0, reason: 'unparseable grade: no numeric value found' };
  }

  const normalizedValue = Number(numMatch[0]);
  if (!Number.isFinite(normalizedValue)) {
    return { valid: false, normalizedValue: null, confidence: 0, reason: 'unparseable grade: non-numeric value' };
  }

  if (normalizedValue < lowerBound || normalizedValue > upperBound) {
    return {
      valid: false,
      normalizedValue,
      confidence: 0,
      reason: `grade out of range: ${normalizedValue} not between ${lowerBound} and ${upperBound}`,
    };
  }

  return {
    valid: true,
    normalizedValue,
    confidence: 1,
    reason: null,
  };
}

async function buildGradeEntryCandidate({ studentId, schoolId, schoolYear, rawSubjectText, rawPeriodText, rawGrade }) {
  const subjectResult = await normalizeSubject(rawSubjectText, schoolId);
  const periodResult = await normalizePeriod(rawPeriodText, schoolId, schoolYear);
  const schoolBounds = await getSchoolGradeBounds(schoolId);
  const gradeResult = validateGrade(rawGrade, schoolBounds.min, schoolBounds.max);

  const notes = [];
  if (!subjectResult.canonicalSubjectId) notes.push('subject unresolved');
  if (!periodResult.gradingPeriodId) notes.push('period unresolved');
  if (!gradeResult.valid) notes.push('grade invalid');

  const overallConfidence = Math.min(
    Number(subjectResult.confidence || 0),
    Number(periodResult.confidence || 0),
    Number(gradeResult.confidence || 0)
  );

  if (overallConfidence < DEFAULT_CONFIDENCE_THRESHOLD) {
    notes.push(`confidence below ${DEFAULT_CONFIDENCE_THRESHOLD}`);
  }

  const needsReview = Boolean(
    !subjectResult.canonicalSubjectId ||
    !periodResult.gradingPeriodId ||
    !gradeResult.valid ||
    overallConfidence < DEFAULT_CONFIDENCE_THRESHOLD
  );

  const candidate = {
    student_id: studentId,
    canonical_subject_id: subjectResult.canonicalSubjectId || null,
    grading_period_id: periodResult.gradingPeriodId || null,
    raw_grade: rawGrade !== undefined && rawGrade !== null ? String(rawGrade) : null,
    normalized_grade: gradeResult.normalizedValue ?? null,
    source: 'ocr',
    confidence: Number(overallConfidence.toFixed(3)),
    needs_review: needsReview,
    review_notes: notes.length ? notes.join('; ') : null,
  };

  return candidate;
}

module.exports = {
  cleanText,
  normalizeSubject,
  parsePeriodText,
  normalizePeriod,
  validateGrade,
  buildGradeEntryCandidate,
};
