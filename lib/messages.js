// Mensagens: histórico, envio, edição, respostas, reações, menções, não lidas e busca
const crypto = require('crypto');
const { db, removeFiles } = require('./db');
const { now, clean, reply, placeholders } = require('./util');
const { isDm, dmPair, canUseText, dmList, channelRow } = require('./channels');
const previews = require('./previews');
const perms = require('./perms');
const { P } = perms;

const PAGE = 50;
const MAX_TEXT = 4000;
const MAX_REACTIONS = 20;

// ---------- formato enviado ao navegador ----------
function attachmentsFor(ids) {
  if (!ids.length) return {};
  const by = {};
  for (const r of db.prepare(`SELECT id, message_id, name, mime, size FROM attachments WHERE message_id IN (${placeholders(ids)}) ORDER BY created`).all(...ids)) {
    (by[r.message_id] ||= []).push({ id: r.id, name: r.name, mime: r.mime, size: r.size });
  }
  return by;
}
function reactionsFor(ids) {
  if (!ids.length) return {};
  const by = {};
  for (const r of db.prepare(`SELECT message_id, emoji, user_id FROM reactions WHERE message_id IN (${placeholders(ids)}) ORDER BY created`).all(...ids)) {
    const list = (by[r.message_id] ||= []);
    let e = list.find((x) => x.e === r.emoji);
    if (!e) list.push(e = { e: r.emoji, users: [] });
    e.users.push(r.user_id);
  }
  return by;
}
function repliesFor(rows) {
  const ids = [...new Set(rows.map((r) => r.reply_to).filter(Boolean))];
  if (!ids.length) return {};
  const by = {};
  for (const r of db.prepare(`SELECT m.id, m.seq, m.user_id, m.text, (SELECT COUNT(*) FROM attachments a WHERE a.message_id = m.id) AS att FROM messages m WHERE m.id IN (${placeholders(ids)})`).all(...ids)) {
    by[r.id] = { id: r.id, seq: r.seq, uid: r.user_id, text: r.text.slice(0, 140), att: r.att > 0 };
  }
  return by;
}
function shape(rows) {
  const ids = rows.map((r) => r.id);
  const att = attachmentsFor(ids), reacts = reactionsFor(ids), replies = repliesFor(rows);
  return rows.map((r) => ({
    id: r.id, seq: r.seq, uid: r.user_id, text: r.text, ts: r.ts, edited: r.edited || null,
    att: att[r.id] || [], reactions: reacts[r.id] || [],
    reply: r.reply_to ? (replies[r.reply_to] || { id: r.reply_to, missing: true }) : null,
    embeds: previews.embedsFor(r.text),
    everyone: !isDm(r.chan) && ALL_RE.test(r.text) && perms.can(r.user_id, r.chan, P.MENTION_ALL), // @todos que valeu
  }));
}
const getMsg = (id) => db.prepare('SELECT * FROM messages WHERE id = ?').get(String(id));
const shapeOne = (id) => shape([getMsg(id)])[0];

// ---------- páginas do histórico ----------
function latest(key) {
  const rows = db.prepare('SELECT * FROM messages WHERE chan = ? ORDER BY seq DESC LIMIT ?').all(key, PAGE + 1);
  const more = rows.length > PAGE;
  return { messages: shape(rows.slice(0, PAGE).reverse()), more, atLatest: true };
}
function older(key, before) {
  const rows = db.prepare('SELECT * FROM messages WHERE chan = ? AND seq < ? ORDER BY seq DESC LIMIT ?').all(key, before, PAGE + 1);
  return { messages: shape(rows.slice(0, PAGE).reverse()), more: rows.length > PAGE };
}
function newer(key, after) {
  const rows = db.prepare('SELECT * FROM messages WHERE chan = ? AND seq > ? ORDER BY seq ASC LIMIT ?').all(key, after, PAGE + 1);
  return { messages: shape(rows.slice(0, PAGE)), atLatest: rows.length <= PAGE };
}
// mensagens em volta de uma (para pular até um resultado da busca ou uma resposta)
function around(key, seq) {
  const half = PAGE / 2;
  const before = db.prepare('SELECT * FROM messages WHERE chan = ? AND seq <= ? ORDER BY seq DESC LIMIT ?').all(key, seq, half + 1);
  const after = db.prepare('SELECT * FROM messages WHERE chan = ? AND seq > ? ORDER BY seq ASC LIMIT ?').all(key, seq, half + 1);
  return {
    messages: shape([...before.slice(0, half).reverse(), ...after.slice(0, half)]),
    more: before.length > half, atLatest: after.length <= half,
  };
}

