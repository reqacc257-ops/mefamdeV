const crypto = require('crypto');
const { Pool } = require('pg');

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error('DATABASE_URL is required; refusing to rotate passwords without the live PostgreSQL database.');
}

const usernames = ['director', 'edu', 'finance', 'program'];
const pool = new Pool({ connectionString: databaseUrl, ssl: process.env.PGSSL === 'false' ? false : { rejectUnauthorized: false } });

function generatePassword() {
  return crypto.randomBytes(24).toString('base64url');
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

async function run() {
  const client = await pool.connect();
  const rotated = [];
  try {
    await client.query('BEGIN');
    for (const username of usernames) {
      const password = generatePassword();
      const result = await client.query(
        'UPDATE staff SET password = $1 WHERE username = $2 RETURNING username',
        [hashPassword(password), username]
      );
      if (result.rowCount !== 1) throw new Error(`Staff account not found: ${username}`);
      rotated.push({ username, password });
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }

  console.log('Rotated staff passwords in PostgreSQL. Store these credentials securely; they are shown once:');
  for (const account of rotated) console.log(`${account.username}: ${account.password}`);
}

run().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
