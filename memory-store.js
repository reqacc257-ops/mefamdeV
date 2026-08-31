const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function isTestRun() {
  return process.env.NODE_ENV === 'test' || process.argv.includes('--test') || process.argv.some(arg => /(?:^|[\\/])node(?:\.exe)?$/.test(arg) && arg.includes('node')) || process.argv.some(arg => /(?:--test|node:test|\.test\.js)/.test(arg));
}

function hashPassword(pw) {
  return crypto.createHash('sha256').update(pw).digest('hex');
}

const defaultStaffSeed = [
  { id: 1, username: 'director', password: hashPassword('uVP-OzXLaTSm7pga3hM6rUgrii-nzyy9'), role: 'director', name: 'Director', title: 'Primary Social Worker', initials: 'DR' },
  { id: 2, username: 'edu', password: hashPassword('upmD_tpQEXK128keN8x4rv2JVRmMbIm7'), role: 'edu', name: 'Edu Staff', title: 'Education Social Worker', initials: 'ED' },
  { id: 3, username: 'finance', password: hashPassword('Z_jJd9Qos26bQvFnYE_056OFo1ffvHdi'), role: 'finance', name: 'Finance Staff', title: 'Finance Officer', initials: 'FN' },
  { id: 4, username: 'program', password: hashPassword('kowUdbhQzT9RF4J5b3KOHtseMyg7FadB'), role: 'program', name: 'Coordinator', title: 'Program Coordinator', initials: 'PC' },
];

function createFreshData() {
  return {
    staff: defaultStaffSeed.map(row => ({ ...row })),
    applications: [],
    families: [],
    events: [],
    event_attendance: [],
    absences: [],
    grades: [],
    fund_log: [],
    disbursements: [],
    intake_sheets: [],
    assessments: [],
    announcements: [],
    document_status: [],
    quarterly_grades: [],
    grade_extraction: [],
  };
}

class MemoryStore {
  constructor(filePath) {
    this.filePath = filePath || path.join(process.cwd(), 'data', 'mefamdev.json');
    this.fileMtime = 0;
    this.data = createFreshData();
    this.ensureDirectory();
    this.load();
  }

  ensureDirectory() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
  }

  load() {
    const isTestRun = process.env.NODE_ENV === 'test' || process.argv.some(arg => /(?:^|[\\/])node(?:\.exe)?$/.test(arg) && arg.includes('node')) || process.argv.some(arg => /(?:--test|node:test|\.test\.js)/.test(arg));
    if (isTestRun) {
      this.data = createFreshData();
      this.fileMtime = 0;
      return;
    }

    try {
      if (fs.existsSync(this.filePath)) {
        const stats = fs.statSync(this.filePath);
        const raw = fs.readFileSync(this.filePath, 'utf8');
        if (raw) {
          const parsed = JSON.parse(raw);
          this.data = { ...createFreshData(), ...parsed };
        }
        this.fileMtime = stats.mtimeMs || 0;
      }
    } catch (error) {
      console.warn('Using fresh JSON store because persistence file could not be read:', error.message);
    }
  }

  reloadIfNeeded() {
    if (isTestRun()) return;
    try {
      if (!fs.existsSync(this.filePath)) return;
      const stats = fs.statSync(this.filePath);
      if (stats.mtimeMs > this.fileMtime) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        if (raw) {
          const parsed = JSON.parse(raw);
          this.data = { ...this.data, ...parsed };
        }
        this.fileMtime = stats.mtimeMs || 0;
      }
    } catch (error) {
      console.warn('Unable to reload JSON store file:', error.message);
    }
  }

  save() {
    if (isTestRun()) return;
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
    try {
      this.fileMtime = fs.statSync(this.filePath).mtimeMs || this.fileMtime;
    } catch (_) {
      // Ignore stat errors after write.
    }
  }

  prepare(query) {
    this.reloadIfNeeded();
    return new QueryBuilder(this, query);
  }

  exec() {
    return this;
  }

  transaction(fn) {
    try {
      const result = fn();
      this.save();
      return result;
    } catch (error) {
      throw error;
    }
  }

  pragma() {
    return this;
  }

  close() {
    this.save();
  }
}

class QueryBuilder {
  constructor(store, query) {
    this.store = store;
    this.query = query.trim();
  }

  get(...params) {
    return this.all(...params)[0];
  }

  all(...params) {
    const table = this.detectTable();
    if (!table) return [];

    const rows = this.getRowsForTable(table);
    const upper = this.query.toUpperCase();

    if (upper.includes('COUNT(*)')) {
      return [{ c: this.filterRows(rows, params).length }];
    }

    if (upper.includes('SUM(')) {
      const field = this.extractSumField();
      const total = this.filterRows(rows, params).reduce((sum, row) => sum + (Number(row[field]) || 0), 0);
      return [{ total }];
    }

    return this.filterRows(rows, params);
  }

