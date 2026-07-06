/**
 * db.js — SQLite database setup
 * Uses better-sqlite3 (synchronous, no callback hell)
 *
 * Install: npm install better-sqlite3
 * The database file mefamdev.db is created automatically.
 */

const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

let DatabaseImpl;
let isNativeSqlite = false;

try {
  DatabaseImpl = require('better-sqlite3');
} catch (error) {
  const { DatabaseSync } = require('node:sqlite');
  DatabaseImpl = DatabaseSync;
  isNativeSqlite = true;
}

const DB_PATH = process.env.DB_PATH || process.env.DATABASE_URL || path.join(__dirname, 'mefamdev.db');
const resolvedDbPath = DB_PATH.startsWith('file:') ? DB_PATH.replace('file:', '') : DB_PATH;
const dbDir = path.dirname(resolvedDbPath);
if (dbDir && !fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}
const db = new DatabaseImpl(resolvedDbPath);

if (isNativeSqlite) {
  db.pragma = (statement) => {
    const normalized = String(statement).trim();
    const pragmaStatement = normalized.toLowerCase().startsWith('pragma') ? normalized : `PRAGMA ${normalized}`;
    db.exec(pragmaStatement);
    return db;
  };
  db.transaction = (fn) => {
    return (...args) => {
      db.exec('BEGIN');
      try {
        const result = fn(...args);
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    };
  };
}

// Enable WAL mode for better concurrent performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ── Schema ────────────────────────────────────────────────────────────────────
db.exec(`
  /* ── Staff accounts ── */
  CREATE TABLE IF NOT EXISTS staff (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    username  TEXT NOT NULL UNIQUE,
    password  TEXT NOT NULL,          -- SHA-256 hash (upgrade to bcrypt in prod)
    role      TEXT NOT NULL,          -- director | edu | finance | program
    name      TEXT NOT NULL,
    title     TEXT NOT NULL,
    initials  TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );

  /* ── Applications ── */
  CREATE TABLE IF NOT EXISTS applications (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    sy            TEXT,
    name          TEXT NOT NULL,
    address       TEXT,
    barangay      TEXT,
    dob           TEXT,
    age           INTEGER,
    gender        TEXT,
    contact       TEXT,
    religion      TEXT,
    birthplace    TEXT,
    talents       TEXT,
    clubs         TEXT,
    ambition      TEXT,
    living_with   TEXT,
    edu_level     TEXT,
    prev_grade    TEXT,
    prev_school   TEXT,
    school        TEXT,
    grade         TEXT,
    degree        TEXT,
    why_scholar   TEXT,
    total_income  TEXT,
    total_expense TEXT,
    status        TEXT DEFAULT 'Pending Review',
    family_members TEXT DEFAULT '[]',   -- JSON array
    properties    TEXT DEFAULT '[]',   -- JSON array
    can_provide   TEXT DEFAULT '[]',   -- JSON array
    submitted_at  TEXT DEFAULT (datetime('now')),
    date_label    TEXT                 -- human readable date shown in UI
  );

  /* ── Beneficiary families ── */
  CREATE TABLE IF NOT EXISTS families (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    surname   TEXT NOT NULL,
    guardian  TEXT,
    barangay  TEXT,
    contact   TEXT,
    income    TEXT,
    bracket   TEXT,
    benefits  TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  /* ── Spiritual formation events ── */
  CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    date       TEXT,
    venue      TEXT,
    max_att    INTEGER DEFAULT 75,
    created_at TEXT DEFAULT (datetime('now'))
  );

  /* ── Event attendance (which scholars attended which event) ── */
  CREATE TABLE IF NOT EXISTS event_attendance (
    event_id INTEGER NOT NULL,
    app_id   INTEGER NOT NULL,
    PRIMARY KEY (event_id, app_id),
    FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
    FOREIGN KEY (app_id)   REFERENCES applications(id) ON DELETE CASCADE
  );

  /* ── School absences ── */
  CREATE TABLE IF NOT EXISTS absences (
    app_id  INTEGER PRIMARY KEY,
    days    INTEGER DEFAULT 0,
    reason  TEXT,
    FOREIGN KEY (app_id) REFERENCES applications(id) ON DELETE CASCADE
  );

  /* ── Grade records ── */
  CREATE TABLE IF NOT EXISTS grades (
    app_id    INTEGER PRIMARY KEY,
    grade_val INTEGER,
    semester  TEXT,
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (app_id) REFERENCES applications(id) ON DELETE CASCADE
  );

  /* ── Fund contributions log ── */
  CREATE TABLE IF NOT EXISTS fund_log (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    source   TEXT NOT NULL,
    amount   REAL NOT NULL,
    date     TEXT NOT NULL,
    notes    TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );

  /* ── Stipend disbursements ── */
  CREATE TABLE IF NOT EXISTS disbursements (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    app_id      INTEGER,
    scholar_name TEXT,
    amount      REAL NOT NULL,
    period      TEXT,
    date        TEXT NOT NULL,
    created_at  TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (app_id) REFERENCES applications(id) ON DELETE SET NULL
  );

  /* ── Intake sheets ── */
  CREATE TABLE IF NOT EXISTS intake_sheets (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    linked_app_id INTEGER,
    case_no       TEXT,
    case_date     TEXT,
    case_category TEXT,
    case_referral TEXT,
    data          TEXT NOT NULL,   -- full JSON blob of all fields
    saved_at      TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (linked_app_id) REFERENCES applications(id) ON DELETE SET NULL
  );

  /* ── Staff assessments ── */
  CREATE TABLE IF NOT EXISTS assessments (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    linked_app_id   INTEGER,
    family_surname  TEXT,
    student         TEXT,
    final_result    TEXT,         -- 'above' | 'below'
    data            TEXT NOT NULL,
    saved_at        TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (linked_app_id) REFERENCES applications(id) ON DELETE SET NULL
  );

  /* ── Announcements ── */
  CREATE TABLE IF NOT EXISTS announcements (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    subject   TEXT NOT NULL,
    message   TEXT NOT NULL,
    target    TEXT,
    tag       TEXT,
    posted_by TEXT,
    date      TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// ── Seed default staff accounts ───────────────────────────────────────────────
function hashPassword(pw) {
  return crypto.createHash('sha256').update(pw).digest('hex');
}

const seedStaff = [
  { username: 'director', password: 'director123', role: 'director', name: 'Director',      title: 'Primary Social Worker',   initials: 'DR' },
  { username: 'edu',      password: 'edu123',      role: 'edu',      name: 'Edu Staff',     title: 'Education Social Worker', initials: 'ED' },
  { username: 'finance',  password: 'finance123',  role: 'finance',  name: 'Finance Staff', title: 'Finance Officer',         initials: 'FN' },
  { username: 'program',  password: 'program123',  role: 'program',  name: 'Coordinator',   title: 'Program Coordinator',     initials: 'PC' },
];

const insertStaff = db.prepare(`
  INSERT OR IGNORE INTO staff (username, password, role, name, title, initials)
  VALUES (@username, @password, @role, @name, @title, @initials)
`);

for (const s of seedStaff) {
  insertStaff.run({ ...s, password: hashPassword(s.password) });
}

module.exports = db;