// ---------- menções ----------
// "@usuario" no texto (e o autor da mensagem respondida) viram menções
// @todos (ou @everyone): todo mundo que vê o canal, se o autor tiver a permissão
const ALL_RE = /(^|[^\w@])@(todos|everyone)(?![\w.-])/i;
function mentionedIds(text, authorId, replyTo, key) {
  if (key && !isDm(key) && ALL_RE.test(String(text)) && perms.can(authorId, key, P.MENTION_ALL)) {
    return db.prepare('SELECT id FROM users WHERE disabled = 0 AND id <> ?').all(authorId).map((r) => r.id).filter((id) => canUseText(id, key));
  }
  const names = [...String(text).matchAll(/(^|[^\w@])@([a-zA-Z0-9_.-]{3,24})/g)].map((m) => m[2].toLowerCase());
  const ids = new Set();
  if (names.length) {
    for (const r of db.prepare(`SELECT id FROM users WHERE disabled = 0 AND LOWER(username) IN (${placeholders(names)})`).all(...names)) ids.add(r.id);
  }
  if (replyTo) { const r = getMsg(replyTo); if (r) ids.add(r.user_id); }
  ids.delete(authorId);
  return [...ids];
}
function saveMentions(messageId, ids) {
  db.prepare('DELETE FROM mentions WHERE message_id = ?').run(messageId);
  const ins = db.prepare('INSERT OR IGNORE INTO mentions (message_id, user_id) VALUES (?, ?)');
  for (const id of ids) ins.run(messageId, id);
}

// ---------- não lidas ----------
function lastRead(userId, key) {
  const r = db.prepare('SELECT seq FROM reads WHERE user_id = ? AND chan = ?').get(userId, key);
  if (r) return r.seq;
  // nunca abriu: conta como lido tudo o que veio antes de a conta existir
  const created = db.prepare('SELECT created FROM users WHERE id = ?').get(userId)?.created || 0;
  return db.prepare('SELECT MAX(seq) s FROM messages WHERE chan = ? AND ts <= ?').get(key, created)?.s || 0;
}
function unreadFor(userId) {
  const created = db.prepare('SELECT created FROM users WHERE id = ?').get(userId)?.created || 0;
  const rows = db.prepare(`
    SELECT m.chan AS chan, COUNT(*) AS n, SUM(CASE WHEN mm.user_id IS NULL THEN 0 ELSE 1 END) AS men
    FROM messages m
    LEFT JOIN reads r ON r.user_id = ? AND r.chan = m.chan
    LEFT JOIN mentions mm ON mm.message_id = m.id AND mm.user_id = ?
    WHERE m.user_id <> ? AND ((r.seq IS NOT NULL AND m.seq > r.seq) OR (r.seq IS NULL AND m.ts > ?))
    GROUP BY m.chan`).all(userId, userId, userId, created);
  const out = {};
  for (const r of rows) if (canUseText(userId, r.chan)) out[r.chan] = { n: Math.min(r.n, 999), m: r.men };
  return out;
}

