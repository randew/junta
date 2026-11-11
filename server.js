// Junta — ponto de entrada do servidor: liga as rotas e os eventos de cada módulo em lib/
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`O Junta precisa do Node.js 22.13 ou mais novo (o seu é ${process.versions.node}). Instale a versão LTS em https://nodejs.org`);
  process.exit(1);
}
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const { db, inviteCode, DATA_DIR } = require('./lib/db');
const { reply } = require('./lib/util');
const accounts = require('./lib/accounts');
const files = require('./lib/files');
const admin = require('./lib/admin');
const messages = require('./lib/messages');
const servers = require('./lib/servers');
const voice = require('./lib/voice');
const roles = require('./lib/roles');
const { createTurn } = require('./lib/turn');
const { createTurnUsage } = require('./lib/turn-usage');
const { createRealtime } = require('./lib/realtime');
const { serverList, dmList } = require('./lib/channels');

function start({ port = process.env.PORT || 3000, backups = true, log = console.log } = {}) {
  const app = express();
  app.set('trust proxy', 1); // túnel / Render: respeita https e IP repassados pelo proxy
  const server = http.createServer(app);
  const io = new Server(server, {
    maxHttpBufferSize: 1e6,
    // só aceita conexões vindas da própria página do Junta
    allowRequest: (req, cb) => {
      const origin = req.headers.origin;
      try { cb(null, !origin || new URL(origin).host === req.headers.host); } catch { cb(null, false); }
    },
  });

  const ctx = { io, rt: createRealtime(io), MAX_FILE_MB: 25, MAX_FILES: 10 };

  app.use(express.json({ limit: '20kb' }));
  app.use(express.static(path.join(__dirname, 'public')));
  app.use('/vendor/nsup', express.static(path.join(__dirname, 'node_modules/@sapphi-red/web-noise-suppressor/dist')));
  accounts.routes(app, ctx);
  files.routes(app, ctx);
  admin.routes(app, ctx);

  // servidores de conexão da voz: STUN, e TURN quando configurado (veja lib/turn.js)
  const turn = createTurn(DATA_DIR, log);
  app.get('/api/ice', accounts.auth, async (req, res) => {
    const { iceServers, turn: on } = await turn.get();
    res.set('Cache-Control', 'no-store').json({ iceServers, turn: on });
  });
  // consumo do TURN na Cloudflare (painel de administração)
  const turnUsage = createTurnUsage(DATA_DIR);
  app.get('/api/admin/turn-usage', accounts.auth, accounts.ownerOnly, async (req, res) => {
    const usage = await turnUsage.get(req.query.force === '1');
    const t = turn.status();
    res.set('Cache-Control', 'no-store').json({ turn: { configured: t.configured, error: t.error }, usage });
  });

  // ---------- conexão em tempo real (só com login) ----------
  io.use((socket, next) => {
    const u = accounts.userFromCookie(socket.request.headers.cookie);
    if (!u) return next(new Error('unauthorized'));
    socket.data.user = u;
    next();
  });

  io.on('connection', (socket) => {
    const me = () => socket.data.user;
    socket.join('u:' + me().id); // sala com todas as abas desta conta (avisos pessoais)

    socket.on('hello', (payload, cb) => {
      const status = ctx.rt.STATUSES.includes(payload?.status) ? payload.status : 'online';
      ctx.rt.online[socket.id] = { uid: me().id, status };
      ctx.rt.broadcastPresence();
      reply(cb, {
        sid: socket.id, user: accounts.publicUser(accounts.fullUser(me().id)),
        servers: serverList(me().id), voice: ctx.rt.voiceFor(me().id), ...ctx.rt.presencePayload(),
        unread: messages.unreadFor(me().id), dms: dmList(me().id),
      });
    });

    socket.on('set-status', (status) => {
      if (!ctx.rt.online[socket.id] || !ctx.rt.STATUSES.includes(status)) return;
      ctx.rt.online[socket.id].status = status;
      ctx.rt.broadcastPresence();
    });

    messages.register(socket, ctx);
    servers.register(socket, ctx);
    voice.register(socket, ctx);
    roles.register(socket, ctx);

    socket.on('disconnect', () => {
      ctx.rt.leaveVoice(socket);
      delete ctx.rt.online[socket.id];
      ctx.rt.broadcastPresence();
    });
  });

  if (backups) admin.scheduleBackups(log);

  return new Promise((resolve, reject) => {
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        log(`A porta ${port} já está em uso. O Junta já está aberto em outra janela? Feche-a e tente de novo.`);
        if (require.main === module) process.exit(1);
      }
      reject(err);
    });
    server.listen(port, () => {
      const actual = server.address().port;
      log(`Junta rodando em http://localhost:${actual}`);
      const owner = db.prepare("SELECT 1 FROM users WHERE role = 'owner'").get();
      log(owner
        ? `Código de convite para novos amigos: ${inviteCode()}`
        : `Primeira vez: abra o endereço acima e crie a sua conta com o código ${inviteCode()}. Quem criar a primeira conta vira o dono do Junta.`);
      if (turn.status().configured) turn.get().then((c) => c.turn && log('TURN ativo: quem não conseguir conexão direta na voz passa pelo servidor TURN.'));
      resolve({ server, io, ctx, port: actual, close: () => new Promise((r) => { io.close(); server.close(() => r()); }) });
    });
  });
}

if (require.main === module) start();
module.exports = { start };
