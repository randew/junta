// Emojis personalizados e soundboard, por servidor
//   - emojis: imagens pequenas usadas como :nome: nas mensagens e nas reações
//   - sons: áudios curtos que qualquer um com "Usar o soundboard" toca para a sala de voz
// Enviar e apagar pede "Gerenciar emojis e sons".
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { db, EMOJI_DIR, SOUND_DIR } = require('./db');
const { now, clean, reply } = require('./util');
const perms = require('./perms');
const { P } = perms;

const MAX_EMOJIS = 60, MAX_SOUNDS = 40;
const EMOJI_BYTES = 512 * 1024, SOUND_BYTES = 1024 * 1024;
const NAME_RE = /^[a-z0-9_]{2,32}$/;
const IMG_TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
const AUDIO_TYPES = { mp3: 'audio/mpeg', ogg: 'audio/ogg', wav: 'audio/wav', webm: 'audio/webm', m4a: 'audio/mp4' };

function imageKind(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (buf.length > 6 && buf.toString('latin1', 0, 4) === 'GIF8') return 'gif';
  return null;
}
function audioKind(buf) {
  if (buf.length < 12) return null;
  if (buf.toString('latin1', 0, 3) === 'ID3' || (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0)) return 'mp3';
  if (buf.toString('latin1', 0, 4) === 'OggS') return 'ogg';
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WAVE') return 'wav';
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'webm';
  if (buf.toString('latin1', 4, 8) === 'ftyp') return 'm4a';
  return null;
}

// ---------- leitura ----------
const emojisOf = (serverId) => db.prepare('SELECT id, name, file FROM emojis WHERE server_id = ? ORDER BY name').all(serverId);
const soundsOf = (serverId) => db.prepare('SELECT id, name, emoji, file FROM sounds WHERE server_id = ? ORDER BY created').all(serverId);
// um :nome: vale no servidor do canal; numa conversa direta, vale o de qualquer servidor
function findEmoji(name, key) {
  const sid = key && !String(key).startsWith('dm/') ? String(key).split('/')[0] : null;
  return sid
    ? db.prepare('SELECT * FROM emojis WHERE server_id = ? AND name = ?').get(sid, name)
    : db.prepare('SELECT * FROM emojis WHERE name = ? ORDER BY created LIMIT 1').get(name);
}

