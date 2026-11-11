// Estado ao vivo: quem está conectado, status e quem está em cada sala de voz
const { db } = require('./db');
const { allUsers } = require('./accounts');

const STATUSES = ['online', 'idle', 'dnd'];

function createRealtime(io) {
  const online = {}; // socketId -> { uid, status }
  const voice = {};  // "serverId/channelId" -> { socketId: { uid, name, muted, sharing, camera, camId, screenId } }

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
  const emitVoice = () => io.emit('voice-state', voiceSnapshot());

  function leaveVoice(socket) {
    const key = socket.data.voice;
    if (!key) return;
    if (voice[key]) delete voice[key][socket.id];
    socket.leave('v:' + key);
    socket.to('v:' + key).emit('peer-left', socket.id);
    socket.data.voice = null;
    emitVoice();
  }

  // atualiza o nome mostrado nas salas de voz depois de trocar nome ou apelido
  function refreshVoiceNames(userId) {
    let changed = false;
    for (const [key, room] of Object.entries(voice)) for (const m of Object.values(room)) {
      if (m.uid === userId) { m.name = nameIn(userId, key.split('/')[0]); changed = true; }
    }
    if (changed) emitVoice();
  }

  // derruba as conexões que satisfazem a condição (logout, troca de senha, conta removida)
  function disconnectWhere(pred) {
    for (const s of io.sockets.sockets.values()) if (s.data.user && pred(s.data.user)) { leaveVoice(s); s.emit('session-ended'); s.disconnect(true); }
  }
  // atualiza o nome guardado nas conexões abertas de uma conta
  function setDisplayEverywhere(userId, display) {
    for (const s of io.sockets.sockets.values()) if (s.data.user?.id === userId) s.data.user.display = display;
  }

  return {
    online, voice, STATUSES, nameIn, presencePayload, broadcastPresence, voiceSnapshot, emitVoice,
    leaveVoice, refreshVoiceNames, disconnectWhere, setDisplayEverywhere,
    toUser: (uid) => io.to('u:' + uid), // todas as abas abertas de uma conta
  };
}

module.exports = { createRealtime };
