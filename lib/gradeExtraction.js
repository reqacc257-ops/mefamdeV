/**
 * lib/gradeExtraction.js
 *
 * Sends a (quality-checked) report card photo to Gemini's vision API and
 * asks for strict structured JSON. Nothing this module returns is ever
 * written to the `grades` table directly — routes/gradeExtraction.js always
 * routes the result through a staff review/approval step first.
 *
 * Requires GEMINI_API_KEY to be set in the environment. Get a key at
 * https://aistudio.google.com/app/apikey
 */
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const OCR_SPACE_URL = 'https://api.ocr.space/parse/image';

const EXTRACTION_PROMPT = `You are extracting data from a photo of a Philippine DepEd-style report card (SF9 / "Report on Learning Progress and Achievement").

Return ONLY valid JSON — no markdown code fences, no commentary before or after — matching exactly this shape:

{
  "schoolYear": string or null,
  "gradeLevel": string or null,
  "subjects": [
    { "name": string, "q1": number or null, "q2": number or null, "q3": number or null, "q4": number or null, "final": number or null }
  ],
  "generalAverage": number or null,
  "confidence": number between 0 and 1 (your overall confidence reading this specific photo),
  "uncertainFields": [string, ...]  // short labels like "Science Q3" or "General Average" for any cell you could not read with confidence
}

Rules:
- Include every visible learning-area row, including MAPEH and its Music, Arts, PE, and Health subcomponent rows.
- This may be either a Periodic Rating layout with columns 1, 2, 3, 4, Final Rating, or a DepEd layout with Quarter 1, 2, 3, 4, Final Grade.
- Recognize these row labels and keep them as separate subjects when visible: Filipino, English, Science & Health, Mathematics, Makabayan, Technology & Livelihood Education (TLE), MAPEH, Music, Arts, Physical Education (PE), Health, Edukasyon sa Pagpapakatao (EsP), MSEP, HKS/Heograpiya-Kasaysayan-Sibika, EPP, and Character Education.
- If a cell is blank, smudged, or you cannot read it with confidence, use null for that field AND add a short label for it to "uncertainFields". Never guess a digit you can't clearly see.
- Grades on these report cards are normally whole numbers from 60-100. If you read something outside that range, still report exactly what you read (do not clamp it) — the caller will flag it.
- Do not include any text outside the JSON object.`;

function extractJsonFromText(text) {
  const trimmed = String(text || '').trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : trimmed).trim();
  try {
    const direct = JSON.parse(candidate);
    if (direct && typeof direct === 'object' && !Array.isArray(direct)) return direct;
    if (typeof direct === 'string') {
      const nested = JSON.parse(direct);
      if (nested && typeof nested === 'object' && !Array.isArray(nested)) return nested;
    }
  } catch (_) {
    // Fall through to extracting an object from surrounding model text.
  }
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('Gemini returned no readable JSON. Please upload the report card again.');
  }
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch (_) {
    throw new Error('Gemini returned invalid JSON. Please upload the report card again.');
  }
}

function parseNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value).trim().replace(/,/g, '');
  if (!normalized) return null;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeExtractionResult(raw) {
  const result = {
    schoolYear: raw?.schoolYear ? String(raw.schoolYear).trim() || null : null,
    gradeLevel: raw?.gradeLevel ? String(raw.gradeLevel).trim() || null : null,
    generalAverage: parseNumber(raw?.generalAverage),
    confidence: (() => {
      const c = parseNumber(raw?.confidence);
      return c !== null && c >= 0 && c <= 1 ? c : 1;
    })(),
    uncertainFields: Array.isArray(raw?.uncertainFields)
      ? raw.uncertainFields.map(String).filter(Boolean)
      : [],
    subjects: [],
  };

  if (Array.isArray(raw?.subjects)) {
    result.subjects = raw.subjects.map(subject => ({
      name: subject?.name ? String(subject.name).trim() : '',
      q1: parseNumber(subject?.q1),
      q2: parseNumber(subject?.q2),
      q3: parseNumber(subject?.q3),
      q4: parseNumber(subject?.q4),
      final: parseNumber(subject?.final),
    })).filter(subject => subject.name);
  }

  const canonicalSubjectName = (name) => {
    const normalized = String(name || '').toLowerCase().replace(/&/g, 'and').replace(/\s+/g, ' ').trim();
    if (normalized.includes('technology') && normalized.includes('livelihood') || normalized === 'education (tle)' || normalized === 'tle') {
      return 'Technology and Livelihood Education (TLE)';
    }
    return String(name || '').trim();
  };
  const mergedSubjects = new Map();
  result.subjects.forEach(subject => {
    const name = canonicalSubjectName(subject.name);
    const existing = mergedSubjects.get(name);
    if (!existing) {
      mergedSubjects.set(name, { ...subject, name });
      return;
    }
    ['q1', 'q2', 'q3', 'q4', 'final'].forEach(field => {
      if (existing[field] === null && subject[field] !== null) existing[field] = subject[field];
    });
  });
  result.subjects = Array.from(mergedSubjects.values());

  const lowerName = (name) => String(name || '').trim().toLowerCase();
  const mapehSubNames = new Set(['music', 'arts', 'pe', 'health']);
  const hasMapehRow = result.subjects.some(s => lowerName(s.name) === 'mapeh');
  const mapehSubcomponents = result.subjects.filter(s => mapehSubNames.has(lowerName(s.name)));

  if (!hasMapehRow && mapehSubcomponents.length > 0) {
    const combined = { name: 'MAPEH', q1: null, q2: null, q3: null, q4: null, final: null };
    ['q1', 'q2', 'q3', 'q4'].forEach((key) => {
      const values = mapehSubcomponents.map(sub => sub[key]).filter(v => v !== null);
      if (values.length === mapehSubcomponents.length) {
        combined[key] = Math.round(values.reduce((sum, v) => sum + v, 0) / values.length * 10) / 10;
      }
    });
    const finalValues = mapehSubcomponents.map(sub => sub.final).filter(v => v !== null);
    if (finalValues.length === mapehSubcomponents.length) {
      combined.final = Math.round(finalValues.reduce((sum, v) => sum + v, 0) / finalValues.length * 10) / 10;
    } else {
      const quarterValues = ['q1', 'q2', 'q3', 'q4'].map(key => combined[key]).filter(v => v !== null);
      if (quarterValues.length) {
        combined.final = Math.round(quarterValues.reduce((sum, v) => sum + v, 0) / quarterValues.length * 10) / 10;
      }
    }
    result.subjects = [combined, ...result.subjects];
  } else if (hasMapehRow) {
    // Keep the component rows: some report cards show both the MAPEH summary
    // and its visible learning-area components.
  }

  return result;
}

function mimeFromFileType(fileType) {
  const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (allowed.includes(fileType)) return fileType;
  return 'image/jpeg';
}

function base64Only(fileData) {
  const raw = String(fileData || '');
  return raw.includes(',') ? raw.split(',')[1] : raw;
}

