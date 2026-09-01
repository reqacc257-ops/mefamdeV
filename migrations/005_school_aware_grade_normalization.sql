-- Stage 1: school-aware, alias-aware, period-aware grade normalization
-- This keeps legacy quarter-based schools working while allowing trimester/term-based schools.

CREATE TABLE IF NOT EXISTS schools (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  default_period_type TEXT NOT NULL DEFAULT 'quarter' CHECK (default_period_type IN ('quarter', 'trimester', 'term')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS canonical_subjects (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS subject_aliases (
  id BIGSERIAL PRIMARY KEY,
  canonical_subject_id BIGINT NOT NULL REFERENCES canonical_subjects(id) ON DELETE CASCADE,
  school_id BIGINT REFERENCES schools(id) ON DELETE CASCADE,
  alias_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS grading_periods (
  id BIGSERIAL PRIMARY KEY,
  school_id BIGINT NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  period_type TEXT NOT NULL CHECK (period_type IN ('quarter', 'trimester', 'term')),
  period_number INT NOT NULL CHECK (period_number > 0),
  label TEXT NOT NULL,
  school_year TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, school_year, period_type, period_number)
);

CREATE TABLE IF NOT EXISTS grade_entries (
  id BIGSERIAL PRIMARY KEY,
  student_id BIGINT NOT NULL,
  canonical_subject_id BIGINT NOT NULL REFERENCES canonical_subjects(id) ON DELETE RESTRICT,
  grading_period_id BIGINT NOT NULL REFERENCES grading_periods(id) ON DELETE RESTRICT,
  raw_grade TEXT,
  normalized_grade NUMERIC(5,2),
  source TEXT NOT NULL DEFAULT 'ocr' CHECK (source IN ('ocr', 'manual')),
  confidence NUMERIC(4,3) DEFAULT 0.0 CHECK (confidence >= 0.0 AND confidence <= 1.0),
  needs_review BOOLEAN NOT NULL DEFAULT FALSE,
  review_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_subject_alias_school_unique
  ON subject_aliases (school_id, alias_text)
  WHERE school_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_subject_alias_global_unique
  ON subject_aliases (alias_text)
  WHERE school_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_grading_periods_school_year
  ON grading_periods (school_id, school_year, period_type, period_number);

CREATE INDEX IF NOT EXISTS idx_grade_entries_student
  ON grade_entries (student_id, grading_period_id);

CREATE INDEX IF NOT EXISTS idx_grade_entries_review
  ON grade_entries (needs_review, created_at DESC);

-- Core canonical subjects for the common app.
INSERT INTO canonical_subjects (id, name)
VALUES
  (1, 'Math'),
  (2, 'English'),
  (3, 'Science'),
  (4, 'Filipino'),
  (5, 'Social Studies'),
  (6, 'PE'),
  (7, 'Health'),
  (8, 'Computer'),
  (9, 'Music'),
  (10, 'Arts')
ON CONFLICT (id) DO NOTHING;

-- Common global aliases to support existing report card naming variations.
INSERT INTO subject_aliases (canonical_subject_id, school_id, alias_text)
VALUES
  (1, NULL, 'math'),
  (1, NULL, 'mathematics'),
  (1, NULL, 'mathematics / algebra'),
  (2, NULL, 'english'),
  (2, NULL, 'language'),
  (3, NULL, 'science'),
  (3, NULL, 'general science'),
  (4, NULL, 'filipino'),
  (4, NULL, 'tagalog'),
  (5, NULL, 'social studies'),
  (5, NULL, 'araling panlipunan'),
  (5, NULL, 'ap'),
  (6, NULL, 'pe'),
  (6, NULL, 'physical education'),
  (7, NULL, 'health'),
  (8, NULL, 'computer'),
  (8, NULL, 'ict'),
  (9, NULL, 'music'),
  (10, NULL, 'arts'),
  (10, NULL, 'art')
ON CONFLICT DO NOTHING;
