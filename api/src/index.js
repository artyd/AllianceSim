import express from 'express';
import { initSchema, migrateBlobEmployees } from './lib/db.js';
import { requireMe } from './lib/session.js';
import { layout } from './office/layout.js';
import { employees } from './office/employees.js';
import { notifications } from './office/notifications.js';
import { office, runDailyPosts, snapshotDay } from './office/live.js';
import { personal, runReminders } from './phone/personal.js';
import { chats, syncSystemChats, cleanupAttachments } from './phone/chats.js';
import { people } from './phone/people.js';
import { games, initGames } from './games/games.js';
import { analytics } from './analytics/analytics.js';

// AllianceSim api: Express + Postgres. Folders: lib/ (db, auth, sessions, Telegram, jobs plumbing),
// office/ (plan, employees, notifications, live office), phone/ (personal apps, chats, pulse/onboarding),
// games/, analytics/ (HR analytics + exports). Every router is mounted at / and /api.
const app = express();
app.use(express.json({ limit: '25mb' })); // layout blob embeds employees (+ optional base64 photos)

// Mount at both root and /api so every curl example in the spec works:
//  - Caddy `handle_path /api/*` strips the prefix  → hits /layout, /health, ...
//  - Direct smoke tests against 127.0.0.1:8011/api/* and /health both resolve.
for (const r of [layout, employees, notifications]) { app.use(r); app.use('/api', r); }
// Personal phone (spec 004): every /me/* route is the caller's own data only.
app.use(['/me', '/api/me'], requireMe);
for (const r of [personal, chats, office, games, people, analytics]) { app.use(r); app.use('/api', r); }

// Central error handler
app.use((err, _req, res, _next) => {
  // Body-parser errors (too large, bad JSON) carry their own 4xx status.
  if (err.status >= 400 && err.status < 500) return res.status(err.status).json({ error: err.type || 'bad request' });
  console.error('[api] error:', err);
  res.status(500).json({ error: 'internal server error' });
});

const PORT = Number(process.env.PORT || 8011);

initSchema()
  .then(() => migrateBlobEmployees())
  .then(() => syncSystemChats())
  .then(() => initGames())
  .then(() => {
    // Background jobs (spec 004): roster → system chats, attachment cleanup, reminders.
    const safe = (name, fn) => () => fn().catch((e) => console.error(`[api] ${name} failed:`, e.message));
    setInterval(safe('chat sync', syncSystemChats), 5 * 60 * 1000);
    setInterval(safe('attachment cleanup', cleanupAttachments), 60 * 60 * 1000);
    safe('attachment cleanup', cleanupAttachments)();
    // Calendar reminders + task deadlines → Telegram (queued for the bot).
    setInterval(safe('reminders', runReminders), Number(process.env.JOBS_INTERVAL_MS || 60 * 1000));
    // Spec 005: birthday/anniversary posts (once a day from CHECKIN_HOUR), HR analytics snapshots.
    setInterval(safe('daily posts', runDailyPosts), Number(process.env.JOBS_INTERVAL_MS || 60 * 1000));
    setInterval(safe('snapshot', snapshotDay), Number(process.env.SNAPSHOT_MS || process.env.JOBS_INTERVAL_MS || 10 * 60 * 1000));
    safe('snapshot', snapshotDay)();
    // Bind to all interfaces inside the container; docker-compose maps only
    // 127.0.0.1 on the host, so nothing is exposed publicly (Caddy fronts TLS).
    app.listen(PORT, () => console.log(`[api] listening on :${PORT}`));
  })
  .catch((err) => {
    console.error('[api] failed to initialize database schema:', err);
    process.exit(1);
  });
