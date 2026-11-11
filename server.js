// Junta — servidor de chat + sinalização WebRTC
const express = require('express');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const MAX_HISTORY = 300;

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e6 });

app.use(express.static(path.join(__dirname, 'public')));
// supressão de ruído (RNNoise em WebAssembly), servida para o navegador
app.use('/vendor/nsup', express.static(path.join(__dirname, 'node_modules/@sapphi-red/web-noise-suppressor/dist')));

// ---------- Estado em memória ----------
const servers = [
  {
    id: 'geral', name: 'Geral', channels: [
      { id: 'bate-papo', name: 'bate-papo', type: 'text' },
      { id: 'links', name: 'links', type: 'text' },
      { id: 'sala-1', name: 'Sala 1', type: 'voice' },
      { id: 'sala-2', name: 'Sala 2', type: 'voice' },
    ],
  },
  {
    id: 'trabalho', name: 'Trabalho', channels: [
      { id: 'daily', name: 'daily', type: 'text' },
      { id: 'reuniao', name: 'Reunião', type: 'voice' },
    ],
  },
];
const messages = {}; // "serverId/channelId" -> [msg]
const voice = {};    // "serverId/channelId" -> { socketId: {name, muted, sharing, camera} }

const slug = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || crypto.randomBytes(3).toString('hex');
const clean = (s, n) => String(s ?? '').trim().slice(0, n);
const channelExists = (key) => {
  const [sid, cid] = String(key).split('/');
  const s = servers.find((x) => x.id === sid);
  return s && s.channels.find((c) => c.id === cid);
};

function voiceSnapshot() {
  const out = {};
  for (const [key, members] of Object.entries(voice)) {
    const list = Object.entries(members).map(([id, m]) => ({ id, ...m }));
    if (list.length) out[key] = list;
  }
  return out;
}

function leaveVoice(socket) {
  const key = socket.data.voice;
  if (!key) return;
  if (voice[key]) delete voice[key][socket.id];
  socket.leave('v:' + key);
  socket.to('v:' + key).emit('peer-left', socket.id);
  socket.data.voice = null;
  io.emit('voice-state', voiceSnapshot());
}

// ---------- Presença: quem está com o app aberto ----------
const online = {}; // socketId -> { name, status }
const STATUSES = ['online', 'idle', 'dnd'];
const presenceList = () => Object.entries(online).map(([id, u]) => ({ id, ...u }));
let presenceTimer = null;
const broadcastPresence = () => { // agrupa rajadas de mudanças num só envio
  clearTimeout(presenceTimer);
  presenceTimer = setTimeout(() => io.emit('presence', presenceList()), 150);
};

io.on('connection', (socket) => {
  socket.data.name = 'Visitante';

  socket.on('hello', (payload, cb) => {
    const { name, status } = typeof payload === 'object' && payload ? payload : { name: payload };
    socket.data.name = clean(name, 32) || 'Visitante';
    const prev = online[socket.id];
    online[socket.id] = { name: socket.data.name, status: STATUSES.includes(status) ? status : prev?.status || 'online' };
    // renomeou dentro de uma sala de voz: atualiza o nome lá também
    const vk = socket.data.voice;
    if (vk && voice[vk]?.[socket.id]) { voice[vk][socket.id].name = socket.data.name; io.emit('voice-state', voiceSnapshot()); }
    broadcastPresence();
    if (typeof cb === 'function') cb({ id: socket.id, servers, voice: voiceSnapshot(), presence: presenceList() });
  });

  socket.on('set-status', (status) => {
    if (!online[socket.id] || !STATUSES.includes(status)) return;
    online[socket.id].status = status;
    broadcastPresence();
  });

  socket.on('join-text', (key, cb) => {
    if (!channelExists(key)) return;
    if (socket.data.text) socket.leave('t:' + socket.data.text);
    socket.data.text = key;
    socket.join('t:' + key);
    if (typeof cb === 'function') cb(messages[key] || []);
  });

  socket.on('message', ({ key, text } = {}) => {
    const body = clean(text, 4000);
    if (!body || !channelExists(key)) return;
    const msg = { id: crypto.randomUUID(), author: socket.data.name, authorId: socket.id, text: body, ts: Date.now() };
    (messages[key] ||= []).push(msg);
    if (messages[key].length > MAX_HISTORY) messages[key].shift();
    io.to('t:' + key).emit('message', { key, msg });
  });

  socket.on('typing', (key) => {
    if (socket.data.text === key) socket.to('t:' + key).emit('typing', { key, name: socket.data.name });
  });

  socket.on('create-server', (name) => {
    const n = clean(name, 40);
    if (!n || servers.length >= 30) return;
    let id = slug(n);
    while (servers.some((s) => s.id === id)) id += '-' + crypto.randomBytes(2).toString('hex');
    servers.push({ id, name: n, channels: [
      { id: 'geral', name: 'geral', type: 'text' },
      { id: 'voz', name: 'Voz', type: 'voice' },
    ] });
    io.emit('servers', servers);
  });

  socket.on('create-channel', ({ serverId, name, type } = {}) => {
    const s = servers.find((x) => x.id === serverId);
    const n = clean(name, 40);
    if (!s || !n || s.channels.length >= 50) return;
    const t = type === 'voice' ? 'voice' : 'text';
    let id = slug(n);
    while (s.channels.some((c) => c.id === id)) id += '-' + crypto.randomBytes(2).toString('hex');
    s.channels.push({ id, name: t === 'text' ? slug(n) : n, type: t });
    io.emit('servers', servers);
  });

  // ---------- Voz / tela (sinalização) ----------
  socket.on('voice-join', (key, cb) => {
    if (!channelExists(key)) return;
    leaveVoice(socket);
    voice[key] ||= {};
    const peers = Object.keys(voice[key]);
    voice[key][socket.id] = { name: socket.data.name, muted: false, sharing: false };
    socket.data.voice = key;
    socket.join('v:' + key);
    if (typeof cb === 'function') cb(peers);
    io.emit('voice-state', voiceSnapshot());
  });

  socket.on('voice-leave', () => leaveVoice(socket));

  socket.on('voice-update', (patch = {}) => {
    const key = socket.data.voice;
    const me = key && voice[key]?.[socket.id];
    if (!me) return;
    if ('muted' in patch) me.muted = !!patch.muted;
    if ('sharing' in patch) me.sharing = !!patch.sharing;
    io.emit('voice-state', voiceSnapshot());
  });

  socket.on('signal', ({ to, data } = {}) => {
    const key = socket.data.voice;
    if (!key || !voice[key]?.[to]) return; // só entre membros da mesma sala
    io.to(to).emit('signal', { from: socket.id, data });
  });

  socket.on('disconnect', () => {
    leaveVoice(socket);
    delete online[socket.id];
    broadcastPresence();
  });
});

server.listen(PORT, () => {
  console.log(`Junta rodando em http://localhost:${PORT}`);
});
