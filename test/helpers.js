// Ajudantes dos testes: sobe um Junta com banco temporário e cria "pessoas" que usam a API
const fs = require('fs');
const os = require('os');
const path = require('path');

// banco e arquivos numa pasta temporária, apagada no fim
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'junta-teste-'));
process.env.JUNTA_DATA = DATA;
process.env.JUNTA_BACKUP_DIR = path.join(DATA, 'backups');

const { io: connect } = require('socket.io-client');
const { start } = require('../server');

async function boot() {
  const logs = [];
  const app = await start({ port: 0, backups: false, log: (m) => logs.push(m) });
  const base = `http://localhost:${app.port}`;
  const invite = logs.join('\n').match(/[A-Z0-9]{4}-[A-Z0-9]{4}/)[0];
  return {
    ...app, base, invite, logs,
    async stop() { await app.close(); fs.rmSync(DATA, { recursive: true, force: true }); },
  };
}

// uma "pessoa": cookie de sessão + socket conectado
async function person(app, username, { password = 'segredo123', register = true } = {}) {
  const r = await fetch(`${app.base}/api/${register ? 'register' : 'login'}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, invite: app.invite }),
  });
  if (!r.ok) throw new Error(`${username}: ${(await r.json()).error}`);
  const cookie = r.headers.get('set-cookie').split(';')[0];
  const p = { username, cookie, events: [] };
  p.api = async (method, url, body) => {
    const res = await fetch(app.base + url, {
      method, headers: { cookie, ...(body && !(body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}) },
      body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
    });
    let data = null; try { data = await res.json(); } catch {}
    return { status: res.status, data };
  };
  p.connect = async () => {
    p.socket = connect(app.base, { extraHeaders: { cookie }, transports: ['websocket'], forceNew: true });
    p.socket.onAny((ev, data) => p.events.push({ ev, data }));
    await new Promise((res, rej) => { p.socket.once('connect', res); p.socket.once('connect_error', rej); });
    p.hello = await p.emit('hello', { status: 'online' });
    p.id = p.hello.user.id;
    return p;
  };
  p.emit = (ev, data) => new Promise((res) => p.socket.emit(ev, data, res));
  // espera um evento que satisfaça a condição
  p.waitFor = (ev, pred = () => true, ms = 3000) => new Promise((res, rej) => {
    const found = p.events.find((e) => e.ev === ev && pred(e.data));
    if (found) return res(found.data);
    const t = setTimeout(() => { p.socket.off(ev, h); rej(new Error(`${p.username}: não chegou "${ev}"`)); }, ms);
    const h = (data) => { if (pred(data)) { clearTimeout(t); p.socket.off(ev, h); res(data); } };
    p.socket.on(ev, h);
  });
  p.close = () => p.socket?.close();
  await p.connect();
  return p;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = { boot, person, sleep, DATA };
