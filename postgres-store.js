function translateQuery(sql, params) {
  let index = 0;
  const values = [];
  const source = Array.isArray(params) ? params : Object.entries(params || {}).map(([name, value]) => ({ name, value }));
  const translated = sql
    .replace(/INSERT\s+OR\s+IGNORE/gi, 'INSERT')
    .replace(/datetime\(\s*'now'\s*,\s*'(-?\d+)\s+minutes'\s*\)/gi, "CURRENT_TIMESTAMP - INTERVAL '$1 minutes'")
    .replace(/datetime\(\s*([a-z_][a-z0-9_]*)\s*\)/gi, '$1')
    .replace(/json_extract\(\s*([a-z_][a-z0-9_]*)\s*,\s*["']\$\.([a-z_][a-z0-9_]*)["']\s*\)/gi, "($1::jsonb)->>'$2'")
    .replace(/@([a-z_][a-z0-9_]*)/gi, (_, name) => {
      const entry = source.find(item => item.name === name);
      if (!entry) throw new Error(`Missing named parameter: ${name}`);
      values.push(serializeValue(entry.value));
      return `$${values.length}`;
    })
    .replace(/\?/g, () => {
      const value = source[index++];
      values.push(serializeValue(value));
      return `$${values.length}`;
    });
  return { text: translated, values };
}

function serializeValue(value) {
  if (Array.isArray(value) || (value && typeof value === 'object' && !(value instanceof Date))) {
    return JSON.stringify(value);
  }
  return value;
}

class PostgresStore {
  constructor(databaseUrl) {
    const { Pool } = require('pg');
    this.isPostgres = true;
    const ssl = process.env.PGSSL === 'false' ? false : { rejectUnauthorized: false };
    this.pool = new Pool({ connectionString: databaseUrl, max: Number(process.env.PG_POOL_MAX || 10), ssl });
  }

  prepare(sql) {
    return new PostgresStatement(this, sql);
  }

  async exec(sql) {
    return this.pool.query(sql);
  }

  async init(schemaSql) {
    await this.exec(schemaSql);
  }

  async seedStaff(rows) {
    for (const row of rows) {
      await this.pool.query(`
        INSERT INTO staff (username, password, role, name, title, initials)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (username) DO UPDATE SET password = EXCLUDED.password, role = EXCLUDED.role,
          name = EXCLUDED.name, title = EXCLUDED.title, initials = EXCLUDED.initials
      `, [row.username, row.password, row.role, row.name, row.title, row.initials]);
    }
  }

  async transaction(callback) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async close() {
    await this.pool.end();
  }
}

class PostgresStatement {
  constructor(store, sql) {
    this.store = store;
    this.sql = sql.trim();
  }

  async all(...params) {
    const result = await this.store.pool.query(translateQuery(this.sql, params.length === 1 ? params[0] : params));
    return result.rows;
  }

  async get(...params) {
    const rows = await this.all(...params);
    return rows[0];
  }

  async run(...params) {
    let sql = this.sql;
    if (/^\s*insert\b/i.test(sql) && !/\breturning\b/i.test(sql)) {
      sql += ' RETURNING id';
    }
    if (/INSERT\s+OR\s+IGNORE/i.test(this.sql) && !/ON\s+CONFLICT/i.test(sql)) {
      sql = sql.replace(/(\)\s*VALUES\s*\([^)]*\))/i, '$1 ON CONFLICT DO NOTHING');
    }
    const result = await this.store.pool.query(translateQuery(sql, params.length === 1 ? params[0] : params));
    return { lastInsertRowid: result.rows[0]?.id, changes: result.rowCount };
  }
}

module.exports = { PostgresStore, PostgresStatement, translateQuery };