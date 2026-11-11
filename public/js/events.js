// Junta — eventos do servidor, login, convite e início
'use strict';

// ---------- eventos do servidor ----------
socket.on('servers', (servers) => {
  S.servers = servers; renderRail();
  if (S.home) return;
  if (!currentServer()) { selectServer(S.servers[0].id); return; }
  if (!currentChannel()) { toast('O canal que você estava foi apagado.'); selectServer(S.serverId); return; }
  renderChannels();
});
socket.on('voice-kicked', () => { if (S.voiceKey) leaveVoice(); });

socket.on('voice-state', (v) => {
  roomEvents(v);
  S.voice = v;
  renderRail(); renderChannels(); renderStage(); renderMembers();
});

function applyPresence({ users, online, nicks }) {
  S.users = new Map(users.map((u) => [u.id, u])); S.online = online; S.nicks = nicks || {};
  const meU = S.users.get(S.me.uid); if (meU) { S.me.name = meU.name; S.me.role = meU.role; }
  renderMe(); renderMembers();
  if (S.messages.length) renderMessages(); // nomes e fotos podem ter mudado
  if (!$('pcard').hidden && cardUid != null) openCard(cardUid, cardAnchor);
}
socket.on('presence', applyPresence);

function afterHello(d) {
  S.me.id = d.sid; S.me.uid = d.user.id; S.me.name = d.user.name; S.me.role = d.user.role;
  S.servers = d.servers; S.voice = d.voice;
  S.unread = d.unread || {}; S.dms = d.dms || [];
  applyPresence(d);
  renderUnread();
  $('addServerBtn').hidden = !isOwner();
}
function start() {
  socket.emit('hello', helloPayload(), (d) => {
    afterHello(d);
    // volta para onde estava: canal de servidor ou conversa direta
    let last = ''; try { last = localStorage.getItem('junta:last') || ''; } catch {}
    if (isDmKey(last) && S.users.has(dmOther(last))) { openDm(dmOther(last)); return; }
    const [sid, cid] = last.split('/');
    const s = d.servers.find((x) => x.id === sid);
    if (s && s.channels.some((c) => c.id === cid)) { S.serverId = s.id; selectChannel(cid); }
    else selectServer(d.servers[0].id);
  });
}
let booted = false;
socket.on('connect', () => {
  if (!booted) { booted = true; start(); return; }
  // reconexão: o id da conexão mudou, a sala de voz precisa ser refeita
  const wasIn = S.voiceKey;
  if (wasIn) { for (const id of Object.keys(S.peers)) closePeer(id); S.voiceKey = null; }
  socket.emit('hello', helloPayload(), (d) => {
    afterHello(d);
    if (S.home && S.dmKey) openDm(dmOther(S.dmKey)); else if (S.channelId) selectChannel(S.channelId);
    if (wasIn) { stopScreen(true); stopCamera(true); stopMic(); stopAllMeters(); toast('Conexão restabelecida. Entre de novo na sala de voz.'); renderChannels(); renderStage(); }
  });
});
// o dono redefiniu a senha ou removeu a conta, ou a senha foi trocada em outro aparelho
socket.on('session-ended', () => {
  socket.disconnect();
  if (S.voiceKey) leaveVoice();
  showAuth('Sua sessão foi encerrada. Entre de novo com a sua senha (ou a senha temporária que o dono te passou).');
});
socket.on('connect_error', (err) => {
  if (err?.message === 'unauthorized') { socket.disconnect(); showAuth('Sua sessão expirou. Entre de novo.'); }
});
