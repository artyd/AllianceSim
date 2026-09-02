import pg from 'pg';

const { Pool } = pg;

// Connection: prefer DATABASE_URL (set by docker-compose), fall back to discrete PG* vars.
const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : {
        host: process.env.PGHOST || 'localhost',
        port: Number(process.env.PGPORT || 5432),
        user: process.env.POSTGRES_USER,
        password: process.env.POSTGRES_PASSWORD,
        database: process.env.POSTGRES_DB,
      }
);

// Schema is embedded here (not in a sibling db/ folder) because the api Docker
// build context is ./api and cannot COPY files from outside it.
const SCHEMA_SQL = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS office_layout (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  data jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO office_layout (id, data) VALUES (1, NULL) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  department text,
  desk_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
`;

export async function query(text, params) {
  return pool.query(text, params);
}

// Idempotent schema init, run on startup. Retries so the api container can
// start alongside Postgres even if the DB accepts connections a moment later.
export async function initSchema({ retries = 10, delayMs = 2000 } = {}) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await pool.query(SCHEMA_SQL);
      console.log('[db] schema ready');
      return;
    } catch (err) {
      console.warn(`[db] init attempt ${attempt}/${retries} failed: ${err.message}`);
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

export default pool;
