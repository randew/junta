// Servidores e canais (criar e apagar: só o dono) e perfil de cada conta
const crypto = require('crypto');
const { db, removeFiles } = require('./db');
const { clean, slug, reply } = require('./util');
const { serverList, channelRow } = require('./channels');

function register(socket, ctx) {
  const { io, rt } = ctx;
  const me = () => socket.data.user;
  const isOwner = () => me().role === 'owner';

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
    db.prepare('DELETE FROM reads WHERE chan = ?').run(key);
    db.prepare('DELETE FROM channels WHERE server_id = ? AND id = ?').run(ch.server_id, ch.id);
    // quem estava na sala de voz apagada é desconectado dela
    for (const sid of Object.keys(rt.voice[key] || {})) { const s = io.sockets.sockets.get(sid); if (s) { rt.leaveVoice(s); s.emit('voice-kicked'); } }
    delete rt.voice[key];
    io.emit('servers', serverList());
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
