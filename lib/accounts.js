// Contas: senhas, sessões, cadastro com convite, login e troca de senha
const crypto = require('crypto');
const { promisify } = require('util');
const { db, inviteCode, newInviteCode } = require('./db');
const { now, sha, clean, parseCookies } = require('./util');

const SESSION_DAYS = 60;
const COOKIE = 'junta_sess';

// ---------- senhas ----------
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
const validPassword = (pw) => typeof pw === 'string' && pw.length >= 6 && pw.length <= 200;
// senha temporária legível (sem 0/O, 1/l)
function tempPassword() {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  return Array.from(crypto.randomBytes(10), (b) => abc[b % abc.length]).join('');
}

// ---------- perfil público ----------
const USER_COLS = 'id, username, display, role, avatar, bio, color, pronouns, status_text, created, disabled';
const publicUser = (u) => ({
  id: u.id, username: u.username, name: u.display, role: u.role,
  avatar: u.avatar || null, bio: u.bio || '', color: u.color || null, pronouns: u.pronouns || '',
  statusText: u.status_text || '', created: u.created, disabled: !!u.disabled,
});
const fullUser = (id) => db.prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).get(id);
const allUsers = () => db.prepare(`SELECT ${USER_COLS} FROM users ORDER BY display COLLATE NOCASE`).all().map(publicUser);

// ---------- sessões ----------
function sessionUser(token) {
  if (!token) return null;
  const h = sha(token);
  const row = db.prepare('SELECT u.id, u.username, u.display, u.role, u.disabled, s.seen FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?').get(h);
  if (!row || row.disabled) return null;
  if (now() - row.seen > SESSION_DAYS * 864e5) { db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(h); return null; }
  if (now() - row.seen > 36e5) db.prepare('UPDATE sessions SET seen = ? WHERE token_hash = ?').run(now(), h);
  return { id: row.id, username: row.username, display: row.display, role: row.role, tokenHash: h };
}
const userFromCookie = (cookieHeader) => sessionUser(parseCookies(cookieHeader)[COOKIE]);
function startSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token_hash, user_id, created, seen) VALUES (?, ?, ?, ?)').run(sha(token), userId, now(), now());
  const secure = req.secure ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}${secure}`);
}
function auth(req, res, next) {
  const u = userFromCookie(req.headers.cookie);
  if (!u) return res.status(401).json({ error: 'Faça login para continuar.' });
  req.user = u; next();
}
function ownerOnly(req, res, next) {
  if (req.user?.role !== 'owner') return res.status(403).json({ error: 'Só o dono do Junta pode fazer isso.' });
  next();
}

// limite simples de tentativas por IP (login, cadastro e troca de senha)
const attempts = new Map();
const tooMany = (ip) => { const a = attempts.get(ip); return a && a.until > now() && a.count >= 10; };
function failed(ip) {
  const a = attempts.get(ip);
  if (!a || a.until < now()) attempts.set(ip, { count: 1, until: now() + 15 * 60e3 });
  else a.count++;
}
const TOO_MANY = { error: 'Muitas tentativas. Espere 15 minutos e tente de novo.' };

function routes(app, ctx) {
  app.get('/api/me', auth, (req, res) => res.json({ user: publicUser(fullUser(req.user.id)), maxFileMb: ctx.MAX_FILE_MB, maxFiles: ctx.MAX_FILES }));

  app.post('/api/register', async (req, res) => {
    if (tooMany(req.ip)) return res.status(429).json(TOO_MANY);
    const username = clean(req.body?.username, 24);
    const password = String(req.body?.password ?? '');
    const invite = clean(req.body?.invite, 20).toUpperCase().replace(/\s/g, '');
    if (!/^[a-zA-Z0-9_.-]{3,24}$/.test(username)) return res.status(400).json({ error: 'O usuário precisa ter de 3 a 24 caracteres: letras, números, ponto, hífen ou sublinhado.' });
    if (!validPassword(password)) return res.status(400).json({ error: 'A senha precisa ter pelo menos 6 caracteres.' });
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
    ctx.rt.broadcastPresence();
    res.json({ ok: true });
  });

  app.post('/api/login', async (req, res) => {
    if (tooMany(req.ip)) return res.status(429).json(TOO_MANY);
    const row = db.prepare('SELECT id, pass, disabled FROM users WHERE username = ?').get(clean(req.body?.username, 24));
    const ok = row && !row.disabled && await checkPassword(String(req.body?.password ?? ''), row.pass);
    if (!ok) { failed(req.ip); return res.status(401).json({ error: 'Usuário ou senha incorretos.' }); }
    startSession(req, res, row.id);
    res.json({ ok: true });
  });

  app.post('/api/logout', (req, res) => {
    const token = parseCookies(req.headers.cookie)[COOKIE];
    if (token) {
      const h = sha(token);
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(h);
      ctx.rt.disconnectWhere((u) => u.tokenHash === h);
    }
    res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
    res.json({ ok: true });
  });

  // trocar a própria senha: as outras sessões (outros aparelhos) são encerradas
  app.post('/api/password', auth, async (req, res) => {
    if (tooMany(req.ip)) return res.status(429).json(TOO_MANY);
    const row = db.prepare('SELECT pass FROM users WHERE id = ?').get(req.user.id);
    if (!await checkPassword(String(req.body?.current ?? ''), row.pass)) { failed(req.ip); return res.status(403).json({ error: 'A senha atual não confere.' }); }
    const next = String(req.body?.next ?? '');
    if (!validPassword(next)) return res.status(400).json({ error: 'A nova senha precisa ter pelo menos 6 caracteres.' });
    db.prepare('UPDATE users SET pass = ? WHERE id = ?').run(await hashPassword(next), req.user.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').run(req.user.id, req.user.tokenHash);
    ctx.rt.disconnectWhere((u) => u.id === req.user.id && u.tokenHash !== req.user.tokenHash);
    res.json({ ok: true });
  });

  // ver o convite: o dono, ou quem tem "Convidar" em algum servidor
  app.get('/api/invite', auth, (req, res) => {
    const perms = require('./perms'); // aqui dentro para evitar ciclo de módulos
    const ok = req.user.role === 'owner' || db.prepare('SELECT id FROM servers').all().some((s) => perms.canServer(req.user.id, s.id, perms.P.INVITE));
    if (!ok) return res.status(403).json({ error: 'Você não tem permissão para convidar pessoas.' });
    res.json({ code: inviteCode() });
  });
  app.post('/api/invite/new', auth, ownerOnly, (req, res) => res.json({ code: newInviteCode() }));
}

module.exports = {
  routes, auth, ownerOnly, userFromCookie, hashPassword, tempPassword,
  publicUser, fullUser, allUsers, COOKIE,
};
