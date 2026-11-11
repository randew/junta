// Junta — banco de dados (SQLite embutido no Node, arquivo em dados/junta.db)
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// a pasta de dados fica na raiz do projeto (um nível acima de lib/)
const DATA_DIR = process.env.JUNTA_DATA || path.join(__dirname, '..', 'dados');
const FILES_DIR = path.join(DATA_DIR, 'anexos');
const AVATAR_DIR = path.join(DATA_DIR, 'avatares');
const ICON_DIR = path.join(DATA_DIR, 'icones'); // ícones dos servidores
fs.mkdirSync(FILES_DIR, { recursive: true });
fs.mkdirSync(ICON_DIR, { recursive: true });
fs.mkdirSync(AVATAR_DIR, { recursive: true });

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

// Perfil: colunas adicionadas depois da primeira versão (o banco existente é atualizado sem perder nada)
const userCols = new Set(db.prepare('PRAGMA table_info(users)').all().map((c) => c.name));
for (const [col, def] of [['avatar', 'TEXT'], ['bio', "TEXT NOT NULL DEFAULT ''"], ['color', 'TEXT'], ['pronouns', "TEXT NOT NULL DEFAULT ''"], ['status_text', "TEXT NOT NULL DEFAULT ''"]]) {
  if (!userCols.has(col)) db.exec(`ALTER TABLE users ADD COLUMN ${col} ${def}`);
}
db.exec(`
  CREATE TABLE IF NOT EXISTS nicknames (
    server_id TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    nick      TEXT NOT NULL,
    PRIMARY KEY (server_id, user_id)
  );
`);

// ---------- versão 4: leitura, menções, respostas, reações, prévias, contas desativadas, busca ----------
const colsOf = (t) => new Set(db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name));
if (!colsOf('users').has('disabled')) db.exec('ALTER TABLE users ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0');
if (!colsOf('servers').has('icon')) db.exec('ALTER TABLE servers ADD COLUMN icon TEXT');
if (!colsOf('messages').has('reply_to')) db.exec('ALTER TABLE messages ADD COLUMN reply_to TEXT');
db.exec(`
  CREATE TABLE IF NOT EXISTS reads (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    chan    TEXT NOT NULL,
    seq     INTEGER NOT NULL,
    PRIMARY KEY (user_id, chan)
  );
  CREATE TABLE IF NOT EXISTS mentions (
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (message_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS mentions_user ON mentions(user_id);
  CREATE TABLE IF NOT EXISTS reactions (
    message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji      TEXT NOT NULL,
    created    INTEGER NOT NULL,
    PRIMARY KEY (message_id, user_id, emoji)
  );
  CREATE TABLE IF NOT EXISTS link_previews (
    url     TEXT PRIMARY KEY,
    data    TEXT,
    fetched INTEGER NOT NULL
  );
`);
// busca de texto (ignora acentos e maiúsculas), mantida em dia por gatilhos
const hadFts = !!db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'messages_fts'").get();
db.exec(`
  CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(text, content='messages', content_rowid='seq', tokenize='unicode61 remove_diacritics 2');
  CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts(rowid, text) VALUES (new.seq, new.text);
  END;
  CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, text) VALUES ('delete', old.seq, old.text);
  END;
  CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE OF text ON messages BEGIN
    INSERT INTO messages_fts(messages_fts, rowid, text) VALUES ('delete', old.seq, old.text);
    INSERT INTO messages_fts(rowid, text) VALUES (new.seq, new.text);
  END;
`);
if (!hadFts) db.exec("INSERT INTO messages_fts(messages_fts) VALUES ('rebuild')"); // indexa as mensagens que já existiam

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

module.exports = { db, DATA_DIR, FILES_DIR, AVATAR_DIR, ICON_DIR, getSetting, setSetting, inviteCode, newInviteCode, removeFiles };
