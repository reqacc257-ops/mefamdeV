-- Canonical PostgreSQL schema for the root Express application.
CREATE TABLE IF NOT EXISTS staff (
  id BIGSERIAL PRIMARY KEY, username TEXT NOT NULL UNIQUE, password TEXT NOT NULL,
  role TEXT NOT NULL, name TEXT DEFAULT '', title TEXT DEFAULT '', initials TEXT DEFAULT '', email TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS applications (
  id BIGSERIAL PRIMARY KEY, sy TEXT DEFAULT '', name TEXT DEFAULT '', address TEXT DEFAULT '', barangay TEXT DEFAULT '',
  dob TEXT DEFAULT '', age INTEGER, gender TEXT DEFAULT '', contact TEXT DEFAULT '', email TEXT DEFAULT '', religion TEXT DEFAULT '',
  birthplace TEXT DEFAULT '', talents TEXT DEFAULT '', clubs TEXT DEFAULT '', ambition TEXT DEFAULT '', living_with TEXT DEFAULT '',
  edu_level TEXT DEFAULT '', prev_grade TEXT DEFAULT '', prev_school TEXT DEFAULT '', school TEXT DEFAULT '', grade TEXT DEFAULT '',
  degree TEXT DEFAULT '', why_scholar TEXT DEFAULT '', total_income TEXT DEFAULT '0', total_expense TEXT DEFAULT '0',
  family_members TEXT DEFAULT '[]', properties TEXT DEFAULT '[]', can_provide TEXT DEFAULT '[]', status TEXT DEFAULT 'Pending Review',
  date_label TEXT DEFAULT '', password_hash TEXT, portal_username TEXT, reference_number TEXT DEFAULT '', submitted_at TIMESTAMPTZ,
  submitted_data TEXT DEFAULT '{}', status_updated_at TIMESTAMPTZ, status_history TEXT DEFAULT '[]', cycle_ended_at TIMESTAMPTZ,
  reapply_allowed INTEGER DEFAULT 0, reset_token TEXT
);
CREATE TABLE IF NOT EXISTS families (
  id BIGSERIAL PRIMARY KEY, surname TEXT NOT NULL, guardian TEXT DEFAULT '', barangay TEXT DEFAULT '', contact TEXT DEFAULT '',
  income TEXT DEFAULT '', bracket TEXT DEFAULT '', benefits TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS events (
  id BIGSERIAL PRIMARY KEY, name TEXT NOT NULL, date TEXT DEFAULT '', venue TEXT DEFAULT '', max_att INTEGER DEFAULT 75
);
CREATE TABLE IF NOT EXISTS event_attendance (
  id BIGSERIAL PRIMARY KEY, event_id BIGINT NOT NULL, app_id BIGINT NOT NULL, UNIQUE(event_id, app_id)
);
CREATE TABLE IF NOT EXISTS event_sessions (
  id BIGSERIAL PRIMARY KEY, event_id BIGINT NOT NULL, code TEXT NOT NULL, started_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ, active INTEGER DEFAULT 1
);
CREATE TABLE IF NOT EXISTS event_checkins (
  id BIGSERIAL PRIMARY KEY, event_id BIGINT NOT NULL, session_id BIGINT NOT NULL, student_id TEXT NOT NULL,
  student_name TEXT NOT NULL, checked_in_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS absences (
  id BIGSERIAL PRIMARY KEY, app_id BIGINT NOT NULL UNIQUE, days INTEGER DEFAULT 0, reason TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS grades (
  id BIGSERIAL PRIMARY KEY, app_id BIGINT NOT NULL, school_year TEXT DEFAULT '', subject TEXT DEFAULT '', quarter TEXT,
  grade_val NUMERIC, semester TEXT, updated_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS fund_log (
  id BIGSERIAL PRIMARY KEY, source TEXT NOT NULL, amount NUMERIC NOT NULL, date TEXT NOT NULL, notes TEXT DEFAULT '', created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS disbursements (
  id BIGSERIAL PRIMARY KEY, app_id BIGINT, scholar_name TEXT DEFAULT '', amount NUMERIC NOT NULL, period TEXT DEFAULT '', date TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS intake_sheets (
  id BIGSERIAL PRIMARY KEY, linked_app_id BIGINT, case_no TEXT DEFAULT '', case_date TEXT DEFAULT '', case_category TEXT DEFAULT '',
  case_referral TEXT DEFAULT '', data TEXT DEFAULT '{}', saved_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS assessments (
  id BIGSERIAL PRIMARY KEY, linked_app_id BIGINT, family_surname TEXT DEFAULT '', student TEXT DEFAULT '', final_result TEXT DEFAULT '',
  data TEXT DEFAULT '{}', saved_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS announcements (
  id BIGSERIAL PRIMARY KEY, subject TEXT NOT NULL, message TEXT NOT NULL, target TEXT DEFAULT '', tag TEXT DEFAULT '',
  posted_by TEXT DEFAULT '', date TEXT DEFAULT '', created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY, subjects JSONB NOT NULL DEFAULT '[]'::jsonb
);
CREATE TABLE IF NOT EXISTS document_status (
  id BIGSERIAL PRIMARY KEY, app_id BIGINT NOT NULL, doc_key TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Required', note TEXT DEFAULT '',
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, file_name TEXT DEFAULT '', file_type TEXT DEFAULT '', file_data TEXT DEFAULT '',
  upload_method TEXT DEFAULT '', UNIQUE(app_id, doc_key)
);
CREATE TABLE IF NOT EXISTS grade_extraction (
  id BIGSERIAL PRIMARY KEY, app_id BIGINT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', file_name TEXT DEFAULT '', file_type TEXT DEFAULT '',
  file_data TEXT DEFAULT '', extracted TEXT DEFAULT '', flags TEXT DEFAULT '', review_notes TEXT DEFAULT '', reviewer_id TEXT DEFAULT '',
  uploaded_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, reviewed_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS quarterly_grades (
  id BIGSERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL,
  school_year TEXT NOT NULL,
  subject TEXT NOT NULL,
  quarter INTEGER NOT NULL,
  grade_value INTEGER,
  file_data TEXT DEFAULT '',
  status TEXT DEFAULT 'pending',
  submitted_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  reviewed_by TEXT DEFAULT '',
  reviewed_at TEXT DEFAULT '',
  rejection_reason TEXT DEFAULT '',
  last_edited_by TEXT DEFAULT '',
  last_edited_at TEXT DEFAULT '',
  UNIQUE(student_id, school_year, subject, quarter)
);
