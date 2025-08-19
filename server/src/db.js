import 'dotenv/config';
import { readFileSync } from 'fs';
import pg from 'pg';

const { Pool } = pg;
export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function initSchema() {
  const sql = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
  await pool.query(sql);
}

if (process.argv.includes('--init')) {
  initSchema()
    .then(() => {
      console.log('DB schema ensured.');
      process.exit(0);
    })
    .catch((e) => {
      console.error('DB init failed:', e);
      process.exit(1);
    });
}
