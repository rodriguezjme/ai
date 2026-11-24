// Base de datos: SQLite local (archivo) o Turso en producción (misma API).
const { createClient } = require('@libsql/client');

const db = createClient({
  url: process.env.DATABASE_URL || 'file:amigo.db',
  authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
});

async function one(sql, args = []) { return (await db.execute({ sql, args })).rows[0] || null; }
async function all(sql, args = []) { return (await db.execute({ sql, args })).rows; }
async function run(sql, args = []) { return db.execute({ sql, args }); }

// Cada juego es independiente: sus jugadoras, sorteo y pistas cuelgan de games.id.
async function init() {
  await db.batch([
    `CREATE TABLE IF NOT EXISTS games (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      invite_email TEXT NOT NULL,
      max_players INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (game_id, email)
    )`,
    `CREATE TABLE IF NOT EXISTS matches (
      game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      giver_id INTEGER PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
      receiver_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS clues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      from_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      to_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_players_game ON players(game_id)`,
    `CREATE INDEX IF NOT EXISTS idx_clues_to ON clues(to_id)`,
  ], 'write');
  await migrateLegacy();
}

// La primera versión tenía un solo juego (tablas users/assignments/hints).
// Si existe y todavía no se migró, la copia como el juego "primer-juego".
async function migrateLegacy() {
  const legacy = await one(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='users'`);
  if (!legacy) return;
  if (await one(`SELECT 1 FROM games LIMIT 1`)) return;
  const users = await all(`SELECT id, name, email, password_hash, is_admin, created_at FROM users ORDER BY id`);
  if (!users.length) return;
  const slug = process.env.LEGACY_GAME_SLUG || 'primer-juego';
  const admin = users.find((u) => u.is_admin) || users[0];
  await db.batch([
    { sql: `INSERT INTO games (slug, name, invite_email, max_players) VALUES (?, ?, ?, ?)`, args: [slug, 'Primer juego', admin.email, users.length] },
    ...users.map((u) => ({
      sql: `INSERT INTO players (id, game_id, name, email, password_hash, created_at) VALUES (?, (SELECT id FROM games WHERE slug = ?), ?, ?, ?, ?)`,
      args: [u.id, slug, u.name, u.email, u.password_hash, u.created_at],
    })),
    { sql: `INSERT INTO matches (game_id, giver_id, receiver_id) SELECT (SELECT id FROM games WHERE slug = ?), giver_id, receiver_id FROM assignments`, args: [slug] },
    { sql: `INSERT INTO clues (game_id, from_id, to_id, text, created_at) SELECT (SELECT id FROM games WHERE slug = ?), from_id, to_id, text, created_at FROM hints`, args: [slug] },
  ], 'write');
  console.log(`Migrado el juego anterior a /${slug} (${users.length} jugadoras).`);
}

module.exports = { db, init, one, all, run };
