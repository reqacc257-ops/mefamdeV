-- Migration: 001_add_quarterly_grades.sql
-- Creates the quarterly_grades table used for pending approvals and finalized grades.

CREATE TABLE IF NOT EXISTS quarterly_grades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL,
  school_year TEXT NOT NULL,
  subject TEXT NOT NULL,
  quarter INTEGER NOT NULL,
  grade_value INTEGER,
  file_data TEXT DEFAULT '',
  status TEXT DEFAULT 'pending',
  submitted_at TEXT DEFAULT (datetime('now')),
  reviewed_by TEXT DEFAULT '',
  reviewed_at TEXT DEFAULT '',
  rejection_reason TEXT DEFAULT '',
  last_edited_by TEXT DEFAULT '',
  last_edited_at TEXT DEFAULT '',
  UNIQUE(student_id, school_year, subject, quarter)
);