async function requestGemini(apiKey, mimeType, imageData, generationConfig, prompt = EXTRACTION_PROMPT) {
  const response = await fetch(`${GEMINI_API_URL}/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      generationConfig,
      contents: [{
        role: 'user',
        parts: [
          { inlineData: { mimeType, data: imageData } },
          { text: prompt },
        ],
      }],
    }),
  });
  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    const err = new Error(`Extraction API error (${response.status}): ${errBody.slice(0, 300)}`);
    err.code = response.status === 429 ? 'GEMINI_RATE_LIMITED' : 'API_ERROR';
    throw err;
  }
  return response.json();
}

async function extractWithOcrSpace(apiKey, mimeType, imageData) {
  const body = new URLSearchParams({
    base64Image: `data:${mimeType};base64,${imageData}`,
    language: 'auto',
    OCREngine: '3',
    isTable: 'true',
    scale: 'true',
    isOverlayRequired: 'false',
  });
  const response = await fetch(OCR_SPACE_URL, {
    method: 'POST',
    headers: { apikey: apiKey, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!response.ok) {
    const err = new Error(`OCR.space API error (${response.status})`);
    err.code = response.status === 429 ? 'OCR_SPACE_RATE_LIMITED' : 'OCR_SPACE_API_ERROR';
    throw err;
  }
  const data = await response.json();
  if (data.IsErroredOnProcessing || !Array.isArray(data.ParsedResults)) {
    throw new Error(data.ErrorMessage || 'OCR.space could not read this image.');
  }
  const text = data.ParsedResults.map(result => result.ParsedText || '').join('\n');
  return parseOcrSpaceText(text);
}

function parseOcrSpaceText(text) {
  const subjects = [];
  const names = [
    ['Filipino', /filipino/i],
    ['English', /english/i],
    ['Science', /science(?:\s*&\s*health)?/i],
    ['Mathematics', /mathematics|math/i],
    ['Makabayan', /makabayan/i],
    ['Araling Panlipunan', /araling\s+panlipunan|\bapi\b/i],
    ['Technology and Livelihood Education', /technology\s*(?:&|and)?\s*livelihood|\btle\b/i],
    ['MAPEH', /mapeh/i],
    ['Music', /music/i],
    ['Arts', /\barts?\b/i],
    ['Physical Education', /physical\s+education|\bpe\b/i],
    ['Health', /\bhealth\b/i],
    ['MSEP', /msep|musika,?\s*sining/i],
    ['HKS', /heograpiya|kasaysayan|sibika\s*\(?hks/i],
    ['EPP', /edukasyong\s+pantahanan|pangakabuhayan|\bepp\b/i],
    ['Character Education', /character\s+education/i],
    ['Edukasyon sa Pagpapakatao', /edukasyon\s+sa\s+pagpapakatao|\besp\b/i],
  ];
  let current = null;
  const finishSubject = () => {
    if (!current) return;
    subjects.push({
      name: current.name,
      q1: current.numbers[0] ?? null,
      q2: current.numbers[1] ?? null,
      q3: current.numbers[2] ?? null,
      q4: current.numbers[3] ?? null,
      final: current.numbers[4] ?? null,
    });
    current = null;
  };
  String(text || '').split(/\r?\n/).forEach(line => {
    const match = names.find(([, pattern]) => pattern.test(line));
    if (match) {
      finishSubject();
      current = { name: match[0], numbers: [] };
    } else if (!current) {
      // Keep unfamiliar learning areas when OCR returns a row label and its
      // grades on one line. Known headers and summary rows are excluded.
      const numbers = (line.match(/\b(?:[6-9]\d|100)(?:\.\d+)?\b/g) || []).map(Number);
      const label = line
        .replace(/\b(?:[6-9]\d|100)(?:\.\d+)?\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^[|:;,.-]+|[|:;,.-]+$/g, '')
        .trim();
      const excluded = /^(learning areas?|term|terms|quarter|quarters|final( grade)?|remarks?|general average|school year)$/i.test(label);
      if (numbers.length >= 2 && /[a-z]/i.test(label) && !excluded) {
        current = { name: label, numbers: [] };
      }
    }
    if (current) {
      const numbers = (line.match(/\b(?:[6-9]\d|100)(?:\.\d+)?\b/g) || []).map(Number);
      current.numbers.push(...numbers.slice(0, Math.max(0, 5 - current.numbers.length)));
    }
  });
  finishSubject();
  const generalMatch = String(text || '').match(/general\s+average[^\d]*(\d{2}(?:\.\d+)?|100)/i);
  return normalizeExtractionResult({
    schoolYear: null,
    gradeLevel: null,
    subjects,
    generalAverage: generalMatch ? Number(generalMatch[1]) : null,
    confidence: subjects.length ? 0.65 : 0,
    uncertainFields: subjects.length ? [] : ['Subjects and grades'],
  });
}

/**
 * @param {{ fileData: string, fileType: string }} image
 * @returns {Promise<object>} parsed extraction result matching EXTRACTION_PROMPT's schema
 */
async function extractReportCard({ fileData, fileType }) {
  const provider = String(process.env.GRADE_EXTRACTION_PROVIDER || 'ocr-space').toLowerCase();
  if (provider !== 'ocr-space') {
    const err = new Error('Only OCR.space is enabled for report-card extraction.');
    err.code = 'UNSUPPORTED_EXTRACTION_PROVIDER';
    throw err;
  }

  const ocrKey = process.env.OCR_SPACE_API_KEY;
  if (!ocrKey) {
    const err = new Error('OCR_SPACE_API_KEY is not configured on the server.');
    err.code = 'NO_API_KEY';
    throw err;
  }
  return extractWithOcrSpace(ocrKey, mimeFromFileType(fileType), base64Only(fileData));
}

const GRADE_MIN = 60;
const GRADE_MAX = 100;
const TOLERANCE = 2; // how far a computed check can drift from the stated value before flagging

/**
 * Cross-checks the model's own extraction against itself — never trusts a
 * single number blind. Anything flagged here gets highlighted for the staff
 * reviewer instead of silently accepted.
 * @returns {string[]} human-readable flags
 */
function computeFlags(extracted) {
  const flags = [];
  const subjects = Array.isArray(extracted?.subjects) ? extracted.subjects : [];

  if (!subjects.length) {
    flags.push('No subjects were extracted — the photo may be unreadable or not a report card.');
  }

  subjects.forEach(s => {
    const name = s?.name || 'Unnamed subject';
    ['q1', 'q2', 'q3', 'q4', 'final'].forEach(field => {
      const val = s?.[field];
      if (val !== null && val !== undefined && (val < GRADE_MIN || val > GRADE_MAX)) {
        flags.push(`${name} ${field.toUpperCase()}: ${val} is outside the expected 60-100 range.`);
      }
    });

    const quarterVals = ['q1', 'q2', 'q3', 'q4'].map(f => s?.[f]).filter(v => v !== null && v !== undefined);
    if (quarterVals.length && s?.final !== null && s?.final !== undefined) {
      const computedFinal = quarterVals.reduce((a, b) => a + b, 0) / quarterVals.length;
      if (Math.abs(computedFinal - s.final) > TOLERANCE) {
        flags.push(`${name}: stated final (${s.final}) doesn't match the average of its quarter grades (~${computedFinal.toFixed(1)}).`);
      }
    }
  });

  const subjectFinals = subjects.map(s => s?.final).filter(v => v !== null && v !== undefined);
  if (subjectFinals.length && extracted?.generalAverage !== null && extracted?.generalAverage !== undefined) {
    const computedAvg = subjectFinals.reduce((a, b) => a + b, 0) / subjectFinals.length;
    if (Math.abs(computedAvg - extracted.generalAverage) > TOLERANCE) {
      flags.push(`Stated general average (${extracted.generalAverage}) doesn't match the average of subject finals (~${computedAvg.toFixed(1)}).`);
    }
  }

  const confidence = typeof extracted?.confidence === 'number' ? extracted.confidence : 1;
  if (confidence < 0.95) {
    flags.push('Overall extraction confidence is below the required threshold — review carefully against the photo.');
  }

  (extracted?.uncertainFields || []).forEach(field => {
    flags.push(`Model was unsure about: ${field}.`);
  });

  return flags;
}

module.exports = { extractReportCard, computeFlags, GRADE_MIN, GRADE_MAX, normalizeExtractionResult, parseNumber };