  run(...args) {
    const table = this.detectTable();
    if (!table) return { lastInsertRowid: 1, changes: 0 };

    const upper = this.query.toUpperCase();
    const rows = this.getRowsForTable(table);
    const values = this.normalizeParams(args.length === 1 ? args[0] : args);

    if (upper.includes('INSERT')) {
      const item = this.buildInsertItem(table, values);
      if (upper.includes('OR IGNORE')) {
        const conflictColumn = this.detectUniqueColumn(table, values);
        if (conflictColumn && rows.some(row => row[conflictColumn] === item[conflictColumn])) {
          return { lastInsertRowid: rows.find(row => row[conflictColumn] === item[conflictColumn]).id, changes: 0 };
        }
      }
      rows.push(item);
      this.store.data[table] = rows;
      this.store.save();
      return { lastInsertRowid: item.id, changes: 1 };
    }

    if (upper.includes('UPDATE')) {
      const setAssignments = this.parseSetAssignments();
      const whereClause = this.parseWhereConditions();
      const positionalValues = Array.isArray(values) ? values : [];
      let changed = 0;
      let setIndex = 0;
      rows.forEach(row => {
        if (!this.matchesWhere(row, whereClause, positionalValues.slice(this.countPlaceholderAssignments(setAssignments)))) {
          return;
        }

        setAssignments.forEach(assignment => {
          if (assignment.kind === 'placeholder') {
            row[assignment.column] = positionalValues[setIndex] !== undefined ? positionalValues[setIndex] : undefined;
            setIndex += 1;
          } else if (assignment.kind === 'literal') {
            row[assignment.column] = assignment.value;
          }
        });
        changed += 1;
      });
      this.store.data[table] = rows;
      this.store.save();
      return { changes: changed };
    }

    if (upper.includes('DELETE')) {
      const whereClause = this.parseWhereConditions();
      const positionalValues = Array.isArray(values) ? values : [];
      const filtered = rows.filter(row => !this.matchesWhere(row, whereClause, positionalValues));
      this.store.data[table] = filtered;
      this.store.save();
      return { changes: rows.length - filtered.length };
    }

    return { lastInsertRowid: 1, changes: 0 };
  }

  detectTable() {
    const match = this.query.match(/from\s+([a-z_]+)/i) || this.query.match(/into\s+([a-z_]+)/i) || this.query.match(/update\s+([a-z_]+)/i) || this.query.match(/delete\s+from\s+([a-z_]+)/i);
    return match ? match[1] : null;
  }

  getRowsForTable(table) {
    if (!Array.isArray(this.store.data[table])) {
      this.store.data[table] = [];
    }
    return this.store.data[table];
  }

  normalizeParams(params) {
    if (params === undefined || params === null) return [];
    if (Array.isArray(params)) return params;
    if (typeof params === 'object') return params;
    return [params];
  }

  filterRows(rows, params) {
    const whereClause = this.parseWhereConditions();
    if (!whereClause.length) return rows;
    return rows.filter(row => this.matchesWhere(row, whereClause, params));
  }

  asValueArray(params) {
    if (Array.isArray(params)) return params;
    if (params === undefined || params === null) return [];
    return [params];
  }

  parseWhereConditions() {
    const clauses = [];
    const whereMatch = this.query.match(/where\s+(.+)/i);
    if (!whereMatch) return clauses;

    const fragments = whereMatch[1].split(/\s+and\s+/i).map(part => part.trim()).filter(Boolean);
    let placeholderIndex = 0;
    fragments.forEach(fragment => {
      const simpleMatch = fragment.match(/([a-z_]+)\s*=\s*(?:'([^']+)'|"([^"]+)"|(\?))/i);
      if (simpleMatch) {
        const literalValue = simpleMatch[2] || simpleMatch[3];
        clauses.push({
          column: simpleMatch[1],
          kind: simpleMatch[4] === '?' ? 'placeholder' : 'literal',
          value: literalValue,
          position: simpleMatch[4] === '?' ? placeholderIndex++ : null
        });
      }
    });

    return clauses;
  }

