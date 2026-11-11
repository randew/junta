// Arquivos: anexos das mensagens e fotos de perfil
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { db, FILES_DIR, AVATAR_DIR, removeFiles } = require('./db');
const { now, clean } = require('./util');
const { auth } = require('./accounts');
const { canUseText } = require('./channels');

// Tipos exibidos dentro da página; o resto sempre vira download (nunca HTML/SVG executável)
const INLINE = /^(image\/(png|jpe?g|gif|webp|avif)|video\/(mp4|webm|ogg)|audio\/(mpeg|ogg|wav|webm|mp4|aac|flac|x-m4a)|application\/pdf)$/;
const AVATAR_TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

function imageKind(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') return 'png';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  if (buf.length > 6 && buf.toString('latin1', 0, 4) === 'GIF8') return 'gif';
  return null;
}

function routes(app, ctx) {
  // ---------- foto de perfil ----------
  // O navegador já recorta e reduz a foto para 256×256; aqui só conferimos que é mesmo uma imagem.
  const avatarUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } });
  function setAvatar(userId, file) {
    const old = db.prepare('SELECT avatar FROM users WHERE id = ?').get(userId)?.avatar;
    db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(file, userId);
    if (old) fs.rm(path.join(AVATAR_DIR, path.basename(old)), { force: true }, () => {});
    ctx.rt.broadcastPresence();
  }
  ctx.setAvatar = setAvatar;

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
    storage: multer.diskStorage({ destination: FILES_DIR, filename: (req, file, cb) => cb(null, crypto.randomUUID()) }),
    limits: { fileSize: ctx.MAX_FILE_MB * 1024 * 1024, files: ctx.MAX_FILES },
  });
  app.post('/api/upload', auth, (req, res) => {
    upload.array('files', ctx.MAX_FILES)(req, res, (err) => {
      if (err) {
        const msg = err.code === 'LIMIT_FILE_SIZE' ? `Cada arquivo pode ter no máximo ${ctx.MAX_FILE_MB} MB.`
          : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE' ? `Envie no máximo ${ctx.MAX_FILES} arquivos por mensagem.`
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

  app.get('/anexos/:id/:name?', auth, (req, res) => {
    const a = db.prepare('SELECT a.*, m.chan FROM attachments a LEFT JOIN messages m ON m.id = a.message_id WHERE a.id = ?').get(req.params.id);
    // anexo de mensagem: precisa ter acesso ao canal (ou à conversa direta); ainda sem mensagem: só quem enviou
    const allowed = a && (a.message_id ? canUseText(req.user.id, a.chan) : a.user_id === req.user.id);
    if (!allowed) return res.status(404).send('Arquivo não encontrado.');
    const inline = INLINE.test(a.mime) && req.query.download === undefined;
    res.setHeader('Content-Type', inline ? a.mime : 'application/octet-stream');
    res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(a.name)}`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (a.mime !== 'application/pdf') res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; sandbox");
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.sendFile(a.file, { root: FILES_DIR }, (err) => { if (err && !res.headersSent) res.status(404).end(); });
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
}

module.exports = { routes, imageKind };
