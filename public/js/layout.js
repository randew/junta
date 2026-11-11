// Junta — barra de servidores, canais, membros, status e navegação
'use strict';

// ---------- render: servidores e canais ----------
function renderRail() {
  // início (conversas diretas)
  const home = $('homeBtn'); home.classList.toggle('active', S.home);
  home.querySelector('.badge')?.remove();
  const dm = dmUnread(); if (dm) home.append(badge(dm));
  const list = $('serverList'); list.replaceChildren();
  for (const s of S.servers) {
    const u = unreadIn(s.id);
    const b = el('button', 'rail-btn' + (!S.home && s.id === S.serverId ? ' active' : '') + (u.n ? ' unread' : ''), initials(s.name));
    b.title = s.name; b.setAttribute('aria-label', s.name + (u.m ? `, ${u.m} menções` : u.n ? ', mensagens novas' : ''));
    const hasVoice = s.channels.some((c) => S.voice[keyOf(s.id, c.id)]?.length);
    if (hasVoice) b.append(el('span', 'vbadge'));
    if (u.m) b.append(badge(u.m));
    b.onclick = () => selectServer(s.id);
    list.append(b);
  }
}

function renderChannels() {
  const box = $('channelList'); box.replaceChildren();
  renderVoiceBar();
  if (S.home) { renderDmList(box); return; }
  const s = currentServer(); if (!s) return;
  $('serverName').textContent = s.name;
  for (const [type, label] of [['text', 'Canais de texto'], ['voice', 'Voz e tela']]) {
    const cat = el('div', 'cat'); cat.append(el('span', null, label));
    if (isOwner()) {
      const add = el('button', null, '+'); add.title = 'Criar canal'; add.setAttribute('aria-label', 'Criar canal');
      add.onclick = () => createChannel(type); cat.append(add);
    }
    box.append(cat);
    for (const c of s.channels.filter((c) => c.type === type)) {
      const wrap = el('div', 'chan-wrap');
      const un = S.unread[keyOf(s.id, c.id)];
      const b = el('button', 'chan' + (c.id === S.channelId ? ' active' : '') + (un ? ' unread' : ''));
      b.append(el('span', 'glyph', type === 'text' ? '#' : '◖'), el('span', 'label', c.name));
      if (un?.m) b.append(badge(un.m));
      b.onclick = () => { selectChannel(c.id); document.getElementById('app').classList.remove('drawer'); };
      wrap.append(b);
      if (isOwner()) {
        const del = el('button', 'chan-del', '×'); del.title = 'Apagar canal'; del.setAttribute('aria-label', `Apagar canal ${c.name}`);
        del.onclick = () => deleteChannel(c); wrap.append(del);
      }
      box.append(wrap);
      const members = S.voice[keyOf(s.id, c.id)] || [];
      if (type === 'voice' && members.length) {
        const ml = el('div', 'chan-members');
        for (const m of members) {
          const row = el('div', 'chan-member'); row.append(avatar(m.name, m.uid), el('span', 'nm', m.name));
          if (m.sharing) row.append(el('span', 'tag', 'AO VIVO'));
          if (m.muted) row.append(el('span', 'muted-ic', '✕'));
          ml.append(row);
        }
        box.append(ml);
      }
    }
  }
}
function renderVoiceBar() {
  $('voiceBar').hidden = !S.voiceKey;
  if (S.voiceKey) {
    const [sid, cid] = S.voiceKey.split('/');
    const sv = S.servers.find((x) => x.id === sid); const ch = sv?.channels.find((x) => x.id === cid);
    $('voiceBarRoom').textContent = `${ch?.name || cid} / ${sv?.name || sid}`;
  }
}

function renderMe() {
  const myName = S.me.uid != null && S.users.size ? userName(S.me.uid) : S.me.name;
  $('meName').textContent = myName;
  $('meAvatar').replaceWith(Object.assign(avatar(myName, S.me.uid), { id: 'meAvatar' }));
  const st = myStatus();
  $('meDot').className = 'sdot s-' + st;
  $('meStatus').textContent = autoIdle && manualStatus === 'online' ? 'Ausente (automático)' : STATUS_LABEL[st];
}

// ---------- presença: lista de membros e status ----------
const STATUS_LABEL = { online: 'Online', idle: 'Ausente', dnd: 'Não perturbe' };
const RANK = { online: 0, dnd: 1, idle: 2 };
let manualStatus = (() => { try { return localStorage.getItem('junta:status'); } catch { return null; } })();
if (!STATUS_LABEL[manualStatus]) manualStatus = 'online';
let autoIdle = false, idleTimer = null;
const AUTO_IDLE_MS = 5 * 60e3;
const myStatus = () => (manualStatus === 'online' && autoIdle ? 'idle' : manualStatus);
const helloPayload = () => ({ status: myStatus() });
function pushStatus() { socket.emit('set-status', myStatus()); renderMe(); }