  normalizeComparableValue(value) {
    if (value === undefined || value === null) return value;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed === '') return '';
      if (/^-?\d+$/.test(trimmed)) return Number(trimmed);
      if (trimmed.toLowerCase() === 'true') return true;
      if (trimmed.toLowerCase() === 'false') return false;
    }
    return value;
  }

  matchesWhere(row, whereClause, params) {
    if (!whereClause.length) return true;
    const values = this.asValueArray(params);
    return whereClause.every(clause => {
      let expected;
      if (clause.kind === 'placeholder') {
        expected = values[clause.position] !== undefined ? values[clause.position] : values[0];
      } else {
        expected = clause.value;
      }
      const normalizedExpected = this.normalizeComparableValue(expected);
      const normalizedRowValue = this.normalizeComparableValue(row[clause.column]);
      return normalizedRowValue === normalizedExpected;
    });
  }

  parseSetAssignments() {
    const match = this.query.match(/set\s+(.+?)(?:\s+where|$)/i);
    if (!match) return [];
    const assignments = match[1].split(',').map(part => part.trim()).filter(Boolean);
    const parsed = [];
    let placeholderIndex = 0;
    assignments.forEach(assign => {
      const setMatch = assign.match(/([a-z_]+)\s*=\s*(?:'([^']+)'|"([^"]+)"|(\?))/i);
      if (setMatch) {
        const literalValue = setMatch[2] || setMatch[3];
        parsed.push({
          column: setMatch[1],
          kind: setMatch[4] === '?' ? 'placeholder' : 'literal',
          value: literalValue,
          position: setMatch[4] === '?' ? placeholderIndex++ : null
        });
      }
    });
    return parsed;
  }

  countPlaceholderAssignments(assignments) {
    return assignments.filter(assignment => assignment.kind === 'placeholder').length;
  }

  detectUniqueColumn(table, values) {
    if (table === 'staff' && values.username !== undefined) return 'username';
    return null;
  }

  buildInsertItem(table, values) {
    const columnsMatch = this.query.match(/insert(?:\s+or\s+ignore)?\s+into\s+[a-z_]+\s*\(([^)]+)\)/i);
    const columns = columnsMatch ? columnsMatch[1].split(',').map(col => col.trim()) : [];
    const item = { id: this.nextId(table) };
    const rowValues = Array.isArray(values) ? values.slice() : [];
    const valueMatch = this.query.match(/values\s*\((.*)\)/i);
    const valueTokens = valueMatch ? this.splitValueList(valueMatch[1]) : [];

    if (valueTokens.length) {
      valueTokens.forEach((token, index) => {
        const column = columns[index];
        if (!column) return;
        if (token === '?') {
          item[column] = rowValues.shift();
          return;
        }
        if (token.startsWith('@')) {
          const paramKey = token.slice(1);
          item[column] = values && typeof values === 'object' && !Array.isArray(values) ? values[paramKey] : undefined;
          return;
        }
        item[column] = this.parseLiteralValue(token);
      });
      return item;
    }

    if (Array.isArray(values)) {
      columns.forEach((column, index) => {
        item[column] = values[index];
      });
      return item;
    }

    if (columns.length) {
      columns.forEach(column => {
        if (values[column] !== undefined) item[column] = values[column];
      });
    } else {
      Object.keys(values).forEach(key => {
        item[key] = values[key];
      });
    }

    return item;
  }

  splitValueList(raw) {
    const tokens = [];
    let current = '';
    let quote = null;
    for (let i = 0; i < raw.length; i += 1) {
      const ch = raw[i];
      if (quote) {
        current += ch;
        if (ch === quote && raw[i - 1] !== '\\') quote = null;
        continue;
      }
      if (ch === '\'' || ch === '"') {
        quote = ch;
        current += ch;
        continue;
      }
      if (ch === ',') {
        tokens.push(current.trim());
        current = '';
        continue;
      }
      current += ch;
    }
    if (current.trim()) tokens.push(current.trim());
    return tokens.filter(Boolean);
  }

  parseLiteralValue(token) {
    const trimmed = String(token).trim();
    if (!trimmed) return '';
    if (/^\d+$/u.test(trimmed)) return Number(trimmed);
    if (/^\d+\.\d+$/u.test(trimmed)) return Number(trimmed);
    if (/^'(.*)'$/u.test(trimmed) || /^"(.*)"$/u.test(trimmed)) {
      const unquoted = trimmed.slice(1, -1).replace(/\\'/g, "'").replace(/\\"/g, '"');
      return unquoted;
    }
    if (trimmed.toLowerCase() === 'null') return null;
    if (trimmed.toLowerCase() === 'true') return true;
    if (trimmed.toLowerCase() === 'false') return false;
    return trimmed;
  }

  nextId(table) {
    const rows = this.getRowsForTable(table);
    return (rows[rows.length - 1]?.id || 0) + 1;
  }

  extractSumField() {
    const match = this.query.match(/sum\(([^)]+)\)/i);
    return match ? match[1].trim() : 'amount';
  }
}

module.exports = new MemoryStore(process.env.DB_PATH || process.env.DATABASE_URL || path.join(process.cwd(), 'data', 'mefamdev.json'));
