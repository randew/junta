// Estado ao vivo: quem está conectado, status e quem está em cada sala de voz
const { db } = require('./db');
const { allUsers } = require('./accounts');
const { serverList, canUseText } = require('./channels');
const perms = require('./perms');

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
  const presencePayload = () => ({ users: allUsers(), nicks: allNicks(), ...perms.rolesPayload(), online: Object.entries(online).map(([sid, o]) => ({ sid, ...o })) });

  let presenceTimer = null;
  function broadcastPresence() { // agrupa rajadas de mudanças num só envio
    clearTimeout(presenceTimer);
    presenceTimer = setTimeout(() => io.emit('presence', presencePayload()), 150);
  }

  function voiceSnapshot() {
    const out = {};
    for (const [key, members] of Object.entries(voice)) {
      // "speak" e "stream" vêm das permissões de agora: quem ouve e assiste respeita isso
      const list = Object.entries(members).map(([id, m]) => ({
        id, ...m, speak: perms.can(m.uid, key, perms.P.SPEAK), stream: perms.can(m.uid, key, perms.P.STREAM),
      }));
      if (list.length) out[key] = list;
    }
    return out;
  }
  // só as salas que a pessoa pode ver (salas privadas não aparecem para os outros)
  function voiceFor(uid, snap = voiceSnapshot()) {
    const out = {};
    for (const [key, list] of Object.entries(snap)) if (perms.can(uid, key, perms.P.VIEW)) out[key] = list;
    return out;
  }
  function emitVoice() {
    const snap = voiceSnapshot(); const cache = new Map();
    for (const s of io.sockets.sockets.values()) {
      const uid = s.data.user?.id; if (!uid) continue;
      if (!cache.has(uid)) cache.set(uid, voiceFor(uid, snap));
      s.emit('voice-state', cache.get(uid));
    }
  }

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

  // cada pessoa recebe a lista de servidores com os canais que ela pode ver
  function emitServers() {
    for (const s of io.sockets.sockets.values()) if (s.data.user) s.emit('servers', serverList(s.data.user.id));
  }
  // depois de mudar cargos ou permissões: quem perdeu acesso sai do canal ou da sala na hora
  function recheckAccess() {
    for (const s of io.sockets.sockets.values()) {
      const uid = s.data.user?.id; if (!uid) continue;
      if (s.data.text && !canUseText(uid, s.data.text)) { s.leave('t:' + s.data.text); s.data.text = null; s.emit('access-lost'); }
      if (s.data.voice && !perms.can(uid, s.data.voice, perms.P.CONNECT)) { leaveVoice(s); s.emit('voice-kicked'); }
    }
  }
  // tudo que depende de cargos, de uma vez
  function permsChanged() { emitServers(); broadcastPresence(); recheckAccess(); emitVoice(); }

  return {
    emitServers, recheckAccess, permsChanged,
    online, voice, STATUSES, nameIn, presencePayload, broadcastPresence, voiceSnapshot, voiceFor, emitVoice,
    leaveVoice, refreshVoiceNames, disconnectWhere, setDisplayEverywhere,
    toUser: (uid) => io.to('u:' + uid), // todas as abas abertas de uma conta
  };
}

module.exports = { createRealtime };
