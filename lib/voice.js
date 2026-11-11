// Salas de voz: entrar, sair, estado (mudo, tela, câmera) e sinalização WebRTC
const { reply, clean } = require('./util');
const { channelRow } = require('./channels');

function register(socket, ctx) {
  const { io, rt } = ctx;
  const me = () => socket.data.user;

  socket.on('voice-join', (key, cb) => {
    const ch = channelRow(key);
    if (!ch || ch.type !== 'voice') return reply(cb, { error: 'Sala não encontrada.' });
    rt.leaveVoice(socket);
    rt.voice[key] ||= {};
    const peers = Object.keys(rt.voice[key]);
    rt.voice[key][socket.id] = { uid: me().id, name: rt.nameIn(me().id, ch.server_id), muted: false, sharing: false, camera: false, camId: null, screenId: null };
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
    if ('muted' in patch) m.muted = !!patch.muted;
    if ('sharing' in patch) m.sharing = !!patch.sharing;
    if ('camera' in patch) m.camera = !!patch.camera;
    if ('camId' in patch) m.camId = patch.camId ? clean(patch.camId, 80) : null;
    if ('screenId' in patch) m.screenId = patch.screenId ? clean(patch.screenId, 80) : null;
    rt.emitVoice();
  });

  socket.on('signal', ({ to, data } = {}) => {
    const key = socket.data.voice;
    if (!key || !rt.voice[key]?.[to]) return; // só entre membros da mesma sala
    io.to(to).emit('signal', { from: socket.id, data });
  });
}

module.exports = { register };
