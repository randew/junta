// Junta — banco de dados (SQLite embutido no Node, arquivo em dados/junta.db)
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.JUNTA_DATA || path.join(__dirname, 'dados');
const FILES_DIR = path.join(DATA_DIR, 'anexos');
fs.mkdirSync(FILES_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'junta.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 3000;

  CREATE TABLE IF NOT EXISTS users (
    id        INTEGER PRIMARY KEY,
    username  TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display   TEXT NOT NULL,
    pass      TEXT NOT NULL,
    role      TEXT NOT NULL DEFAULT 'member',
    created   INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created    INTEGER NOT NULL,
    seen       INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS servers (
    id   TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    pos  INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS channels (
    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    id        TEXT NOT NULL,
    name      TEXT NOT NULL,
    type      TEXT NOT NULL,
    pos       INTEGER NOT NULL,
    PRIMARY KEY (server_id, id)
  );
  CREATE TABLE IF NOT EXISTS messages (
    seq     INTEGER PRIMARY KEY AUTOINCREMENT,
    id      TEXT NOT NULL UNIQUE,
    chan    TEXT NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id),
    text    TEXT NOT NULL,
    ts      INTEGER NOT NULL,
    edited  INTEGER
  );
  CREATE INDEX IF NOT EXISTS messages_chan_seq ON messages(chan, seq);
  CREATE TABLE IF NOT EXISTS attachments (
    id         TEXT PRIMARY KEY,
    message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id),
    name       TEXT NOT NULL,
    mime       TEXT NOT NULL,
    size       INTEGER NOT NULL,
    file       TEXT NOT NULL,
    created    INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS attachments_msg ON attachments(message_id);
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Servidores e canais iniciais (só na primeira execução)
if (!db.prepare('SELECT 1 FROM servers LIMIT 1').get()) {
  const seed = [
    ['geral', 'Geral', [['bate-papo', 'bate-papo', 'text'], ['links', 'links', 'text'], ['sala-1', 'Sala 1', 'voice'], ['sala-2', 'Sala 2', 'voice']]],
    ['trabalho', 'Trabalho', [['daily', 'daily', 'text'], ['reuniao', 'Reunião', 'voice']]],
  ];
  const insS = db.prepare('INSERT INTO servers (id, name, pos) VALUES (?, ?, ?)');
  const insC = db.prepare('INSERT INTO channels (server_id, id, name, type, pos) VALUES (?, ?, ?, ?, ?)');
  seed.forEach(([sid, name, chans], i) => {
    insS.run(sid, name, i);
    chans.forEach(([cid, cname, type], j) => insC.run(sid, cid, cname, type, j));
  });
}

const getSetting = (k) => db.prepare('SELECT value FROM settings WHERE key = ?').get(k)?.value;
const setSetting = (k, v) => db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, v);

// Código de convite: 8 letras/números sem caracteres confusos (0/O, 1/I/L)
function newInviteCode() {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const pick = () => Array.from(crypto.randomBytes(4), (b) => abc[b % abc.length]).join('');
  const code = `${pick()}-${pick()}`;
  setSetting('invite', code);
  return code;
}
const inviteCode = () => getSetting('invite') || newInviteCode();

function removeFiles(rows) {
  for (const r of rows) fs.rm(path.join(FILES_DIR, r.file), { force: true }, () => {});
}

module.exports = { db, DATA_DIR, FILES_DIR, getSetting, setSetting, inviteCode, newInviteCode, removeFiles };
