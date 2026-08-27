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
- Only include top-level learning areas as rows in "subjects" (e.g. Filipino, English, Mathematics, Science, Araling Panlipunan, TLE, MAPEH, EsP).
- If the report card includes a MAPEH summary row plus Music/Arts/PE/Health subcomponent rows, return only the top-level "MAPEH" row and ignore the subcomponent rows.
- If a cell is blank, smudged, or you cannot read it with confidence, use null for that field AND add a short label for it to "uncertainFields". Never guess a digit you can't clearly see.
- Grades on these report cards are normally whole numbers from 60-100. If you read something outside that range, still report exactly what you read (do not clamp it) — the caller will flag it.
- Do not include any text outside the JSON object.`;

function extractJsonFromText(text) {
  const trimmed = String(text || '').trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('No JSON object found in extraction response');
  }
  return JSON.parse(candidate.slice(start, end + 1));
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
    result.subjects = [combined, ...result.subjects.filter(s => !mapehSubNames.has(lowerName(s.name)))];
  } else if (hasMapehRow && mapehSubcomponents.length > 0) {
    result.subjects = result.subjects.filter(s => !mapehSubNames.has(lowerName(s.name)));
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

/**
 * @param {{ fileData: string, fileType: string }} image
 * @returns {Promise<object>} parsed extraction result matching EXTRACTION_PROMPT's schema
 */
async function extractReportCard({ fileData, fileType }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const err = new Error('GEMINI_API_KEY is not configured on the server.');
    err.code = 'NO_API_KEY';
    throw err;
  }

  const response = await fetch(`${GEMINI_API_URL}/${MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      generationConfig: {
        maxOutputTokens: 800,
        temperature: 0,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: {
            schoolYear: { type: 'STRING', nullable: true },
            gradeLevel: { type: 'STRING', nullable: true },
            subjects: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: {
                  name: { type: 'STRING' },
                  q1: { type: 'NUMBER', nullable: true },
                  q2: { type: 'NUMBER', nullable: true },
                  q3: { type: 'NUMBER', nullable: true },
                  q4: { type: 'NUMBER', nullable: true },
                  final: { type: 'NUMBER', nullable: true },
                },
                required: ['name'],
              },
            },
            generalAverage: { type: 'NUMBER', nullable: true },
            confidence: { type: 'NUMBER' },
            uncertainFields: { type: 'ARRAY', items: { type: 'STRING' } },
          },
          required: ['schoolYear', 'gradeLevel', 'subjects', 'generalAverage', 'confidence', 'uncertainFields'],
        },
      },
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: { mimeType: mimeFromFileType(fileType), data: base64Only(fileData) },
            },
            { text: EXTRACTION_PROMPT },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    const err = new Error(`Extraction API error (${response.status}): ${errBody.slice(0, 300)}`);
    err.code = 'API_ERROR';
    throw err;
  }

  const data = await response.json();
  const text = data.candidates?.[0]?.content?.parts?.find(part => part.text)?.text;
  if (!text) {
    const reason = data.candidates?.[0]?.finishReason || data.promptFeedback?.blockReason || 'unknown reason';
    throw new Error(`Extraction response contained no text content (${reason})`);
  }

  return extractJsonFromText(text);
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
  if (confidence < 0.7) {
    flags.push(`Overall extraction confidence is low (${Math.round(confidence * 100)}%) — review carefully against the photo.`);
  }

  (extracted?.uncertainFields || []).forEach(field => {
    flags.push(`Model was unsure about: ${field}.`);
  });

  return flags;
}

module.exports = { extractReportCard, computeFlags, GRADE_MIN, GRADE_MAX, normalizeExtractionResult, parseNumber };
