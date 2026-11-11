// Administração (só o dono): contas, senhas e backups automáticos
const fs = require('fs');
const path = require('path');
const { db, DATA_DIR, FILES_DIR, AVATAR_DIR, ICON_DIR, getSetting, setSetting } = require('./db');
const { now } = require('./util');
const { auth, ownerOnly, hashPassword, tempPassword } = require('./accounts');

// ---------- backup ----------
// Todo dia: uma cópia do banco (mensagens, contas, canais), guardando as 7 mais recentes.
// Anexos e fotos nunca mudam depois de enviados, então são copiados uma vez só para backups/arquivos.
const BACKUP_DIR = process.env.JUNTA_BACKUP_DIR || path.join(DATA_DIR, 'backups');
const KEEP = 7;
const DAY = 864e5;

const stamp = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};
function listBackups() {
  if (!fs.existsSync(BACKUP_DIR)) return [];
  return fs.readdirSync(BACKUP_DIR).filter((f) => /^junta-.*\.db$/.test(f)).sort().reverse()
    .map((f) => { const st = fs.statSync(path.join(BACKUP_DIR, f)); return { name: f, size: st.size, created: st.mtimeMs }; });
}
function mirror(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  let copied = 0;
  for (const f of fs.readdirSync(src)) {
    const to = path.join(dest, f);
    if (!fs.existsSync(to)) { fs.copyFileSync(path.join(src, f), to); copied++; }
  }
  return copied;
}
function runBackup() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const file = path.join(BACKUP_DIR, `junta-${stamp()}.db`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`); // cópia consistente mesmo com o Junta em uso
  const files = mirror(FILES_DIR, path.join(BACKUP_DIR, 'arquivos', 'anexos')) + mirror(AVATAR_DIR, path.join(BACKUP_DIR, 'arquivos', 'avatares'))
    + mirror(ICON_DIR, path.join(BACKUP_DIR, 'arquivos', 'icones'));
  for (const old of listBackups().slice(KEEP)) fs.rmSync(path.join(BACKUP_DIR, old.name), { force: true });
  return { name: path.basename(file), files };
}
function scheduleBackups(log = console.log) {
  const check = () => {
    try {
      const last = listBackups()[0];
      if (!last || now() - last.created > DAY) { const r = runBackup(); log(`Backup feito: ${r.name}`); }
    } catch (e) { log(`Não foi possível fazer o backup: ${e.message}`); }
  };
  check();
  setInterval(check, 36e5).unref(); // confere a cada hora
}

const THEMES = ['noite']; // temas de fim de ano disponíveis
const currentTheme = () => (THEMES.includes(getSetting('theme')) ? getSetting('theme') : null);

function routes(app, ctx) {
  const findUser = (id) => db.prepare('SELECT id, username, role, disabled FROM users WHERE id = ?').get(Number(id));

  app.get('/api/admin/users', auth, ownerOnly, (req, res) => {
    const rows = db.prepare(`SELECT u.id, u.username, u.display, u.role, u.disabled, u.created,
      (SELECT MAX(seen) FROM sessions s WHERE s.user_id = u.id) AS seen,
      (SELECT COUNT(*) FROM messages m WHERE m.user_id = u.id) AS messages
      FROM users u ORDER BY u.disabled, u.display COLLATE NOCASE`).all();
    const onlineIds = new Set(Object.values(ctx.rt.online).map((o) => o.uid));
    res.json({ users: rows.map((r) => ({ ...r, disabled: !!r.disabled, online: onlineIds.has(r.id) })) });
  });

  // gera uma senha temporária; a pessoa entra com ela e troca em "Trocar senha"
  app.post('/api/admin/users/:id/reset', auth, ownerOnly, async (req, res) => {
    const u = findUser(req.params.id);
    if (!u) return res.status(404).json({ error: 'Conta não encontrada.' });
    if (u.id === req.user.id) return res.status(400).json({ error: 'Para trocar a sua própria senha, use "Trocar senha" no menu do seu nome.' });
    const pw = tempPassword();
    db.prepare('UPDATE users SET pass = ? WHERE id = ?').run(await hashPassword(pw), u.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
    ctx.rt.disconnectWhere((x) => x.id === u.id);
    res.json({ password: pw });
  });

  // remover: a conta não entra mais e some da lista; as mensagens antigas continuam
  app.post('/api/admin/users/:id/remove', auth, ownerOnly, (req, res) => {
    const u = findUser(req.params.id);
    if (!u) return res.status(404).json({ error: 'Conta não encontrada.' });
    if (u.role === 'owner') return res.status(400).json({ error: 'A conta do dono não pode ser removida.' });
    db.prepare('UPDATE users SET disabled = 1 WHERE id = ?').run(u.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
    ctx.rt.disconnectWhere((x) => x.id === u.id);
    ctx.rt.broadcastPresence();
    res.json({ ok: true });
  });
  app.post('/api/admin/users/:id/restore', auth, ownerOnly, (req, res) => {
    const u = findUser(req.params.id);
    if (!u) return res.status(404).json({ error: 'Conta não encontrada.' });
    db.prepare('UPDATE users SET disabled = 0 WHERE id = ?').run(u.id);
    ctx.rt.broadcastPresence();
    res.json({ ok: true });
  });

  // tema de fim de ano: o dono liga e desliga para todo mundo, na hora
  app.get('/api/theme', (req, res) => res.set('Cache-Control', 'no-store').json({ theme: currentTheme() }));
  app.post('/api/admin/theme', auth, ownerOnly, (req, res) => {
    const theme = req.body?.theme ?? null;
    if (theme !== null && !THEMES.includes(theme)) return res.status(400).json({ error: 'Tema desconhecido.' });
    setSetting('theme', theme || '');
    ctx.io.emit('theme', { theme });
    res.json({ ok: true, theme });
  });

  app.get('/api/admin/backups', auth, ownerOnly, (req, res) => res.json({ dir: BACKUP_DIR, keep: KEEP, backups: listBackups() }));
  app.post('/api/admin/backups', auth, ownerOnly, (req, res) => {
    try { res.json(runBackup()); } catch (e) { res.status(500).json({ error: `Não foi possível fazer o backup: ${e.message}` }); }
  });
}

module.exports = { routes, runBackup, listBackups, scheduleBackups, BACKUP_DIR, currentTheme };
