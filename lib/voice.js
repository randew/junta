// Salas de voz: entrar, sair, estado (mudo, tela, câmera) e sinalização WebRTC
const { reply, clean } = require('./util');
const { channelRow } = require('./channels');
const perms = require('./perms');
const { P } = perms;

function register(socket, ctx) {
  const { io, rt } = ctx;
  const me = () => socket.data.user;

  socket.on('voice-join', (key, cb) => {
    const ch = channelRow(key);
    if (!ch || ch.type !== 'voice' || !perms.can(me().id, key, P.VIEW)) return reply(cb, { error: 'Sala não encontrada.' });
    if (!perms.can(me().id, key, P.CONNECT)) return reply(cb, { error: 'Você não tem permissão para entrar nesta sala.' });
    rt.leaveVoice(socket);
    rt.voice[key] ||= {};
    const peers = Object.keys(rt.voice[key]);
    rt.voice[key][socket.id] = { uid: me().id, name: rt.nameIn(me().id, ch.server_id), muted: false, serverMuted: false, sharing: false, camera: false, camId: null, screenId: null };
    socket.data.voice = key;
    socket.join('v:' + key);
    reply(cb, peers);
    rt.emitVoice();
  });

  socket.on('voice-leave', () => rt.leaveVoice(socket));

  // camId / screenId: identificam qual vídeo recebido é a câmera e qual é a tela
  socket.on('voice-update', (patch = {}) => {
    const key = socket.data.voice;
    const m = key && rt.voice[key]?.[socket.id];
    if (!m) return;
    const streamOk = perms.can(me().id, key, P.STREAM);
    if ('muted' in patch) m.muted = !!patch.muted;
    if ('sharing' in patch) m.sharing = !!patch.sharing && streamOk;
    if ('camera' in patch) m.camera = !!patch.camera && streamOk;
    if ('camId' in patch) m.camId = patch.camId ? clean(patch.camId, 80) : null;
    if ('screenId' in patch) m.screenId = patch.screenId ? clean(patch.screenId, 80) : null;
    rt.emitVoice();
  });

  // moderação: silenciar para todos ou desconectar alguém (só quem está abaixo na hierarquia)
  function target(sid, bit, what, cb) {
    const key = Object.keys(rt.voice).find((k) => rt.voice[k][sid]);
    const m = key && rt.voice[key][sid];
    if (!m) { reply(cb, { error: 'Essa pessoa não está mais na sala.' }); return null; }
    const serverId = key.split('/')[0];
    if (!perms.can(me().id, key, bit) || !perms.outranks(me().id, m.uid, serverId)) { reply(cb, { error: `Você não tem permissão para ${what} essa pessoa.` }); return null; }
    return { key, m };
  }
  socket.on('voice-moderate', ({ sid, mute } = {}, cb) => {
    const t = target(String(sid), P.MUTE_MEMBERS, 'silenciar', cb); if (!t) return;
    t.m.serverMuted = !!mute;
    rt.emitVoice(); reply(cb, { ok: true });
  });
  socket.on('voice-disconnect', ({ sid } = {}, cb) => {
    const t = target(String(sid), P.MOVE_MEMBERS, 'desconectar', cb); if (!t) return;
    const s = io.sockets.sockets.get(String(sid));
    if (s) { rt.leaveVoice(s); s.emit('voice-kicked', { by: me().id }); }
    reply(cb, { ok: true });
  });

  socket.on('signal', ({ to, data } = {}) => {
    const key = socket.data.voice;
    if (!key || !rt.voice[key]?.[to]) return; // só entre membros da mesma sala
    io.to(to).emit('signal', { from: socket.id, data });
  });
}

module.exports = { register };
