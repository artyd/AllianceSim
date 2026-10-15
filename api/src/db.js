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

-- id was originally uuid; the web client generates its own string ids ("u12_abc"),
-- and the bot may omit id and let the server default one. Make id plain text so both
-- coexist. Safe/idempotent: only rewrites the column when it is still uuid.
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'employees' AND column_name = 'id') = 'uuid' THEN
    ALTER TABLE employees ALTER COLUMN id DROP DEFAULT;
    ALTER TABLE employees ALTER COLUMN id TYPE text USING id::text;
    ALTER TABLE employees ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
  END IF;
END $$;

-- All character fields the employee form collects, plus Telegram link + seat index.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS position    text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS email       text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS phone       text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS ext         text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS photo       text;   -- data URL or null
ALTER TABLE employees ADD COLUMN IF NOT EXISTS color       text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS status      text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS mood        text;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS seat_i      integer;      -- with desk_id = {f,i}
ALTER TABLE employees ADD COLUMN IF NOT EXISTS telegram_id bigint UNIQUE; -- null = not linked

-- Outbound Telegram notifications queued by the site; the bot drains and delivers.
CREATE TABLE IF NOT EXISTS notifications (
  id bigserial PRIMARY KEY,
  employee_id text REFERENCES employees(id) ON DELETE CASCADE,
  kind text NOT NULL,          -- 'message' | 'call' | 'mark'
  text text,
  from_name text,              -- sender's name when known (Mini App user), else null
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz          -- null until the bot delivers it
);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS from_name text;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS payload jsonb;  -- deep-link / inline buttons for the bot
CREATE INDEX IF NOT EXISTS notifications_unsent ON notifications (id) WHERE sent_at IS NULL;

-- ── Personal phone (spec 004) — private per-employee data, never in the layout blob ──
ALTER TABLE employees ADD COLUMN IF NOT EXISTS telegram_username text; -- for "Подзвонити" → t.me/<username>

-- Calendar. The organizer is also an attendee row (status 'accepted'), so "my events"
-- is always a join on event_attendees; reminders are per attendee.
CREATE TABLE IF NOT EXISTS events (
  id bigserial PRIMARY KEY,
  organizer_id text NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  title text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz,
  all_day boolean NOT NULL DEFAULT false,
  place text,
  note text,
  color text,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_starts ON events (starts_at);
CREATE TABLE IF NOT EXISTS event_attendees (
  event_id bigint NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  employee_id text NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending',   -- pending | accepted | declined
  remind_min integer,                        -- minutes before start; null = no reminder
  reminded_at timestamptz,
  PRIMARY KEY (event_id, employee_id)
);
CREATE INDEX IF NOT EXISTS event_attendees_emp ON event_attendees (employee_id);

-- Tasks. A personal task has author = assignee.
CREATE TABLE IF NOT EXISTS tasks (
  id bigserial PRIMARY KEY,
  author_id text NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  assignee_id text NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  text text NOT NULL,
  due_at timestamptz,
  done_at timestamptz,
  due_notified_at timestamptz,
  overdue_notified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tasks_assignee ON tasks (assignee_id);
CREATE INDEX IF NOT EXISTS tasks_author ON tasks (author_id);

-- Chats: direct (1:1, unique pair key), dept (auto, one per department), office (auto,
-- everyone linked), group (user-created). Read state is a per-member high-water mark.
CREATE TABLE IF NOT EXISTS chats (
  id bigserial PRIMARY KEY,
  kind text NOT NULL,                 -- direct | dept | office | group
  title text,
  dept text,
  direct_key text UNIQUE,             -- 'idA|idB' (sorted) for kind = direct
  created_by text REFERENCES employees(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS chats_one_per_dept ON chats (dept) WHERE kind = 'dept';
CREATE UNIQUE INDEX IF NOT EXISTS chats_one_office ON chats (kind) WHERE kind = 'office';
CREATE TABLE IF NOT EXISTS chat_members (
  chat_id bigint NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  employee_id text NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  last_read_id bigint NOT NULL DEFAULT 0,
  muted boolean NOT NULL DEFAULT false,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chat_id, employee_id)
);
CREATE INDEX IF NOT EXISTS chat_members_emp ON chat_members (employee_id);
CREATE TABLE IF NOT EXISTS messages (
  id bigserial PRIMARY KEY,
  chat_id bigint NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  sender_id text REFERENCES employees(id) ON DELETE SET NULL,
  text text,
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_chat ON messages (chat_id, id);

-- Which Telegram notifications a person wants (absent row = all on).
CREATE TABLE IF NOT EXISTS notify_prefs (
  employee_id text PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
  messages boolean NOT NULL DEFAULT true,
  events boolean NOT NULL DEFAULT true,
  tasks boolean NOT NULL DEFAULT true,
  digest boolean NOT NULL DEFAULT true
);
`;

export async function query(text, params) {
  return pool.query(text, params);
}

// One-time migration: employees used to live inside the office_layout blob. Move
// them into the employees table (source of truth) and strip them from the blob so
// they can't resurrect. Idempotency signal is the blob's own `employees` key: once
// this runs it is removed, so every subsequent boot is a no-op — independent of how
// many rows the table already has (e.g. leftover smoke-test rows won't block it).
export async function migrateBlobEmployees() {
  const { rows } = await pool.query('SELECT data FROM office_layout WHERE id = 1');
  const data = rows[0] && rows[0].data;
  if (!data || !('employees' in data)) return; // already migrated (or never had any)
  const emps = Array.isArray(data.employees) ? data.employees : [];

  for (const e of emps) {
    const seat = e.seat || null;
    await pool.query(
      `INSERT INTO employees
         (id, name, department, position, email, phone, ext, photo, color, status, mood, desk_id, seat_i)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (id) DO NOTHING`,
      [
        e.id || ('mig_' + Math.random().toString(36).slice(2)), e.name || 'Без імені', e.dept ?? null, e.position ?? null,
        e.email ?? null, e.phone ?? null, e.ext ?? null, e.photo ?? null, e.color ?? null,
        e.status ?? null, e.mood ?? null, seat ? seat.f : null, seat ? seat.i : null,
      ]
    );
  }
  // Remove employees from the blob; furniture/zones/rects/depts stay HR-owned.
  await pool.query(
    `UPDATE office_layout SET data = (data - 'employees'), updated_at = now() WHERE id = 1`
  );
  console.log(`[db] migrated ${emps.length} employees from blob → table`);
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
