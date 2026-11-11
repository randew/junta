// Junta — base: estado, utilidades, conexão e janelas de diálogo
'use strict';

const $ = (id) => document.getElementById(id);
const socket = io({ autoConnect: false }); // conecta só depois do login

// servidores de conexão da voz; o servidor do Junta manda a lista atual (com TURN, se configurado)
const ICE = { iceServers: [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }] };
let iceTurn = false, iceAt = 0;
async function loadIce(force) {
  if (!force && Date.now() - iceAt < 3 * 3600_000) return;
  try {
    const d = await api('GET', '/api/ice');
    if (Array.isArray(d.iceServers) && d.iceServers.length) { ICE.iceServers = d.iceServers; iceTurn = !!d.turn; iceAt = Date.now(); }
  } catch { /* segue com o que já tem */ }
}
const PALETTE = ['#f0a43a', '#46c28a', '#6cb4ee', '#e88aa8', '#b49cf0', '#e5c15a', '#5fcfc3', '#ef8a5b'];

const S = {
  me: { id: null, uid: null, name: '', role: 'member' }, // id = conexão atual; uid = conta
  users: new Map(), online: [], limits: { maxFileMb: 25, maxFiles: 10 },
  servers: [], voice: {},
  serverId: null, channelId: null,
  home: false, dmKey: null, dms: [],        // tela inicial: conversas diretas
  unread: {},                               // canal -> { n: não lidas, m: menções }
  roles: {}, memberRoles: {},               // cargos por servidor e quem tem cada um
  messages: [], more: false, loadingOlder: false,
  atLatest: true, loadingNewer: false, lastRead: 0, replyTo: null,
  // voz
  voiceKey: null, screen: null, muted: false,
  focus: null,         // tela ou câmera em destaque no palco ("screen:<id>" / "cam:<id>")
  sideChat: null,      // id do canal de texto aberto ao lado da sala de voz
  peers: {},          // peerId -> { pc, polite, makingOffer, ignoreOffer, screenSenders, audioEls, screenStream }
  speaking: new Set(),
};

// ---------- util ----------
const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7);
const colorFor = (s) => PALETTE[Math.abs(hash(s || '?')) % PALETTE.length];
const initials = (s) => (s || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const keyOf = (sid, cid) => `${sid}/${cid}`;
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
// Avatar: foto de perfil quando a conta tem uma; senão, iniciais na cor do perfil
const avatarUrl = (u) => (u?.avatar ? `/avatares/${u.avatar}` : null);
function avatar(name, uid) {
  const u = uid != null ? S.users.get(uid) : null;
  const a = el('div', 'avatar');
  const url = avatarUrl(u);
  if (url) { const im = el('img'); im.src = url; im.alt = ''; im.loading = 'lazy'; im.decoding = 'async'; a.append(im); a.classList.add('has-img'); }
  else { a.textContent = initials(name); a.style.background = u?.color || colorFor(name); }
  return a;
}
const time = (ts) => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const dayLabel = (ts) => new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
let toastT;
const toast = (msg) => { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 3500); };

const currentServer = () => S.servers.find((s) => s.id === S.serverId);
const currentChannel = () => currentServer()?.channels.find((c) => c.id === S.channelId);

