// Junta — servidor: contas, mensagens salvas, anexos e sinalização WebRTC
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`O Junta precisa do Node.js 22.13 ou mais novo (o seu é ${process.versions.node}). Instale a versão LTS em https://nodejs.org`);
  process.exit(1);
}
const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');
const multer = require('multer');
const { Server } = require('socket.io');
const fs = require('fs');
const { db, FILES_DIR, AVATAR_DIR, inviteCode, newInviteCode, removeFiles } = require('./db');

const PORT = process.env.PORT || 3000;
const PAGE = 50;                       // mensagens por carregamento
const MAX_FILE_MB = 25;
const MAX_FILES = 10;
const SESSION_DAYS = 60;
const COOKIE = 'junta_sess';

const app = express();
app.set('trust proxy', 1); // túnel / Render: respeita https e IP repassados pelo proxy
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 1e6,
  // só aceita conexões vindas da própria página do Junta
  allowRequest: (req, cb) => {
    const origin = req.headers.origin;
    try { cb(null, !origin || new URL(origin).host === req.headers.host); } catch { cb(null, false); }
  },
});

app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor/nsup', express.static(path.join(__dirname, 'node_modules/@sapphi-red/web-noise-suppressor/dist')));

// ---------- utilidades ----------
const now = () => Date.now();
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const clean = (s, n) => String(s ?? '').trim().slice(0, n);
const slug = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || crypto.randomBytes(3).toString('hex');
const parseCookies = (h = '') => Object.fromEntries(h.split(';').map((p) => p.trim().split('=')).filter((p) => p[0])
  .map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));

