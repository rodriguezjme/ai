// Base de datos: SQLite local (archivo) o Turso en producción (misma API).
const { createClient } = require('@libsql/client');

const db = createClient({
  url: process.env.DATABASE_URL || 'file:amigo.db',
  authToken: process.env.DATABASE_AUTH_TOKEN || undefined,
});

async function init() {
  await db.batch([
    `CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      is_admin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS assignments (
      giver_id INTEGER PRIMARY KEY REFERENCES users(id),
      receiver_id INTEGER NOT NULL REFERENCES users(id)
    )`,
    `CREATE TABLE IF NOT EXISTS hints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_id INTEGER NOT NULL REFERENCES users(id),
      to_id INTEGER NOT NULL REFERENCES users(id),
      text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`,
  ], 'write');
}

async function one(sql, args = []) {
  const r = await db.execute({ sql, args });
  return r.rows[0] || null;
}
async function all(sql, args = []) {
  const r = await db.execute({ sql, args });
  return r.rows;
}
async function run(sql, args = []) {
  return db.execute({ sql, args });
}

module.exports = { db, init, one, all, run };