// ---------- conversas diretas ----------
// "dm/<menor id>-<maior id>"
const isDmKey = (k) => /^dm\/\d+-\d+$/.test(String(k));
const dmKeyWith = (uid) => `dm/${Math.min(uid, S.me.uid)}-${Math.max(uid, S.me.uid)}`;
const dmOther = (k) => { const [a, b] = k.slice(3).split('-').map(Number); return a === S.me.uid ? b : a; };
// canal de texto ao lado da sala de voz (chat lateral), se estiver aberto e ainda existir
const sideChannel = () => {
  if (!S.sideChat || currentChannel()?.type !== 'voice') return null;
  const c = currentServer()?.channels.find((x) => x.id === S.sideChat);
  return c?.type === 'text' ? c : null;
};
// o canal de texto que a conversa na tela mostra: o aberto, ou o chat lateral numa sala de voz
const textChannel = () => { const c = currentChannel(); return c?.type === 'text' ? c : sideChannel(); };
// canal de texto (ou conversa direta) aberto agora; null numa sala de voz sem chat lateral
function curKey() {
  if (S.home) return S.dmKey;
  const c = textChannel();
  return c ? keyOf(S.serverId, c.id) : null;
}
// ---------- permissões (as mesmas do servidor, em lib/perms.js) ----------
const P = {
  VIEW: 1 << 0, SEND: 1 << 1, ATTACH: 1 << 2, REACT: 1 << 3, MENTION_ALL: 1 << 4, MANAGE_MESSAGES: 1 << 5,
  CONNECT: 1 << 6, SPEAK: 1 << 7, STREAM: 1 << 8, MUTE_MEMBERS: 1 << 9, MOVE_MEMBERS: 1 << 10,
  MANAGE_CHANNELS: 1 << 11, MANAGE_ROLES: 1 << 12, MANAGE_SERVER: 1 << 13, INVITE: 1 << 14, ADMIN: 1 << 15,
};
const has = (bits, bit) => (bits & bit) === bit;
// no servidor: o que eu posso (o servidor manda isso já calculado)
const canSrv = (bit, sid = S.serverId) => has(S.servers.find((s) => s.id === sid)?.perms ?? 0, bit);
// no canal aberto (nas conversas diretas, pode tudo de texto)
const canHere = (bit) => S.home || has(textChannel()?.perms ?? currentChannel()?.perms ?? 0, bit);
const canChan = (key, bit) => { if (isDmKey(key)) return true; const [sid, cid] = key.split('/'); return has(S.servers.find((s) => s.id === sid)?.channels.find((c) => c.id === cid)?.perms ?? 0, bit); };
const rolesIn = (sid = S.serverId) => S.roles[sid] || [];
const rolesOfUser = (uid, sid = S.serverId) => { const ids = S.memberRoles[sid]?.[uid] || []; return rolesIn(sid).filter((r) => ids.includes(r.id)); };
// cor do nome: a do cargo mais alto que tem cor
const roleColor = (uid, sid = S.serverId) => (sid ? rolesOfUser(uid, sid).find((r) => r.color)?.color : null) || null;
// posição do meu cargo mais alto (o dono do Junta fica acima de todos)
const myTop = (sid = S.serverId) => (S.me.role === 'owner' ? Infinity : Math.max(0, ...rolesOfUser(S.me.uid, sid).map((r) => r.pos)));
const topOf = (uid, sid = S.serverId) => (S.users.get(uid)?.role === 'owner' ? Infinity : Math.max(0, ...rolesOfUser(uid, sid).map((r) => r.pos)));

// emit com resposta em forma de Promise
const emitP = (ev, data) => new Promise((res, rej) => socket.emit(ev, data, (r) => (r?.error ? rej(new Error(r.error)) : res(r))));
async function api(method, url, body) {
  const r = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Algo deu errado. Tente de novo.');
  return d;
}

// ---------- modal ----------
let modalResolve = null;
function ask({ title, text = '', value = '', placeholder = '', ok = 'OK', withType = false, cancellable = true, noInput = false, danger = false }) {
  $('modalTitle').textContent = title; $('modalText').textContent = text; $('modalText').hidden = !text;
  const inp = $('modalInput'); inp.value = value; inp.placeholder = placeholder; inp.hidden = noInput; inp.required = !noInput;
  $('modalOk').classList.toggle('danger-btn', danger);
  if (noInput) setTimeout(() => $('modalOk').focus(), 30);
  $('modalOk').textContent = ok; $('modalType').hidden = !withType; $('modalCancel').hidden = !cancellable;
  if (withType) document.querySelector('input[name=ctype][value=text]').checked = true;
  $('modal').hidden = false; setTimeout(() => inp.focus(), 30);
  return new Promise((res) => (modalResolve = res));
}
function closeModal(result) { $('modal').hidden = true; const r = modalResolve; modalResolve = null; r && r(result); }
$('modalForm').addEventListener('submit', (e) => {
  e.preventDefault();
  if ($('modalInput').hidden) { closeModal({ value: true }); return; }
  const v = $('modalInput').value.trim(); if (!v) return;
  closeModal({ value: v, type: document.querySelector('input[name=ctype]:checked')?.value });
});
$('modalCancel').onclick = () => closeModal(null);
$('modal').addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('modalCancel').hidden) closeModal(null); });