// ---------- senhas e sessões ----------
const scrypt = promisify(crypto.scrypt);
async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}
async function checkPassword(pw, stored) {
  const [, salt, key] = String(stored).split('$');
  if (!salt || !key) return false;
  const got = await scrypt(pw, Buffer.from(salt, 'base64'), 64, { N: 16384, r: 8, p: 1 });
  const want = Buffer.from(key, 'base64');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

const userCols = 'u.id, u.username, u.display, u.role';
function sessionUser(token) {
  if (!token) return null;
  const h = sha(token);
  const row = db.prepare(`SELECT ${userCols}, s.seen FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`).get(h);
  if (!row) return null;
  if (now() - row.seen > SESSION_DAYS * 864e5) { db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(h); return null; }
  if (now() - row.seen > 36e5) db.prepare('UPDATE sessions SET seen = ? WHERE token_hash = ?').run(now(), h);
  return { id: row.id, username: row.username, display: row.display, role: row.role, tokenHash: h };
}
function startSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token_hash, user_id, created, seen) VALUES (?, ?, ?, ?)').run(sha(token), userId, now(), now());
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}${secure}`);
}
function auth(req, res, next) {
  const u = sessionUser(parseCookies(req.headers.cookie)[COOKIE]);
  if (!u) return res.status(401).json({ error: 'Faça login para continuar.' });
  req.user = u; next();
}
const publicUser = (u) => ({
  id: u.id, username: u.username, name: u.display, role: u.role,
  avatar: u.avatar || null, bio: u.bio || '', color: u.color || null, pronouns: u.pronouns || '',
  statusText: u.status_text || '', created: u.created,
});
const fullUser = (id) => db.prepare('SELECT id, username, display, role, avatar, bio, color, pronouns, status_text, created FROM users WHERE id = ?').get(id);

// limite simples de tentativas por IP (login e cadastro)
const attempts = new Map();
function tooMany(ip) {
  const a = attempts.get(ip);
  return a && a.until > now() && a.count >= 10;
}
function failed(ip) {
  const a = attempts.get(ip);
  if (!a || a.until < now()) attempts.set(ip, { count: 1, until: now() + 15 * 60e3 });
  else a.count++;
}

// ---------- rotas de conta ----------
app.get('/api/me', auth, (req, res) => res.json({ user: publicUser(fullUser(req.user.id)), maxFileMb: MAX_FILE_MB, maxFiles: MAX_FILES }));

app.post('/api/register', async (req, res) => {
  if (tooMany(req.ip)) return res.status(429).json({ error: 'Muitas tentativas. Espere 15 minutos e tente de novo.' });
  const username = clean(req.body?.username, 24);
  const password = String(req.body?.password ?? '');
  const invite = clean(req.body?.invite, 20).toUpperCase().replace(/\s/g, '');
  if (!/^[a-zA-Z0-9_.-]{3,24}$/.test(username)) return res.status(400).json({ error: 'O usuário precisa ter de 3 a 24 caracteres: letras, números, ponto, hífen ou sublinhado.' });
  if (password.length < 6 || password.length > 200) return res.status(400).json({ error: 'A senha precisa ter pelo menos 6 caracteres.' });
  const want = inviteCode();
  if (invite.length !== want.length || !crypto.timingSafeEqual(Buffer.from(invite), Buffer.from(want))) {
    failed(req.ip);
    return res.status(403).json({ error: 'Código de convite inválido. Peça o código para quem administra o Junta.' });
  }
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) return res.status(409).json({ error: 'Esse usuário já existe. Escolha outro.' });
  const first = !db.prepare('SELECT 1 FROM users LIMIT 1').get();
  const r = db.prepare('INSERT INTO users (username, display, pass, role, created) VALUES (?, ?, ?, ?, ?)')
    .run(username, username, await hashPassword(password), first ? 'owner' : 'member', now());
  startSession(req, res, Number(r.lastInsertRowid));
  broadcastPresence();
  res.json({ ok: true });
});

app.post('/api/login', async (req, res) => {
  if (tooMany(req.ip)) return res.status(429).json({ error: 'Muitas tentativas. Espere 15 minutos e tente de novo.' });
  const row = db.prepare('SELECT id, pass FROM users WHERE username = ?').get(clean(req.body?.username, 24));
  const ok = row && await checkPassword(String(req.body?.password ?? ''), row.pass);
  if (!ok) { failed(req.ip); return res.status(401).json({ error: 'Usuário ou senha incorretos.' }); }
  startSession(req, res, row.id);
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) {
    const h = sha(token);
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(h);
    for (const s of io.sockets.sockets.values()) if (s.data.user?.tokenHash === h) s.disconnect(true);
  }
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  res.json({ ok: true });
});

app.get('/api/invite', auth, (req, res) => {
  if (req.user.role !== 'owner') return res.status(403).json({ error: 'Só o dono vê o código de convite.' });
  res.json({ code: inviteCode() });
});
app.post('/api/invite/new', auth, (req, res) => {
  if (req.user.role !== 'owner') return res.status(403).json({ error: 'Só o dono pode gerar um novo código.' });
  res.json({ code: newInviteCode() });
});

// ---------- foto de perfil ----------
// O navegador já recorta e reduz a foto para 256×256; aqui só conferimos que é mesmo uma imagem.
const avatarUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } });
function imageKind(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (buf.length > 6 && buf.toString('latin1', 0, 4) === 'GIF8') return 'gif';
  return null;
}
const AVATAR_TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
function setAvatar(userId, file) {
  const old = db.prepare('SELECT avatar FROM users WHERE id = ?').get(userId)?.avatar;
  db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(file, userId);
  if (old) fs.rm(path.join(AVATAR_DIR, path.basename(old)), { force: true }, () => {});
  broadcastPresence();
}
app.post('/api/avatar', auth, (req, res) => {
  avatarUpload.single('avatar')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'A foto pode ter no máximo 2 MB.' : 'Não foi possível enviar a foto.' });
    const kind = req.file && imageKind(req.file.buffer);
    if (!kind) return res.status(400).json({ error: 'Envie uma imagem PNG, JPG, WEBP ou GIF.' });
    const file = `${req.user.id}-${crypto.randomBytes(6).toString('hex')}.${kind}`; // nome novo a cada troca: o cache não mostra a foto antiga
    fs.writeFile(path.join(AVATAR_DIR, file), req.file.buffer, (e) => {
      if (e) return res.status(500).json({ error: 'Não foi possível salvar a foto.' });
      setAvatar(req.user.id, file);
      res.json({ avatar: file });
    });
  });
});
app.delete('/api/avatar', auth, (req, res) => { setAvatar(req.user.id, null); res.json({ ok: true }); });
app.get('/avatares/:file', auth, (req, res) => {
  const file = path.basename(req.params.file);
  const kind = file.split('.').pop();
  if (!AVATAR_TYPES[kind]) return res.status(404).end();
  res.setHeader('Content-Type', AVATAR_TYPES[kind]);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.sendFile(file, { root: AVATAR_DIR }, (err) => { if (err && !res.headersSent) res.status(404).end(); });
});

// ---------- anexos ----------
const upload = multer({
  storage: multer.diskStorage({
    destination: FILES_DIR,
    filename: (req, file, cb) => cb(null, crypto.randomUUID()),
  }),
  limits: { fileSize: MAX_FILE_MB * 1024 * 1024, files: MAX_FILES },
});

app.post('/api/upload', auth, (req, res) => {
  upload.array('files', MAX_FILES)(req, res, (err) => {
    if (err) {
      const msg = err.code === 'LIMIT_FILE_SIZE' ? `Cada arquivo pode ter no máximo ${MAX_FILE_MB} MB.`
        : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE' ? `Envie no máximo ${MAX_FILES} arquivos por mensagem.`
        : 'Não foi possível enviar o arquivo.';
      return res.status(400).json({ error: msg });
    }
    const ins = db.prepare('INSERT INTO attachments (id, message_id, user_id, name, mime, size, file, created) VALUES (?, NULL, ?, ?, ?, ?, ?, ?)');
    const out = (req.files || []).map((f) => {
      // o navegador manda o nome em latin1; converte de volta para UTF-8 (acentos)
      const name = clean(Buffer.from(f.originalname, 'latin1').toString('utf8'), 180) || 'arquivo';
      const id = crypto.randomUUID();
      const mime = clean(f.mimetype, 100) || 'application/octet-stream';
      ins.run(id, req.user.id, name, mime, f.size, f.filename, now());
      return { id, name, mime, size: f.size };
    });
    res.json({ files: out });
  });
});

// Tipos exibidos dentro da página; o resto sempre vira download (nunca HTML/SVG executável)
const INLINE = /^(image\/(png|jpe?g|gif|webp|avif)|video\/(mp4|webm|ogg)|audio\/(mpeg|ogg|wav|webm|mp4|aac|flac|x-m4a)|application\/pdf)$/;
app.get('/anexos/:id/:name?', auth, (req, res) => {
  const a = db.prepare('SELECT * FROM attachments WHERE id = ?').get(req.params.id);
  if (!a || (!a.message_id && a.user_id !== req.user.id)) return res.status(404).send('Arquivo não encontrado.');
  const inline = INLINE.test(a.mime) && req.query.download === undefined;
  res.setHeader('Content-Type', inline ? a.mime : 'application/octet-stream');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(a.name)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (a.mime !== 'application/pdf') res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; sandbox");
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.sendFile(a.file, { root: FILES_DIR, headers: {} }, (err) => { if (err && !res.headersSent) res.status(404).end(); });
});

// anexos enviados mas nunca usados numa mensagem: apaga depois de 1 dia
function cleanupPending() {
  const old = db.prepare('SELECT file FROM attachments WHERE message_id IS NULL AND created < ?').all(now() - 864e5);
  if (!old.length) return;
  removeFiles(old);
  db.prepare('DELETE FROM attachments WHERE message_id IS NULL AND created < ?').run(now() - 864e5);
}
cleanupPending();
setInterval(cleanupPending, 36e5).unref();

// ---------- servidores, canais e mensagens ----------
function serverList() {
  const servers = db.prepare('SELECT id, name FROM servers ORDER BY pos, rowid').all();
  const chans = db.prepare('SELECT server_id, id, name, type FROM channels ORDER BY pos, rowid').all();
  return servers.map((s) => ({ ...s, channels: chans.filter((c) => c.server_id === s.id).map(({ server_id, ...c }) => c) }));
}
const channelRow = (key) => {
  const [sid, cid] = String(key).split('/');
  return db.prepare('SELECT * FROM channels WHERE server_id = ? AND id = ?').get(sid ?? '', cid ?? '');
};

function attachmentsFor(ids) {
  if (!ids.length) return {};
  const rows = db.prepare(`SELECT id, message_id, name, mime, size FROM attachments WHERE message_id IN (${ids.map(() => '?').join(',')}) ORDER BY created`).all(...ids);
  const by = {};
  for (const r of rows) (by[r.message_id] ||= []).push({ id: r.id, name: r.name, mime: r.mime, size: r.size });
  return by;
}
function shapeMessages(rows) {
  const att = attachmentsFor(rows.map((r) => r.id));
  return rows.map((r) => ({ id: r.id, seq: r.seq, uid: r.user_id, text: r.text, ts: r.ts, edited: r.edited || null, att: att[r.id] || [] }));
}
function loadPage(key, before) {
  const rows = before
    ? db.prepare('SELECT * FROM messages WHERE chan = ? AND seq < ? ORDER BY seq DESC LIMIT ?').all(key, before, PAGE)
    : db.prepare('SELECT * FROM messages WHERE chan = ? ORDER BY seq DESC LIMIT ?').all(key, PAGE);
  return { messages: shapeMessages(rows.reverse()), more: rows.length === PAGE };
}

// ---------- presença e voz ----------
const online = {}; // socketId -> { uid, status }
const voice = {};  // "serverId/channelId" -> { socketId: { uid, name, muted, sharing } }
const STATUSES = ['online', 'idle', 'dnd'];
const allUsers = () => db.prepare('SELECT id, username, display, role, avatar, bio, color, pronouns, status_text, created FROM users ORDER BY display COLLATE NOCASE').all().map(publicUser);
// apelidos por servidor: { userId: { serverId: apelido } }
function allNicks() {
  const out = {};
  for (const r of db.prepare('SELECT server_id, user_id, nick FROM nicknames').all()) (out[r.user_id] ||= {})[r.server_id] = r.nick;
  return out;
}
// nome que aparece num servidor: apelido de lá, ou o nome de exibição
function nameIn(userId, serverId) {
  return db.prepare('SELECT nick FROM nicknames WHERE server_id = ? AND user_id = ?').get(serverId, userId)?.nick
    || db.prepare('SELECT display FROM users WHERE id = ?').get(userId)?.display || 'Alguém';
}
// atualiza o nome mostrado nas salas de voz depois de trocar nome ou apelido
function refreshVoiceNames(userId) {
  let changed = false;
  for (const [key, room] of Object.entries(voice)) for (const m of Object.values(room)) {
    if (m.uid === userId) { m.name = nameIn(userId, key.split('/')[0]); changed = true; }
  }
  if (changed) io.emit('voice-state', voiceSnapshot());
}
const presencePayload = () => ({ users: allUsers(), nicks: allNicks(), online: Object.entries(online).map(([sid, o]) => ({ sid, ...o })) });
let presenceTimer = null;
function broadcastPresence() { // agrupa rajadas de mudanças num só envio
  clearTimeout(presenceTimer);
  presenceTimer = setTimeout(() => io.emit('presence', presencePayload()), 150);
}
function voiceSnapshot() {
  const out = {};
  for (const [key, members] of Object.entries(voice)) {
    const list = Object.entries(members).map(([id, m]) => ({ id, ...m }));
    if (list.length) out[key] = list;
  }
  return out;
}
function leaveVoice(socket) {
  const key = socket.data.voice;
  if (!key) return;
  if (voice[key]) delete voice[key][socket.id];
  socket.leave('v:' + key);
  socket.to('v:' + key).emit('peer-left', socket.id);
  socket.data.voice = null;
  io.emit('voice-state', voiceSnapshot());
}

// ---------- socket autenticado ----------
io.use((socket, next) => {
  const u = sessionUser(parseCookies(socket.request.headers.cookie)[COOKIE]);
  if (!u) return next(new Error('unauthorized'));
  socket.data.user = u;
  next();
});

io.on('connection', (socket) => {
  const me = () => socket.data.user;
  const isOwner = () => me().role === 'owner';
  const reply = (cb, v) => { if (typeof cb === 'function') cb(v); };

  socket.on('hello', (payload, cb) => {
    const status = STATUSES.includes(payload?.status) ? payload.status : 'online';
    online[socket.id] = { uid: me().id, status };
    broadcastPresence();
    reply(cb, { sid: socket.id, user: publicUser(fullUser(me().id)), servers: serverList(), voice: voiceSnapshot(), ...presencePayload() });
  });

  socket.on('set-status', (status) => {
    if (!online[socket.id] || !STATUSES.includes(status)) return;
    online[socket.id].status = status;
    broadcastPresence();
  });

  socket.on('profile-update', (p = {}, cb) => {
    const display = clean(p.display, 32);
    if (!display) return reply(cb, { error: 'O nome de exibição não pode ficar vazio.' });
    const color = /^#[0-9a-f]{6}$/i.test(p.color || '') ? p.color.toLowerCase() : null;
    db.prepare('UPDATE users SET display = ?, pronouns = ?, status_text = ?, bio = ?, color = ? WHERE id = ?')
      .run(display, clean(p.pronouns, 40), clean(p.statusText, 60), clean(p.bio, 190), color, me().id);
    for (const s of io.sockets.sockets.values()) if (s.data.user?.id === me().id) s.data.user.display = display;
    refreshVoiceNames(me().id);
    broadcastPresence();
    reply(cb, { ok: true });
  });

  socket.on('set-nick', ({ serverId, nick } = {}, cb) => {
    if (!db.prepare('SELECT 1 FROM servers WHERE id = ?').get(String(serverId))) return reply(cb, { error: 'Servidor não encontrado.' });
    const n = clean(nick, 32);
    if (n) db.prepare('INSERT INTO nicknames (server_id, user_id, nick) VALUES (?, ?, ?) ON CONFLICT(server_id, user_id) DO UPDATE SET nick = excluded.nick').run(serverId, me().id, n);
    else db.prepare('DELETE FROM nicknames WHERE server_id = ? AND user_id = ?').run(serverId, me().id);
    refreshVoiceNames(me().id);
    broadcastPresence();
    reply(cb, { ok: true });
  });

  // --- mensagens ---
  socket.on('join-text', (key, cb) => {
    if (!channelRow(key) || channelRow(key).type !== 'text') return reply(cb, { messages: [], more: false });
    if (socket.data.text) socket.leave('t:' + socket.data.text);
    socket.data.text = key;
    socket.join('t:' + key);
    reply(cb, loadPage(key));
  });

  socket.on('history', ({ key, before } = {}, cb) => {
    if (!channelRow(key) || !Number.isInteger(before)) return reply(cb, { messages: [], more: false });
    reply(cb, loadPage(key, before));
  });

  socket.on('message', ({ key, text, att } = {}, cb) => {
    const body = clean(text, 4000);
    const ids = Array.isArray(att) ? att.filter((x) => typeof x === 'string').slice(0, MAX_FILES) : [];
    const ch = channelRow(key);
    if (!ch || ch.type !== 'text') return reply(cb, { error: 'Canal não encontrado.' });
    // só anexos do próprio usuário e ainda não usados
    const mine = ids.length
      ? db.prepare(`SELECT id FROM attachments WHERE user_id = ? AND message_id IS NULL AND id IN (${ids.map(() => '?').join(',')})`).all(me().id, ...ids).map((r) => r.id)
      : [];
    if (!body && !mine.length) return reply(cb, { error: 'Mensagem vazia.' });
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO messages (id, chan, user_id, text, ts) VALUES (?, ?, ?, ?, ?)').run(id, key, me().id, body, now());
    if (mine.length) db.prepare(`UPDATE attachments SET message_id = ? WHERE id IN (${mine.map(() => '?').join(',')})`).run(id, ...mine);
    const [msg] = shapeMessages([db.prepare('SELECT * FROM messages WHERE id = ?').get(id)]);
    io.to('t:' + key).emit('message', { key, msg });
    reply(cb, { ok: true });
  });

  socket.on('message-edit', ({ id, text } = {}, cb) => {
    const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(String(id));
    if (!m || m.user_id !== me().id) return reply(cb, { error: 'Você só pode editar as suas mensagens.' });
    const body = clean(text, 4000);
    const hasAtt = db.prepare('SELECT 1 FROM attachments WHERE message_id = ? LIMIT 1').get(m.id);
    if (!body && !hasAtt) return reply(cb, { error: 'A mensagem não pode ficar vazia.' });
    db.prepare('UPDATE messages SET text = ?, edited = ? WHERE id = ?').run(body, now(), m.id);
    const [msg] = shapeMessages([db.prepare('SELECT * FROM messages WHERE id = ?').get(m.id)]);
    io.to('t:' + m.chan).emit('message-update', { key: m.chan, msg });
    reply(cb, { ok: true });
  });

  socket.on('message-delete', (id, cb) => {
    const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(String(id));
    if (!m || (m.user_id !== me().id && !isOwner())) return reply(cb, { error: 'Você não pode apagar essa mensagem.' });
    removeFiles(db.prepare('SELECT file FROM attachments WHERE message_id = ?').all(m.id));
    db.prepare('DELETE FROM messages WHERE id = ?').run(m.id);
    io.to('t:' + m.chan).emit('message-delete', { key: m.chan, id: m.id });
    reply(cb, { ok: true });
  });

  socket.on('typing', (key) => {
    if (socket.data.text === key) socket.to('t:' + key).emit('typing', { key, uid: me().id });
  });

  // --- servidores e canais (só o dono) ---
  socket.on('create-server', (name, cb) => {
    if (!isOwner()) return reply(cb, { error: 'Só o dono pode criar servidores.' });
    const n = clean(name, 40);
    if (!n) return reply(cb, { error: 'Dê um nome ao servidor.' });
    let id = slug(n);
    while (db.prepare('SELECT 1 FROM servers WHERE id = ?').get(id)) id += '-' + crypto.randomBytes(2).toString('hex');
    const pos = (db.prepare('SELECT MAX(pos) m FROM servers').get().m ?? -1) + 1;
    db.prepare('INSERT INTO servers (id, name, pos) VALUES (?, ?, ?)').run(id, n, pos);
    db.prepare('INSERT INTO channels (server_id, id, name, type, pos) VALUES (?, ?, ?, ?, ?)').run(id, 'geral', 'geral', 'text', 0);
    db.prepare('INSERT INTO channels (server_id, id, name, type, pos) VALUES (?, ?, ?, ?, ?)').run(id, 'voz', 'Voz', 'voice', 1);
    io.emit('servers', serverList());
    reply(cb, { ok: true, id });
  });

  socket.on('create-channel', ({ serverId, name, type } = {}, cb) => {
    if (!isOwner()) return reply(cb, { error: 'Só o dono pode criar canais.' });
    const n = clean(name, 40);
    if (!n || !db.prepare('SELECT 1 FROM servers WHERE id = ?').get(String(serverId))) return reply(cb, { error: 'Dê um nome ao canal.' });
    const t = type === 'voice' ? 'voice' : 'text';
    let id = slug(n);
    while (db.prepare('SELECT 1 FROM channels WHERE server_id = ? AND id = ?').get(serverId, id)) id += '-' + crypto.randomBytes(2).toString('hex');
    const pos = (db.prepare('SELECT MAX(pos) m FROM channels WHERE server_id = ?').get(serverId).m ?? -1) + 1;
    db.prepare('INSERT INTO channels (server_id, id, name, type, pos) VALUES (?, ?, ?, ?, ?)').run(serverId, id, t === 'text' ? slug(n) : n, t, pos);
    io.emit('servers', serverList());
    reply(cb, { ok: true, id });
  });

  socket.on('delete-channel', (key, cb) => {
    if (!isOwner()) return reply(cb, { error: 'Só o dono pode apagar canais.' });
    const ch = channelRow(key);
    if (!ch) return reply(cb, { error: 'Canal não encontrado.' });
    const left = db.prepare('SELECT COUNT(*) n FROM channels WHERE server_id = ? AND type = ?').get(ch.server_id, 'text').n;
    if (ch.type === 'text' && left <= 1) return reply(cb, { error: 'Cada servidor precisa de pelo menos um canal de texto.' });
    removeFiles(db.prepare('SELECT a.file FROM attachments a JOIN messages m ON m.id = a.message_id WHERE m.chan = ?').all(key));
    db.prepare('DELETE FROM messages WHERE chan = ?').run(key);
    db.prepare('DELETE FROM channels WHERE server_id = ? AND id = ?').run(ch.server_id, ch.id);
    // quem estava na sala de voz apagada é desconectado dela
    for (const sid of Object.keys(voice[key] || {})) { const s = io.sockets.sockets.get(sid); if (s) { leaveVoice(s); s.emit('voice-kicked'); } }
    delete voice[key];
    io.emit('servers', serverList());
    io.emit('voice-state', voiceSnapshot());
    reply(cb, { ok: true });
  });

  // --- voz / tela (sinalização) ---
  socket.on('voice-join', (key, cb) => {
    const ch = channelRow(key);
    if (!ch || ch.type !== 'voice') return;
    leaveVoice(socket);
    voice[key] ||= {};
    const peers = Object.keys(voice[key]);
    voice[key][socket.id] = { uid: me().id, name: nameIn(me().id, ch.server_id), muted: false, sharing: false };
    socket.data.voice = key;
    socket.join('v:' + key);
    reply(cb, peers);
    io.emit('voice-state', voiceSnapshot());
  });

  socket.on('voice-leave', () => leaveVoice(socket));

  socket.on('voice-update', (patch = {}) => {
    const key = socket.data.voice;
    const m = key && voice[key]?.[socket.id];
    if (!m) return;
    if ('muted' in patch) m.muted = !!patch.muted;
    if ('sharing' in patch) m.sharing = !!patch.sharing;
    io.emit('voice-state', voiceSnapshot());
  });

  socket.on('signal', ({ to, data } = {}) => {
    const key = socket.data.voice;
    if (!key || !voice[key]?.[to]) return; // só entre membros da mesma sala
    io.to(to).emit('signal', { from: socket.id, data });
  });

  socket.on('disconnect', () => {
    leaveVoice(socket);
    delete online[socket.id];
    broadcastPresence();
  });
});

server.listen(PORT, () => {
  console.log(`Junta rodando em http://localhost:${PORT}`);
  const owner = db.prepare("SELECT 1 FROM users WHERE role = 'owner'").get();
  console.log(owner
    ? `Código de convite para novos amigos: ${inviteCode()}`
    : `Primeira vez: abra o endereço acima e crie a sua conta com o código ${inviteCode()}. Quem criar a primeira conta vira o dono do Junta.`);
});