// ---------- busca ----------
function search(userId, { q, scope } = {}) {
  let text = clean(q, 200);
  let fromId = null;
  text = text.replace(/(?:^|\s)de:@?([a-zA-Z0-9_.-]{3,24})/i, (_, u) => {
    fromId = db.prepare('SELECT id FROM users WHERE username = ?').get(u)?.id ?? -1; return ' ';
  });
  const terms = text.split(/\s+/).map((t) => t.replace(/["*^():]/g, '')).filter(Boolean).slice(0, 8);
  if (!terms.length && fromId == null) return [];
  const where = []; const args = [];
  if (scope === 'dm') { where.push("m.chan LIKE 'dm/%'"); }
  else { where.push('m.chan LIKE ?'); args.push(String(scope).replace(/[%_]/g, '') + '/%'); }
  if (fromId != null) { where.push('m.user_id = ?'); args.push(fromId); }
  const sql = terms.length
    ? `SELECT m.* FROM messages_fts f JOIN messages m ON m.seq = f.rowid WHERE messages_fts MATCH ? AND ${where.join(' AND ')} ORDER BY m.seq DESC LIMIT 300`
    : `SELECT m.* FROM messages m WHERE ${where.join(' AND ')} ORDER BY m.seq DESC LIMIT 300`;
  const params = terms.length ? [terms.map((t) => `"${t}"*`).join(' '), ...args] : args;
  let rows;
  try { rows = db.prepare(sql).all(...params); } catch { return []; }
  rows = rows.filter((r) => canUseText(userId, r.chan)).slice(0, 25);
  return shape(rows).map((m, i) => ({ key: rows[i].chan, msg: m }));
}

// ---------- reações ----------
const EMOJI_RE = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[#*0-9]️?⃣)/u;
const validEmoji = (e) => typeof e === 'string' && e.length > 0 && e.length <= 16 && EMOJI_RE.test(e) && !/[\s<>]/.test(e);

// ---------- eventos do socket ----------
function register(socket, ctx) {
  const { io, rt } = ctx;
  const me = () => socket.data.user;
  const room = (key) => io.to('t:' + key);

  // quem precisa saber que chegou mensagem (para contadores e notificações)
  function announce(key, row, mentions) {
    const payload = { key, seq: row.seq, uid: row.user_id, ts: row.ts, mentions, preview: row.text.slice(0, 160) };
    if (isDm(key)) { for (const uid of dmPair(key)) rt.toUser(uid).emit('activity', payload); return; }
    // canal de servidor: só quem pode ver o canal fica sabendo (canais privados)
    const seen = new Map();
    for (const s of io.sockets.sockets.values()) {
      const uid = s.data.user?.id; if (!uid) continue;
      if (!seen.has(uid)) seen.set(uid, canUseText(uid, key));
      if (seen.get(uid)) s.emit('activity', payload);
    }
  }
  function refreshPreviews(m) {
    previews.ensure(m.text, () => {
      if (getMsg(m.id)) room(m.chan).emit('message-update', { key: m.chan, msg: shapeOne(m.id) });
    }).catch(() => {});
  }

  socket.on('join-text', (key, cb) => {
    if (!canUseText(me().id, key)) return reply(cb, { error: 'Você não tem acesso a esse canal.', messages: [], more: false, atLatest: true });
    if (socket.data.text) socket.leave('t:' + socket.data.text);
    socket.data.text = key;
    socket.join('t:' + key);
    reply(cb, { ...latest(key), lastRead: lastRead(me().id, key) });
  });

  socket.on('history', ({ key, before } = {}, cb) => {
    if (!canUseText(me().id, key) || !Number.isInteger(before)) return reply(cb, { messages: [], more: false });
    reply(cb, older(key, before));
  });
  socket.on('history-newer', ({ key, after } = {}, cb) => {
    if (!canUseText(me().id, key) || !Number.isInteger(after)) return reply(cb, { messages: [], atLatest: true });
    reply(cb, newer(key, after));
  });
  socket.on('jump', ({ key, seq } = {}, cb) => {
    if (!canUseText(me().id, key) || !Number.isInteger(seq)) return reply(cb, { error: 'Mensagem não encontrada.' });
    if (socket.data.text !== key) { if (socket.data.text) socket.leave('t:' + socket.data.text); socket.data.text = key; socket.join('t:' + key); }
    reply(cb, { ...around(key, seq), lastRead: lastRead(me().id, key) });
  });

  socket.on('read', ({ key, seq } = {}, cb) => {
    if (!Number.isInteger(seq) || !canUseText(me().id, key)) return reply(cb, { ok: false });
    db.prepare('INSERT INTO reads (user_id, chan, seq) VALUES (?, ?, ?) ON CONFLICT(user_id, chan) DO UPDATE SET seq = MAX(seq, excluded.seq)').run(me().id, key, seq);
    rt.toUser(me().id).emit('read', { key, seq }); // as outras abas também zeram o contador
    reply(cb, { ok: true });
  });

  socket.on('message', ({ key, text, att, replyTo } = {}, cb) => {
    if (!canUseText(me().id, key)) return reply(cb, { error: 'Você não tem acesso a esse canal.' });
    if (!isDm(key) && !perms.can(me().id, key, P.SEND)) return reply(cb, { error: 'Você não tem permissão para enviar mensagens neste canal.' });
    const body = clean(text, MAX_TEXT);
    if (Array.isArray(att) && att.length && !isDm(key) && !perms.can(me().id, key, P.ATTACH)) return reply(cb, { error: 'Você não tem permissão para anexar arquivos neste canal.' });
    const ids = Array.isArray(att) ? att.filter((x) => typeof x === 'string').slice(0, ctx.MAX_FILES) : [];
    const mine = ids.length // só anexos do próprio usuário e ainda não usados
      ? db.prepare(`SELECT id FROM attachments WHERE user_id = ? AND message_id IS NULL AND id IN (${placeholders(ids)})`).all(me().id, ...ids).map((r) => r.id)
      : [];
    if (!body && !mine.length) return reply(cb, { error: 'Mensagem vazia.' });
    const target = replyTo ? getMsg(replyTo) : null;
    const replyId = target && target.chan === key ? target.id : null;
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO messages (id, chan, user_id, text, ts, reply_to) VALUES (?, ?, ?, ?, ?, ?)').run(id, key, me().id, body, now(), replyId);
    if (mine.length) db.prepare(`UPDATE attachments SET message_id = ? WHERE id IN (${placeholders(mine)})`).run(id, ...mine);
    const mentions = mentionedIds(body, me().id, replyId, key);
    saveMentions(id, mentions);
    const row = getMsg(id);
    // quem escreve já leu até aqui
    db.prepare('INSERT INTO reads (user_id, chan, seq) VALUES (?, ?, ?) ON CONFLICT(user_id, chan) DO UPDATE SET seq = MAX(seq, excluded.seq)').run(me().id, key, row.seq);
    room(key).emit('message', { key, msg: shapeOne(id) });
    announce(key, { ...row, text: body || (mine.length ? '📎 anexo' : '') }, mentions);
    refreshPreviews(row);
    reply(cb, { ok: true, id });
  });

  socket.on('message-edit', ({ id, text } = {}, cb) => {
    const m = getMsg(id);
    if (!m || m.user_id !== me().id || !canUseText(me().id, m.chan)) return reply(cb, { error: 'Você só pode editar as suas mensagens.' });
    const body = clean(text, MAX_TEXT);
    const hasAtt = db.prepare('SELECT 1 FROM attachments WHERE message_id = ? LIMIT 1').get(m.id);
    if (!body && !hasAtt) return reply(cb, { error: 'A mensagem não pode ficar vazia.' });
    db.prepare('UPDATE messages SET text = ?, edited = ? WHERE id = ?').run(body, now(), m.id);
    saveMentions(m.id, mentionedIds(body, me().id, m.reply_to, m.chan));
    room(m.chan).emit('message-update', { key: m.chan, msg: shapeOne(m.id) });
    refreshPreviews({ ...m, text: body });
    reply(cb, { ok: true });
  });

  socket.on('message-delete', (id, cb) => {
    const m = getMsg(id);
    if (!m || !canUseText(me().id, m.chan) || (m.user_id !== me().id && !(!isDm(m.chan) && perms.can(me().id, m.chan, P.MANAGE_MESSAGES)))) return reply(cb, { error: 'Você não pode apagar essa mensagem.' });
    removeFiles(db.prepare('SELECT file FROM attachments WHERE message_id = ?').all(m.id));
    db.prepare('DELETE FROM messages WHERE id = ?').run(m.id);
    room(m.chan).emit('message-delete', { key: m.chan, id: m.id });
    reply(cb, { ok: true });
  });

  socket.on('react', ({ id, emoji } = {}, cb) => {
    const m = getMsg(id);
    if (!m || !canUseText(me().id, m.chan)) return reply(cb, { error: 'Mensagem não encontrada.' });
    if (!validEmoji(emoji)) return reply(cb, { error: 'Reação inválida.' });
    const has = db.prepare('SELECT 1 FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').get(m.id, me().id, emoji);
    if (has) db.prepare('DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').run(m.id, me().id, emoji);
    else {
      const distinct = db.prepare('SELECT COUNT(DISTINCT emoji) n FROM reactions WHERE message_id = ?').get(m.id).n;
      const exists = db.prepare('SELECT 1 FROM reactions WHERE message_id = ? AND emoji = ?').get(m.id, emoji);
      // sem "Reagir" ainda dá para entrar numa reação que já existe (como no Discord)
      if (!exists && !isDm(m.chan) && !perms.can(me().id, m.chan, P.REACT)) return reply(cb, { error: 'Você não tem permissão para reagir neste canal.' });
      if (!exists && distinct >= MAX_REACTIONS) return reply(cb, { error: `Uma mensagem pode ter no máximo ${MAX_REACTIONS} reações diferentes.` });
      db.prepare('INSERT INTO reactions (message_id, user_id, emoji, created) VALUES (?, ?, ?, ?)').run(m.id, me().id, emoji, now());
    }
    room(m.chan).emit('message-update', { key: m.chan, msg: shapeOne(m.id) });
    reply(cb, { ok: true });
  });

  socket.on('typing', (key) => {
    if (socket.data.text === key) socket.to('t:' + key).emit('typing', { key, uid: me().id });
  });

  socket.on('search', (params = {}, cb) => reply(cb, { results: search(me().id, params) }));
  socket.on('dm-list', (_, cb) => reply(cb, dmList(me().id)));
}

module.exports = { register, unreadFor, lastRead, shape, search, mentionedIds, validEmoji, latest, around, PAGE, channelRow };