function routes(app, ctx) {
  const { auth } = require('./accounts');
  const upload = (max) => multer({ storage: multer.memoryStorage(), limits: { fileSize: max, files: 1 } });
  const manage = (req, res, next) => {
    if (!db.prepare('SELECT 1 FROM servers WHERE id = ?').get(req.params.sid)) return res.status(404).json({ error: 'Servidor não encontrado.' });
    if (!perms.canServer(req.user.id, req.params.sid, P.MANAGE_EXPRESSIONS)) return res.status(403).json({ error: 'Você não tem permissão para mexer nos emojis e sons deste servidor.' });
    next();
  };
  const serve = (dir, types) => (req, res) => {
    const file = path.basename(req.params.file);
    const type = types[file.split('.').pop()];
    if (!type) return res.status(404).end();
    res.setHeader('Content-Type', type);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
    res.sendFile(file, { root: dir }, (err) => { if (err && !res.headersSent) res.status(404).end(); });
  };
  app.get('/emojis/:file', auth, serve(EMOJI_DIR, IMG_TYPES));
  app.get('/sons/:file', auth, serve(SOUND_DIR, AUDIO_TYPES));

  // ---------- emojis ----------
  app.post('/api/servers/:sid/emojis', auth, manage, (req, res) => {
    upload(EMOJI_BYTES).single('file')(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'O emoji pode ter no máximo 512 KB.' : 'Não foi possível enviar o emoji.' });
      const name = String(req.body?.name || '').trim().toLowerCase().replace(/^:|:$/g, '');
      if (!NAME_RE.test(name)) return res.status(400).json({ error: 'Nome do emoji: de 2 a 32 letras minúsculas, números ou _ (sem acentos nem espaços).' });
      const kind = req.file && imageKind(req.file.buffer);
      if (!kind) return res.status(400).json({ error: 'Envie uma imagem PNG, JPG, WEBP ou GIF.' });
      if (db.prepare('SELECT COUNT(*) n FROM emojis WHERE server_id = ?').get(req.params.sid).n >= MAX_EMOJIS) return res.status(400).json({ error: `Cada servidor pode ter até ${MAX_EMOJIS} emojis.` });
      if (db.prepare('SELECT 1 FROM emojis WHERE server_id = ? AND name = ?').get(req.params.sid, name)) return res.status(400).json({ error: `Já existe um emoji :${name}: neste servidor.` });
      const id = crypto.randomUUID();
      const file = `${id}.${kind}`;
      fs.writeFile(path.join(EMOJI_DIR, file), req.file.buffer, (e) => {
        if (e) return res.status(500).json({ error: 'Não foi possível salvar o emoji.' });
        db.prepare('INSERT INTO emojis (id, server_id, name, file, user_id, created) VALUES (?, ?, ?, ?, ?, ?)').run(id, req.params.sid, name, file, req.user.id, now());
        ctx.rt.emitServers();
        res.json({ ok: true, id, name });
      });
    });
  });
  app.delete('/api/servers/:sid/emojis/:id', auth, manage, (req, res) => {
    const e = db.prepare('SELECT * FROM emojis WHERE id = ? AND server_id = ?').get(req.params.id, req.params.sid);
    if (!e) return res.status(404).json({ error: 'Emoji não encontrado.' });
    db.prepare('DELETE FROM emojis WHERE id = ?').run(e.id);
    fs.rm(path.join(EMOJI_DIR, path.basename(e.file)), { force: true }, () => {});
    ctx.rt.emitServers();
    res.json({ ok: true });
  });

  // ---------- sons ----------
  app.post('/api/servers/:sid/sounds', auth, manage, (req, res) => {
    upload(SOUND_BYTES).single('file')(req, res, (err) => {
      if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'O som pode ter no máximo 1 MB.' : 'Não foi possível enviar o som.' });
      const name = clean(req.body?.name, 32);
      if (!name) return res.status(400).json({ error: 'Dê um nome ao som.' });
      const emoji = clean(req.body?.emoji, 16) || null;
      const kind = req.file && audioKind(req.file.buffer);
      if (!kind) return res.status(400).json({ error: 'Envie um áudio MP3, OGG, WAV, WEBM ou M4A.' });
      if (db.prepare('SELECT COUNT(*) n FROM sounds WHERE server_id = ?').get(req.params.sid).n >= MAX_SOUNDS) return res.status(400).json({ error: `Cada servidor pode ter até ${MAX_SOUNDS} sons.` });
      const id = crypto.randomUUID();
      const file = `${id}.${kind}`;
      fs.writeFile(path.join(SOUND_DIR, file), req.file.buffer, (e) => {
        if (e) return res.status(500).json({ error: 'Não foi possível salvar o som.' });
        db.prepare('INSERT INTO sounds (id, server_id, name, emoji, file, user_id, created) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, req.params.sid, name, emoji, file, req.user.id, now());
        ctx.rt.emitServers();
        res.json({ ok: true, id });
      });
    });
  });
  app.delete('/api/servers/:sid/sounds/:id', auth, manage, (req, res) => {
    const s = db.prepare('SELECT * FROM sounds WHERE id = ? AND server_id = ?').get(req.params.id, req.params.sid);
    if (!s) return res.status(404).json({ error: 'Som não encontrado.' });
    db.prepare('DELETE FROM sounds WHERE id = ?').run(s.id);
    fs.rm(path.join(SOUND_DIR, path.basename(s.file)), { force: true }, () => {});
    ctx.rt.emitServers();
    res.json({ ok: true });
  });
}

// tocar um som para todos da sala de voz em que a pessoa está
function register(socket, ctx) {
  let lastPlay = 0;
  socket.on('sound-play', (id, cb) => {
    const uid = socket.data.user.id;
    const key = socket.data.voice;
    const s = db.prepare('SELECT * FROM sounds WHERE id = ?').get(String(id));
    if (!key || !s) return reply(cb, { error: 'Entre numa sala de voz para usar o soundboard.' });
    if (key.split('/')[0] !== s.server_id) return reply(cb, { error: 'Esse som é de outro servidor.' });
    if (!perms.can(uid, key, P.USE_SOUNDBOARD)) return reply(cb, { error: 'Você não tem permissão para usar o soundboard nesta sala.' });
    if (ctx.rt.voice[key]?.[socket.id]?.serverMuted) return reply(cb, { error: 'Você está silenciado nesta sala.' });
    const t = Date.now();
    if (t - lastPlay < 1500) return reply(cb, { error: 'Calma! Espere um instante entre um som e outro.' });
    lastPlay = t;
    for (const sid of Object.keys(ctx.rt.voice[key] || {})) {
      ctx.io.to(sid).emit('sound', { id: s.id, file: s.file, name: s.name, emoji: s.emoji, by: uid, key });
    }
    reply(cb, { ok: true });
  });
}

module.exports = { routes, register, emojisOf, soundsOf, findEmoji, audioKind, NAME_RE };
