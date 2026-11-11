// Servidores e canais (conforme os cargos; criar, reordenar e excluir servidores: só o dono do Junta) e perfil de cada conta
const crypto = require('crypto');
const { db, removeFiles } = require('./db');
const { clean, slug, reply } = require('./util');
const { channelRow } = require('./channels');
const perms = require('./perms');
const { P } = perms;

function register(socket, ctx) {
  const { io, rt } = ctx;
  const me = () => socket.data.user;
  const isOwner = () => me().role === 'owner';
  const may = (serverId, bit) => perms.canServer(me().id, String(serverId), bit);
  const NO = (what) => ({ error: `Você não tem permissão para ${what}.` });

  // ---------- servidores e canais ----------
  socket.on('create-server', (name, cb) => {
    if (!isOwner()) return reply(cb, { error: 'Só o dono pode criar servidores.' });
    const n = clean(name, 40);
    if (!n) return reply(cb, { error: 'Dê um nome ao servidor.' });
    let id = slug(n);
    while (id === 'dm' || db.prepare('SELECT 1 FROM servers WHERE id = ?').get(id)) id += '-' + crypto.randomBytes(2).toString('hex'); // "dm" é reservado às conversas diretas
    const pos = (db.prepare('SELECT MAX(pos) m FROM servers').get().m ?? -1) + 1;
    db.prepare('INSERT INTO servers (id, name, pos) VALUES (?, ?, ?)').run(id, n, pos);
    db.prepare('INSERT INTO channels (server_id, id, name, type, pos) VALUES (?, ?, ?, ?, ?)').run(id, 'geral', 'geral', 'text', 0);
    db.prepare('INSERT INTO channels (server_id, id, name, type, pos) VALUES (?, ?, ?, ?, ?)').run(id, 'voz', 'Voz', 'voice', 1);
    perms.ensureDefaultRole(id);
    rt.emitServers(); rt.broadcastPresence();
    reply(cb, { ok: true, id });
  });

  socket.on('create-channel', ({ serverId, name, type } = {}, cb) => {
    if (!may(serverId, P.MANAGE_CHANNELS)) return reply(cb, NO('criar canais'));
    const n = clean(name, 40);
    if (!n || !db.prepare('SELECT 1 FROM servers WHERE id = ?').get(String(serverId))) return reply(cb, { error: 'Dê um nome ao canal.' });
    const t = type === 'voice' ? 'voice' : 'text';
    let id = slug(n);
    while (db.prepare('SELECT 1 FROM channels WHERE server_id = ? AND id = ?').get(serverId, id)) id += '-' + crypto.randomBytes(2).toString('hex');
    const pos = (db.prepare('SELECT MAX(pos) m FROM channels WHERE server_id = ?').get(serverId).m ?? -1) + 1;
    db.prepare('INSERT INTO channels (server_id, id, name, type, pos) VALUES (?, ?, ?, ?, ?)').run(serverId, id, t === 'text' ? slug(n) : n, t, pos);
    rt.emitServers();
    reply(cb, { ok: true, id });
  });

  // ---------- gerenciar servidores (dono) ----------
  const serverRow = (id) => db.prepare('SELECT * FROM servers WHERE id = ?').get(String(id));
  const changed = () => rt.emitServers();
  // tira da sala de voz quem estava num canal que deixou de existir
  function kickVoice(key) {
    for (const sid of Object.keys(rt.voice[key] || {})) { const s = io.sockets.sockets.get(sid); if (s) { rt.leaveVoice(s); s.emit('voice-kicked'); } }
    delete rt.voice[key];
  }

  socket.on('server-update', ({ id, name } = {}, cb) => {
    if (!may(id, P.MANAGE_SERVER)) return reply(cb, NO('mudar este servidor'));
    const s = serverRow(id); const n = clean(name, 40);
    if (!s) return reply(cb, { error: 'Servidor não encontrado.' });
    if (!n) return reply(cb, { error: 'O nome não pode ficar vazio.' });
    db.prepare('UPDATE servers SET name = ? WHERE id = ?').run(n, s.id);
    changed(); reply(cb, { ok: true });
  });

  // sobe (-1) ou desce (+1) uma posição na barra
  socket.on('server-move', ({ id, dir } = {}, cb) => {
    if (!isOwner()) return reply(cb, { error: 'Só o dono pode reordenar servidores.' });
    const list = db.prepare('SELECT id FROM servers ORDER BY pos, rowid').all().map((r) => r.id);
    const i = list.indexOf(String(id)), j = i + (dir > 0 ? 1 : -1);
    if (i < 0 || j < 0 || j >= list.length) return reply(cb, { ok: true });
    [list[i], list[j]] = [list[j], list[i]];
    const upd = db.prepare('UPDATE servers SET pos = ? WHERE id = ?');
    list.forEach((sid, k) => upd.run(k, sid));
    changed(); reply(cb, { ok: true });
  });

  // excluir: é preciso confirmar digitando o nome; apaga canais, mensagens e anexos
  socket.on('server-delete', ({ id, confirm } = {}, cb) => {
    if (!isOwner()) return reply(cb, { error: 'Só o dono pode excluir servidores.' });
    const s = serverRow(id);
    if (!s) return reply(cb, { error: 'Servidor não encontrado.' });
    if (clean(confirm, 60).toLowerCase() !== s.name.trim().toLowerCase()) return reply(cb, { error: 'Digite o nome do servidor exatamente como ele aparece para confirmar.' });
    if (db.prepare('SELECT COUNT(*) n FROM servers').get().n <= 1) return reply(cb, { error: 'O Junta precisa de pelo menos um servidor.' });
    const like = s.id.replace(/[%_]/g, '') + '/%';
    removeFiles(db.prepare('SELECT a.file FROM attachments a JOIN messages m ON m.id = a.message_id WHERE m.chan LIKE ?').all(like));
    db.prepare('DELETE FROM messages WHERE chan LIKE ?').run(like);
    db.prepare('DELETE FROM reads WHERE chan LIKE ?').run(like);
    for (const c of db.prepare('SELECT id FROM channels WHERE server_id = ?').all(s.id)) kickVoice(`${s.id}/${c.id}`);
    db.prepare('DELETE FROM channel_overrides WHERE server_id = ?').run(s.id);
    db.prepare('DELETE FROM servers WHERE id = ?').run(s.id); // canais, apelidos e cargos vão junto
    ctx.removeIcon?.(s.icon);
    changed(); rt.emitVoice(); rt.broadcastPresence();
    reply(cb, { ok: true });
  });

  // nova ordem completa (arrastar e soltar): precisa conter exatamente os mesmos itens
  const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x)) && new Set(a).size === a.length;
  socket.on('server-reorder', ({ order } = {}, cb) => {
    if (!isOwner()) return reply(cb, { error: 'Só o dono pode reordenar servidores.' });
    const ids = db.prepare('SELECT id FROM servers').all().map((r) => r.id);
    if (!Array.isArray(order) || !sameSet(order.map(String), ids)) return reply(cb, { error: 'A lista de servidores mudou. Tente de novo.' });
    const upd = db.prepare('UPDATE servers SET pos = ? WHERE id = ?');
    order.forEach((sid, k) => upd.run(k, String(sid)));
    changed(); reply(cb, { ok: true });
  });
  socket.on('channel-reorder', ({ serverId, type, order } = {}, cb) => {
    if (!may(serverId, P.MANAGE_CHANNELS)) return reply(cb, NO('reordenar canais'));
    const all = db.prepare('SELECT id, type FROM channels WHERE server_id = ? ORDER BY pos, rowid').all(String(serverId));
    const same = all.filter((c) => c.type === type).map((c) => c.id);
    if (!all.length || !Array.isArray(order) || !sameSet(order.map(String), same)) return reply(cb, { error: 'A lista de canais mudou. Tente de novo.' });
    const others = all.filter((c) => c.type !== type).map((c) => c.id);
    const full = type === 'text' ? [...order, ...others] : [...others, ...order];
    const upd = db.prepare('UPDATE channels SET pos = ? WHERE server_id = ? AND id = ?');
    full.forEach((cid, k) => upd.run(k, String(serverId), String(cid)));
    changed(); reply(cb, { ok: true });
  });

  socket.on('channel-update', ({ key, name } = {}, cb) => {
    const ch = channelRow(key); const n = clean(name, 40);
    if (!ch) return reply(cb, { error: 'Canal não encontrado.' });
    if (!may(ch.server_id, P.MANAGE_CHANNELS)) return reply(cb, NO('renomear canais'));
    if (!n) return reply(cb, { error: 'O nome não pode ficar vazio.' });
    // o endereço interno do canal não muda, então mensagens e não lidas continuam valendo
    db.prepare('UPDATE channels SET name = ? WHERE server_id = ? AND id = ?').run(ch.type === 'text' ? slug(n) : n, ch.server_id, ch.id);
    changed(); reply(cb, { ok: true });
  });

  // sobe/desce entre os canais do mesmo tipo
  socket.on('channel-move', ({ key, dir } = {}, cb) => {
    const ch = channelRow(key);
    if (!ch) return reply(cb, { error: 'Canal não encontrado.' });
    if (!may(ch.server_id, P.MANAGE_CHANNELS)) return reply(cb, NO('reordenar canais'));
    const all = db.prepare('SELECT id, type FROM channels WHERE server_id = ? ORDER BY pos, rowid').all(ch.server_id);
    const same = all.filter((c) => c.type === ch.type).map((c) => c.id);
    const i = same.indexOf(ch.id), j = i + (dir > 0 ? 1 : -1);
    if (j < 0 || j >= same.length) return reply(cb, { ok: true });
    [same[i], same[j]] = [same[j], same[i]];
    const others = all.filter((c) => c.type !== ch.type).map((c) => c.id);
    const order = ch.type === 'text' ? [...same, ...others] : [...others, ...same];
    const upd = db.prepare('UPDATE channels SET pos = ? WHERE server_id = ? AND id = ?');
    order.forEach((cid, k) => upd.run(k, ch.server_id, cid));
    changed(); reply(cb, { ok: true });
  });

  socket.on('delete-channel', (key, cb) => {
    const ch = channelRow(key);
    if (!ch) return reply(cb, { error: 'Canal não encontrado.' });
    if (!may(ch.server_id, P.MANAGE_CHANNELS)) return reply(cb, NO('apagar canais'));
    const left = db.prepare('SELECT COUNT(*) n FROM channels WHERE server_id = ? AND type = ?').get(ch.server_id, 'text').n;
    if (ch.type === 'text' && left <= 1) return reply(cb, { error: 'Cada servidor precisa de pelo menos um canal de texto.' });
    removeFiles(db.prepare('SELECT a.file FROM attachments a JOIN messages m ON m.id = a.message_id WHERE m.chan = ?').all(key));
    db.prepare('DELETE FROM messages WHERE chan = ?').run(key);
    db.prepare('DELETE FROM reads WHERE chan = ?').run(key);
    db.prepare('DELETE FROM channels WHERE server_id = ? AND id = ?').run(ch.server_id, ch.id);
    db.prepare('DELETE FROM channel_overrides WHERE server_id = ? AND channel_id = ?').run(ch.server_id, ch.id);
    // quem estava na sala de voz apagada é desconectado dela
    for (const sid of Object.keys(rt.voice[key] || {})) { const s = io.sockets.sockets.get(sid); if (s) { rt.leaveVoice(s); s.emit('voice-kicked'); } }
    delete rt.voice[key];
    rt.emitServers();
    rt.emitVoice();
    reply(cb, { ok: true });
  });

  // ---------- perfil ----------
  socket.on('profile-update', (p = {}, cb) => {
    const display = clean(p.display, 32);
    if (!display) return reply(cb, { error: 'O nome de exibição não pode ficar vazio.' });
    const color = /^#[0-9a-f]{6}$/i.test(p.color || '') ? p.color.toLowerCase() : null;
    db.prepare('UPDATE users SET display = ?, pronouns = ?, status_text = ?, bio = ?, color = ? WHERE id = ?')
      .run(display, clean(p.pronouns, 40), clean(p.statusText, 60), clean(p.bio, 190), color, me().id);
    rt.setDisplayEverywhere(me().id, display);
    rt.refreshVoiceNames(me().id);
    rt.broadcastPresence();
    reply(cb, { ok: true });
  });

  socket.on('set-nick', ({ serverId, nick } = {}, cb) => {
    if (!db.prepare('SELECT 1 FROM servers WHERE id = ?').get(String(serverId))) return reply(cb, { error: 'Servidor não encontrado.' });
    const n = clean(nick, 32);
    if (n) db.prepare('INSERT INTO nicknames (server_id, user_id, nick) VALUES (?, ?, ?) ON CONFLICT(server_id, user_id) DO UPDATE SET nick = excluded.nick').run(serverId, me().id, n);
    else db.prepare('DELETE FROM nicknames WHERE server_id = ? AND user_id = ?').run(serverId, me().id);
    rt.refreshVoiceNames(me().id);
    rt.broadcastPresence();
    reply(cb, { ok: true });
  });
}

module.exports = { register };