// aba em segundo plano por 5 minutos: fica ausente; voltou: online de novo
document.addEventListener('visibilitychange', () => {
  clearTimeout(idleTimer);
  if (document.hidden) idleTimer = setTimeout(() => { autoIdle = true; pushStatus(); }, AUTO_IDLE_MS);
  else if (autoIdle) { autoIdle = false; pushStatus(); }
});

const statusMenu = $('statusMenu'), statusBtn = $('statusBtn');
function closeStatusMenu() { statusMenu.hidden = true; statusBtn.setAttribute('aria-expanded', 'false'); }
statusBtn.onclick = (e) => {
  e.stopPropagation();
  const open = statusMenu.hidden; statusMenu.hidden = !open; statusBtn.setAttribute('aria-expanded', String(open));
  refreshNotifItem();
  if (open) statusMenu.querySelector(`[data-status="${manualStatus}"]`)?.focus();
};
statusMenu.addEventListener('click', (e) => {
  const act = e.target.closest('[data-action]');
  if (act) {
    closeStatusMenu();
    ({ invite: openInvite, admin: openAdmin, password: openPassword, notif: toggleNotifications, logout })[act.dataset.action]?.();
    return;
  }
  const b = e.target.closest('[data-status]'); if (!b) return;
  manualStatus = b.dataset.status; autoIdle = false;
  try { localStorage.setItem('junta:status', manualStatus); } catch {}
  pushStatus(); closeStatusMenu(); statusBtn.focus();
});
document.addEventListener('click', (e) => { if (!statusMenu.hidden && !statusMenu.contains(e.target)) closeStatusMenu(); });
statusMenu.addEventListener('keydown', (e) => {
  const items = [...statusMenu.querySelectorAll('button')]; const i = items.indexOf(document.activeElement);
  if (e.key === 'Escape') { closeStatusMenu(); statusBtn.focus(); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
});

// painel de membros: aberto por padrão em telas largas
let showMembers = (() => { try { const v = localStorage.getItem('junta:members'); return v === null ? null : v === '1'; } catch { return null; } })();
if (showMembers === null) showMembers = window.innerWidth > 1100;
function applyMembersVisible() {
  $('app').classList.toggle('no-members', !showMembers);
  $('membersBtn').setAttribute('aria-pressed', String(showMembers));
}
$('membersBtn').onclick = () => { showMembers = !showMembers; try { localStorage.setItem('junta:members', showMembers ? '1' : '0'); } catch {} applyMembersVisible(); };
applyMembersVisible();

const isOwner = () => S.me.role === 'owner';
// nome num servidor: apelido de lá, ou o nome de exibição (nas conversas diretas, sempre o nome de exibição)
const userName = (uid, serverId = S.home ? null : S.serverId) => (serverId && S.nicks?.[uid]?.[serverId]) || S.users.get(uid)?.name || 'Alguém';

function voiceWhere(sid) {
  for (const [key, list] of Object.entries(S.voice)) {
    const m = list.find((x) => x.id === sid); if (!m) continue;
    const [svid, cid] = key.split('/');
    const sv = S.servers.find((x) => x.id === svid); const ch = sv?.channels.find((c) => c.id === cid);
    return { room: ch?.name || cid, server: sv?.name || svid, serverId: svid, sharing: m.sharing };
  }
  return null;
}

function renderMembers() {
  // cada conta aparece uma vez, mesmo com várias abas abertas; vale o status "mais ativo"
  const live = new Map();
  for (const o of S.online) {
    const cur = live.get(o.uid) || { status: o.status, where: null };
    if (RANK[o.status] < RANK[cur.status]) cur.status = o.status;
    const w = voiceWhere(o.sid); if (w && (!cur.where || w.sharing)) cur.where = w;
    live.set(o.uid, cur);
  }
  const people = [...S.users.values()].filter((u) => !u.disabled)
    .map((u) => ({ ...u, ...(live.get(u.id) || { status: 'offline', where: null }), me: u.id === S.me.uid }))
    .sort((a, b) => userName(a.id).localeCompare(userName(b.id), 'pt-BR'));
  const box = $('memberList'); box.replaceChildren();
  const groups = [
    ['Online', people.filter((p) => p.status === 'online' || p.status === 'dnd')],
    ['Ausente', people.filter((p) => p.status === 'idle')],
    ['Offline', people.filter((p) => p.status === 'offline')],
  ];
  for (const [label, list] of groups) {
    if (!list.length) continue;
    box.append(el('div', 'mgroup', `${label} — ${list.length}`));
    for (const p of list) {
      const shown = userName(p.id);
      const row = el('button', 'mrow' + (p.status === 'idle' ? ' away' : '') + (p.status === 'offline' ? ' offline' : ''));
      row.type = 'button'; row.setAttribute('aria-label', `Perfil de ${shown}`);
      row.onclick = () => openCard(p.id, row);
      const w = el('span', 'av-wrap'); w.title = STATUS_LABEL[p.status] || 'Offline';
      w.append(avatar(shown, p.id), el('span', 'sdot s-' + p.status));
      const txt = el('div', 'txt');
      const nm = el('span', 'nm', shown);
      if (p.role === 'owner') { const c = el('span', 'crown', '★'); c.title = 'Dono do Junta'; nm.append(c); }
      if (p.me) nm.append(el('span', 'you', ' (você)'));
      txt.append(nm);
      if (p.where) {
        const other = p.where.serverId !== S.serverId ? ` · ${p.where.server}` : '';
        txt.append(el('span', 'act' + (p.where.sharing ? ' live' : ''), (p.where.sharing ? `Transmitindo em ${p.where.room}` : `Em ${p.where.room}`) + other));
      } else if (p.statusText && p.status !== 'offline') txt.append(el('span', 'act', p.statusText));
      else if (p.status === 'dnd') txt.append(el('span', 'act', 'Não perturbe'));
      row.append(w, txt); box.append(row);
    }
  }
}

// ---------- seleção ----------
function selectServer(id) {
  S.home = false; S.dmKey = null;
  S.serverId = id;
  const s = currentServer();
  const firstText = s.channels.find((c) => c.type === 'text') || s.channels[0];
  selectChannel(firstText.id);
}

function selectChannel(id, opts = {}) {
  S.home = false; S.dmKey = null;
  S.channelId = id;
  const c = currentChannel(); if (!c) return;
  try { localStorage.setItem('junta:last', keyOf(S.serverId, id)); } catch {}
  $('dmEmpty').hidden = true; $('composer').hidden = false;
  $('topMark').textContent = c.type === 'text' ? '#' : '◖';
  $('channelTitle').textContent = c.name;
  $('channelSub').textContent = c.type === 'text' ? `Conversa em ${currentServer().name}` : 'Voz e compartilhamento de tela';
  $('textView').hidden = c.type !== 'text';
  $('voiceView').hidden = c.type !== 'voice';
  if (c.type === 'text') {
    $('msgInput').placeholder = `Mensagem em #${c.name}`;
    openText(keyOf(S.serverId, id), opts);
  } else {
    renderStage();
  }
  renderRail(); renderChannels(); renderMembers();
}

async function createChannel(type) {
  const r = await ask({ title: 'Criar canal', text: `Em ${currentServer().name}`, placeholder: type === 'text' ? 'novo-canal' : 'Sala de jogos', ok: 'Criar', withType: true });
  if (!r) return;
  socket.emit('create-channel', { serverId: S.serverId, name: r.value, type: r.type || type }, (res) => {
    if (res?.error) toast(res.error); else if (res?.id) selectChannel(res.id);
  });
}
async function deleteChannel(c) {
  const r = await ask({ title: `Apagar ${c.type === 'text' ? '#' : ''}${c.name}?`, text: c.type === 'text' ? 'Todas as mensagens e anexos deste canal serão apagados para sempre.' : 'Quem estiver na sala será desconectado.', ok: 'Apagar canal', noInput: true, danger: true });
  if (!r) return;
  socket.emit('delete-channel', keyOf(S.serverId, c.id), (res) => { if (res?.error) toast(res.error); else toast('Canal apagado.'); });
}
$('addServerBtn').onclick = async () => {
  const r = await ask({ title: 'Criar servidor', text: 'Ele já vem com um canal de texto e uma sala de voz.', placeholder: 'Nome do servidor', ok: 'Criar' });
  if (r) socket.emit('create-server', r.value, (res) => { if (res?.error) toast(res.error); else if (res?.id) selectServer(res.id); });
};

$('renameBtn').onclick = () => openProfileEditor();

$('menuBtn').onclick = () => $('app').classList.toggle('drawer');
$('app').addEventListener('click', (e) => { if (e.target === $('app')) $('app').classList.remove('drawer'); });
