// Junta — cliente
(() => {
  const $ = (id) => document.getElementById(id);
  const socket = io({ autoConnect: false }); // conecta só depois do login

  const ICE = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }] };
  const PALETTE = ['#f0a43a', '#46c28a', '#6cb4ee', '#e88aa8', '#b49cf0', '#e5c15a', '#5fcfc3', '#ef8a5b'];

  const S = {
    me: { id: null, uid: null, name: '', role: 'member' }, // id = conexão atual; uid = conta
    users: new Map(), online: [], limits: { maxFileMb: 25, maxFiles: 10 },
    servers: [], voice: {},
    serverId: null, channelId: null,
    messages: [], more: false, loadingOlder: false,
    // voz
    voiceKey: null, screen: null, muted: false,
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

  // ---------- render: servidores e canais ----------
  function renderRail() {
    const list = $('serverList'); list.replaceChildren();
    for (const s of S.servers) {
      const b = el('button', 'rail-btn' + (s.id === S.serverId ? ' active' : ''), initials(s.name));
      b.title = s.name; b.setAttribute('aria-label', s.name);
      const hasVoice = s.channels.some((c) => S.voice[keyOf(s.id, c.id)]?.length);
      if (hasVoice) b.append(el('span', 'vbadge'));
      b.onclick = () => selectServer(s.id);
      list.append(b);
    }
  }

  function renderChannels() {
    const s = currentServer(); if (!s) return;
    $('serverName').textContent = s.name;
    const box = $('channelList'); box.replaceChildren();
    for (const [type, label] of [['text', 'Canais de texto'], ['voice', 'Voz e tela']]) {
      const cat = el('div', 'cat'); cat.append(el('span', null, label));
      if (isOwner()) {
        const add = el('button', null, '+'); add.title = 'Criar canal'; add.setAttribute('aria-label', 'Criar canal');
        add.onclick = () => createChannel(type); cat.append(add);
      }
      box.append(cat);
      for (const c of s.channels.filter((c) => c.type === type)) {
        const wrap = el('div', 'chan-wrap');
        const b = el('button', 'chan' + (c.id === S.channelId ? ' active' : ''));
        b.append(el('span', 'glyph', type === 'text' ? '#' : '◖'), el('span', 'label', c.name));
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
    // barra de voz
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
    if (open) statusMenu.querySelector(`[data-status="${manualStatus}"]`)?.focus();
  };
  statusMenu.addEventListener('click', (e) => {
    const act = e.target.closest('[data-action]');
    if (act) { closeStatusMenu(); if (act.dataset.action === 'invite') openInvite(); else logout(); return; }
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
  // nome num servidor: apelido de lá, ou o nome de exibição
  const userName = (uid, serverId = S.serverId) => S.nicks?.[uid]?.[serverId] || S.users.get(uid)?.name || 'Alguém';

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
    const people = [...S.users.values()]
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
    S.serverId = id;
    const s = currentServer();
    const firstText = s.channels.find((c) => c.type === 'text') || s.channels[0];
    selectChannel(firstText.id);
  }

  function selectChannel(id) {
    S.channelId = id;
    const c = currentChannel(); if (!c) return;
    localStorage.setItem('junta:last', keyOf(S.serverId, id));
    $('topMark').textContent = c.type === 'text' ? '#' : '◖';
    $('channelTitle').textContent = c.name;
    $('channelSub').textContent = c.type === 'text' ? `Conversa em ${currentServer().name}` : 'Voz e compartilhamento de tela';
    $('textView').hidden = c.type !== 'text';
    $('voiceView').hidden = c.type !== 'voice';
    if (c.type === 'text') {
      $('msgInput').placeholder = `Mensagem em #${c.name}`;
      cancelEdit(); confirmDel = null;
      const key = keyOf(S.serverId, id);
      socket.emit('join-text', key, ({ messages, more }) => {
        if (key !== keyOf(S.serverId, S.channelId)) return; // trocou de canal antes da resposta
        S.messages = messages; S.more = more; renderMessages(true);
      });
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

  // ---------- mensagens ----------
  const linkify = (text, parent) => {
    const re = /(https?:\/\/[^\s<]+)|`([^`\n]+)`/g; let last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) parent.append(text.slice(last, m.index));
      if (m[1]) { const a = el('a', null, m[1]); a.href = m[1]; a.target = '_blank'; a.rel = 'noopener noreferrer'; parent.append(a); }
      else parent.append(el('code', null, m[2]));
      last = re.lastIndex;
    }
    if (last < text.length) parent.append(text.slice(last));
  };

  const fmtSize = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);
  const attUrl = (a) => `/anexos/${a.id}/${encodeURIComponent(a.name)}`;
  let editingId = null, confirmDel = null, stickBottom = true;

  function attNode(a) {
    if (/^image\/(png|jpe?g|gif|webp|avif)$/.test(a.mime)) {
      const link = el('a', 'att-img'); link.href = attUrl(a); link.target = '_blank'; link.rel = 'noopener';
      const img = el('img'); img.src = attUrl(a); img.alt = a.name; img.loading = 'lazy';
      img.onload = () => { if (stickBottom) $('messages').scrollTop = $('messages').scrollHeight; };
      link.append(img); return link;
    }
    if (/^video\/(mp4|webm|ogg)$/.test(a.mime)) {
      const v = el('video', 'att-video'); v.src = attUrl(a); v.controls = true; v.preload = 'metadata'; return v;
    }
    if (/^audio\//.test(a.mime)) {
      const box = el('div', 'att-audio'); box.append(el('span', 'fname', a.name));
      const au = el('audio'); au.src = attUrl(a); au.controls = true; au.preload = 'none'; box.append(au); return box;
    }
    const pdf = a.mime === 'application/pdf';
    const c = el('a', 'att-file'); c.href = pdf ? attUrl(a) : attUrl(a) + '?download'; if (pdf) { c.target = '_blank'; c.rel = 'noopener'; }
    const ext = (a.name.split('.').pop() || '').slice(0, 4).toUpperCase();
    c.append(el('span', 'ficon', ext || 'ARQ'));
    const t = el('span', 'finfo'); t.append(el('span', 'fname', a.name), el('span', 'fsize', fmtSize(a.size) + (pdf ? ' · abrir' : ' · baixar')));
    c.append(t); return c;
  }

  function msgNode(m, prev) {
    const name = userName(m.uid);
    const grouped = prev && prev.uid === m.uid && m.ts - prev.ts < 5 * 60e3 && dayLabel(prev.ts) === dayLabel(m.ts);
    const row = el('div', 'msg' + (grouped ? '' : ' head') + (editingId === m.id ? ' editing' : '')); row.dataset.id = m.id;
    if (grouped) {
      row.append(el('div', 'side', time(m.ts)));
    } else {
      const av = avatar(name, m.uid); av.classList.add('clickable'); av.onclick = () => openCard(m.uid, av); row.append(av);
      const meta = el('div', 'meta'); const who = el('button', 'who', name); who.type = 'button';
      who.style.color = S.users.get(m.uid)?.color || colorFor(name); who.onclick = () => openCard(m.uid, who);
      meta.append(who, el('span', 'when', `${dayLabel(m.ts)} ${time(m.ts)}`)); row.append(meta);
    }
    const body = el('div', 'body');
    if (editingId === m.id) {
      const ta = el('textarea', 'edit-box'); ta.value = m.text; ta.rows = 1; ta.setAttribute('aria-label', 'Editar mensagem');
      const hint = el('small', 'edit-hint', 'Enter salva · Esc cancela');
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); renderMessages(); }
        else if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); saveEdit(m, ta.value); }
      });
      ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; });
      body.append(ta, hint);
      setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); ta.style.height = ta.scrollHeight + 'px'; }, 0);
    } else {
      if (m.text) linkify(m.text, body);
      if (m.edited) { const ed = el('span', 'edited', ' (editado)'); ed.title = `${dayLabel(m.edited)} ${time(m.edited)}`; body.append(ed); }
    }
    row.append(body);
    if (m.att?.length) { const box = el('div', 'atts'); m.att.forEach((a) => box.append(attNode(a))); row.append(box); }

    const mine = m.uid === S.me.uid;
    if ((mine || isOwner()) && editingId !== m.id) {
      const act = el('div', 'msg-actions');
      if (mine) {
        const eb = el('button', 'icon-btn'); eb.title = 'Editar'; eb.setAttribute('aria-label', 'Editar mensagem');
        eb.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zm17.71-10.21a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>';
        eb.onclick = () => startEdit(m.id); act.append(eb);
      }
      const db = el('button', 'icon-btn danger'); db.title = 'Apagar (Shift+clique apaga sem perguntar)'; db.setAttribute('aria-label', 'Apagar mensagem');
      db.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';
      db.onclick = (e) => { if (e.shiftKey) deleteMessage(m.id); else { confirmDel = m.id; renderMessages(); } };
      act.append(db); row.append(act);
    }
    if (confirmDel === m.id) {
      const bar = el('div', 'del-confirm'); bar.append(el('span', null, 'Apagar esta mensagem para todos?'));
      const yes = el('button', 'danger-btn', 'Apagar'); yes.onclick = () => deleteMessage(m.id);
      const no = el('button', 'ghost', 'Cancelar'); no.onclick = () => { confirmDel = null; renderMessages(); };
      bar.append(no, yes); row.append(bar); setTimeout(() => yes.focus(), 0);
    }
    return row;
  }

  function renderMessages(scroll) {
    const box = $('messages');
    const keep = !scroll && box.scrollHeight - box.scrollTop; // mantém a posição ao redesenhar
    box.replaceChildren();
    const c = currentChannel(); if (!c) return;
    if (S.more) box.append(el('div', 'older', S.loadingOlder ? 'Carregando mensagens antigas…' : 'Role para cima para ver mensagens antigas'));
    else {
      const w = el('div', 'welcome'); w.append(el('div', 'big', '#'), el('h3', null, `Bem-vindo a #${c.name}`), el('p', null, `Este é o começo do canal #${c.name}.`));
      box.append(w);
    }
    S.messages.forEach((m, i) => box.append(msgNode(m, S.messages[i - 1])));
    if (scroll) box.scrollTop = box.scrollHeight;
    else if (keep) box.scrollTop = box.scrollHeight - keep;
  }

  // rolagem para cima: busca a página anterior no banco
  $('messages').addEventListener('scroll', () => {
    const box = $('messages');
    stickBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    if (box.scrollTop > 150 || !S.more || S.loadingOlder || !S.messages.length) return;
    S.loadingOlder = true; renderMessages();
    const key = keyOf(S.serverId, S.channelId);
    socket.emit('history', { key, before: S.messages[0].seq }, ({ messages, more }) => {
      S.loadingOlder = false;
      if (key !== keyOf(S.serverId, S.channelId)) return;
      S.messages = [...messages, ...S.messages]; S.more = more;
      renderMessages(); // mantém o que estava na tela no mesmo lugar
    });
  });

  function startEdit(id) { editingId = id; confirmDel = null; renderMessages(); }
  function cancelEdit() { editingId = null; }
  function saveEdit(m, text) {
    const t = text.trim();
    if (t === m.text) { cancelEdit(); renderMessages(); return; }
    if (!t && !m.att?.length) { confirmDel = m.id; cancelEdit(); renderMessages(); return; }
    socket.emit('message-edit', { id: m.id, text: t }, (res) => {
      if (res?.error) return toast(res.error);
      cancelEdit(); renderMessages(); $('msgInput').focus();
    });
  }
  function deleteMessage(id) {
    confirmDel = null;
    socket.emit('message-delete', id, (res) => { if (res?.error) toast(res.error); });
  }

  socket.on('message', ({ key, msg }) => {
    if (key !== keyOf(S.serverId, S.channelId)) return;
    const box = $('messages');
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    const prev = S.messages[S.messages.length - 1];
    S.messages.push(msg); box.append(msgNode(msg, prev));
    if (nearBottom || msg.uid === S.me.uid) box.scrollTop = box.scrollHeight;
    typingNames.delete(userName(msg.uid)); renderTyping();
  });
  socket.on('message-update', ({ key, msg }) => {
    if (key !== keyOf(S.serverId, S.channelId)) return;
    const i = S.messages.findIndex((x) => x.id === msg.id); if (i < 0) return;
    S.messages[i] = msg; renderMessages();
  });
  socket.on('message-delete', ({ key, id }) => {
    if (key !== keyOf(S.serverId, S.channelId)) return;
    S.messages = S.messages.filter((x) => x.id !== id);
    if (editingId === id) cancelEdit();
    renderMessages();
  });

  const input = $('msgInput');
  const autosize = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 200) + 'px'; };
  let lastTyping = 0;
  input.addEventListener('input', () => {
    autosize();
    if (Date.now() - lastTyping > 2000) { lastTyping = Date.now(); socket.emit('typing', keyOf(S.serverId, S.channelId)); }
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('composer').requestSubmit(); }
    else if (e.key === 'ArrowUp' && !input.value) { // como no Discord: seta para cima edita a sua última mensagem
      const last = [...S.messages].reverse().find((m) => m.uid === S.me.uid);
      if (last) { e.preventDefault(); startEdit(last.id); }
    }
  });

  // ---------- anexos no compositor ----------
  let pending = []; // { file, url }
  let uploading = false;
  function addFiles(list) {
    for (const f of list) {
      if (pending.length >= S.limits.maxFiles) { toast(`No máximo ${S.limits.maxFiles} arquivos por mensagem.`); break; }
      if (f.size > S.limits.maxFileMb * 1048576) { toast(`"${f.name}" passa de ${S.limits.maxFileMb} MB.`); continue; }
      pending.push({ file: f, url: f.type.startsWith('image/') ? URL.createObjectURL(f) : null });
    }
    renderTray(); input.focus();
  }
  function renderTray(progress) {
    const tray = $('tray'); tray.replaceChildren(); tray.hidden = !pending.length;
    pending.forEach((p, i) => {
      const chip = el('div', 'chip');
      if (p.url) { const im = el('img'); im.src = p.url; im.alt = ''; chip.append(im); }
      else chip.append(el('span', 'ficon', (p.file.name.split('.').pop() || '').slice(0, 4).toUpperCase() || 'ARQ'));
      const t = el('span', 'finfo'); t.append(el('span', 'fname', p.file.name), el('span', 'fsize', fmtSize(p.file.size))); chip.append(t);
      if (!uploading) {
        const x = el('button', 'icon-btn chip-x', '×'); x.setAttribute('aria-label', `Remover ${p.file.name}`);
        x.onclick = () => { if (p.url) URL.revokeObjectURL(p.url); pending.splice(i, 1); renderTray(); };
        chip.append(x);
      }
      tray.append(chip);
    });
    if (uploading) { const bar = el('div', 'upbar'); const fill = el('span'); fill.style.width = `${Math.round((progress || 0) * 100)}%`; bar.append(fill); tray.append(bar); }
  }
  function uploadPending() {
    return new Promise((resolve, reject) => {
      const fd = new FormData(); pending.forEach((p) => fd.append('files', p.file, p.file.name));
      const xhr = new XMLHttpRequest(); xhr.open('POST', '/api/upload');
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) renderTray(e.loaded / e.total); };
      xhr.onload = () => {
        let d = {}; try { d = JSON.parse(xhr.responseText); } catch {}
        if (xhr.status === 200) resolve(d.files.map((f) => f.id)); else reject(new Error(d.error || 'Não foi possível enviar os arquivos.'));
      };
      xhr.onerror = () => reject(new Error('A conexão caiu durante o envio. Tente de novo.'));
      xhr.send(fd);
    });
  }
  $('attachBtn').onclick = () => $('fileInput').click();
  $('fileInput').onchange = () => { addFiles([...$('fileInput').files]); $('fileInput').value = ''; };
  input.addEventListener('paste', (e) => { const f = [...(e.clipboardData?.files || [])]; if (f.length) { e.preventDefault(); addFiles(f); } });
  const tv = $('textView'); let dragDepth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  tv.addEventListener('dragenter', (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; $('dropZone').hidden = false; });
  tv.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  tv.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('dropZone').hidden = true; } });
  tv.addEventListener('drop', (e) => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth = 0; $('dropZone').hidden = true; addFiles([...e.dataTransfer.files]); });

  $('composer').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (uploading) return;
    const text = input.value.trim(); if (!text && !pending.length) return;
    const key = keyOf(S.serverId, S.channelId);
    let att = [];
    if (pending.length) {
      uploading = true; $('sendBtn').disabled = true; renderTray(0);
      try { att = await uploadPending(); }
      catch (err) { uploading = false; $('sendBtn').disabled = false; renderTray(); toast(err.message); return; }
      uploading = false; $('sendBtn').disabled = false;
    }
    socket.emit('message', { key, text, att }, (res) => { if (res?.error) toast(res.error); });
    pending.forEach((p) => p.url && URL.revokeObjectURL(p.url)); pending = []; renderTray();
    input.value = ''; autosize();
  });

  const typingNames = new Map();
  function renderTyping() {
    const names = [...typingNames.keys()];
    $('typing').textContent = !names.length ? '' : names.length === 1 ? `${names[0]} está digitando…` : `${names.slice(0, 3).join(', ')} estão digitando…`;
  }
  socket.on('typing', ({ key, uid }) => {
    if (key !== keyOf(S.serverId, S.channelId)) return;
    const name = userName(uid);
    clearTimeout(typingNames.get(name)); typingNames.set(name, setTimeout(() => { typingNames.delete(name); renderTyping(); }, 3500)); renderTyping();
  });

  // ---------- preferências de áudio ----------
  const CFG_KEY = 'junta:audio';
  const cfg = Object.assign(
    { mode: 'vad', pttCode: 'KeyV', pttLabel: 'V', noise: 'ai', music: false, deviceId: '', volumes: {}, sounds: true, soundVol: 60, screenPreset: 'sharp' },
    (() => { try { return JSON.parse(localStorage.getItem(CFG_KEY)) || {}; } catch { return {}; } })()
  );
  const saveCfg = () => { try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch {} };
  const VOICE_KBPS = 64, MUSIC_KBPS = 128, SCREEN_AUDIO_KBPS = 128;

  // ---------- motor de áudio: microfone → (RNNoise) → portão (mudo/PTT) → envio ----------
  // A faixa enviada aos outros é sempre a mesma (saída do grafo), então trocar filtro,
  // modo música ou microfone não exige renegociar as conexões.
  const A = { ctx: null, raw: null, src: null, rn: null, gate: null, dest: null, out: null, rnBinary: null, rnLib: null, pttDown: false };

  function ensureCtx() {
    if (!A.ctx) {
      A.ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000, latencyHint: 'interactive' });
      A.gate = A.ctx.createGain(); A.gate.gain.value = 0;
      A.dest = A.ctx.createMediaStreamDestination(); A.dest.channelCount = 2;
      A.gate.connect(A.dest);
      A.out = A.dest.stream;
    }
    if (A.ctx.state === 'suspended') A.ctx.resume().catch(() => {});
    return A.ctx;
  }

  async function loadRnnoise() {
    if (A.rnBinary) return;
    A.rnLib ||= await import('/vendor/nsup/index.js');
    await A.ctx.audioWorklet.addModule('/vendor/nsup/rnnoise/workletProcessor.js');
    A.rnBinary = await A.rnLib.loadRnnoise({ url: '/vendor/nsup/rnnoise.wasm', simdUrl: '/vendor/nsup/rnnoise_simd.wasm' });
  }

  // (Re)abre o microfone com as restrições certas para o modo atual
  async function openMic() {
    ensureCtx();
    const music = cfg.music;
    const constraints = {
      echoCancellation: !music,
      autoGainControl: !music,
      noiseSuppression: !music && cfg.noise === 'browser', // com IA, o filtro do navegador fica desligado para não processar duas vezes
      channelCount: music ? { ideal: 2 } : { ideal: 1 },
      sampleRate: { ideal: 48000 },
      sampleSize: { ideal: 16 },
      latency: { ideal: 0.01 },
    };
    if (cfg.deviceId) constraints.deviceId = { exact: cfg.deviceId };
    let raw;
    try {
      raw = await navigator.mediaDevices.getUserMedia({ audio: constraints });
    } catch (e) {
      if (cfg.deviceId) { cfg.deviceId = ''; saveCfg(); return openMic(); } // microfone salvo sumiu: volta ao padrão
      throw e;
    }
    A.raw?.getTracks().forEach((t) => t.stop());
    A.raw = raw;
    await rebuildGraph();
  }

  async function rebuildGraph() {
    try { A.src?.disconnect(); } catch {}
    if (A.rn) { try { A.rn.disconnect(); A.rn.destroy(); } catch {} A.rn = null; }
    if (!A.raw) return;
    A.src = A.ctx.createMediaStreamSource(A.raw);
    let node = A.src;
    if (cfg.noise === 'ai' && !cfg.music) {
      try {
        await loadRnnoise();
        A.rn = new A.rnLib.RnnoiseWorkletNode(A.ctx, { maxChannels: 2, wasmBinary: A.rnBinary });
        A.src.connect(A.rn); node = A.rn;
      } catch (e) {
        console.warn('RNNoise indisponível', e);
        toast('A supressão por IA não carregou neste navegador. Usando o filtro do navegador.');
        cfg.noise = 'browser'; saveCfg(); syncSettingsUI();
        return openMic();
      }
    }
    node.connect(A.gate);
    updateGate();
  }

  function stopMic() {
    try { A.src?.disconnect(); } catch {}
    if (A.rn) { try { A.rn.disconnect(); A.rn.destroy(); } catch {} A.rn = null; }
    A.raw?.getTracks().forEach((t) => t.stop()); A.raw = null; A.src = null;
    A.pttDown = false; updateGate();
  }

  const micOpen = () => !!A.raw && !S.muted && (cfg.mode === 'vad' || A.pttDown);
  function updateGate() {
    if (A.gate) A.gate.gain.setTargetAtTime(micOpen() ? 1 : 0, A.ctx.currentTime, 0.012); // rampa curta evita estalos
    $('pttBtn').classList.toggle('down', A.pttDown && !S.muted);
  }

  // ---------- Opus: qualidade de envio ----------
  // O codificador segue o que o outro lado diz aceitar, então ajustamos o SDP recebido.
  function tuneOpus(sdp) {
    const m = sdp.match(/a=rtpmap:(\d+) opus\/48000/i);
    if (!m) return sdp;
    const pt = m[1];
    const want = { minptime: 10, useinbandfec: 1, usedtx: 0, stereo: 1, 'sprop-stereo': 1, maxaveragebitrate: MUSIC_KBPS * 1000, maxplaybackrate: 48000 };
    return sdp.replace(new RegExp(`a=fmtp:${pt} ([^\\r\\n]*)`, 'g'), (_, params) => {
      const o = {};
      params.split(';').forEach((kv) => { const [k, v] = kv.split('='); if (k && k.trim()) o[k.trim()] = v; });
      Object.assign(o, want);
      return `a=fmtp:${pt} ` + Object.entries(o).map(([k, v]) => `${k}=${v}`).join(';');
    });
  }

  // ---------- transmissão de tela: predefinições, banda e codecs ----------
  const PRESETS = {
    sharp:    { label: 'Nitidez',     w: 2560, h: 1440, fps: 30, kbps: 8000, hint: 'detail', degrade: 'maintain-resolution', codecs: ['AV1', 'VP9', 'H264', 'VP8'] },
    motion:   { label: 'Movimento',   w: 1920, h: 1080, fps: 60, kbps: 8000, hint: 'motion', degrade: 'maintain-framerate',  codecs: ['H264', 'VP9', 'AV1', 'VP8'] },
    balanced: { label: 'Equilibrado', w: 1920, h: 1080, fps: 30, kbps: 5000, hint: 'detail', degrade: 'balanced',            codecs: ['VP9', 'AV1', 'H264', 'VP8'] },
  };
  if (!PRESETS[cfg.screenPreset]) cfg.screenPreset = 'sharp';
  const preset = () => PRESETS[S.screenPreset || cfg.screenPreset];

  // Começar já com banda alta (sem os ~15 s de imagem borrada do início) e permitir mais que o teto padrão.
  // Assim como no Opus, o lado que envia segue o que está no SDP recebido.
  const VIDEO_BW = 'x-google-start-bitrate=2500;x-google-min-bitrate=300;x-google-max-bitrate=12000';
  function tuneVideo(sdp) {
    const parts = sdp.split(/\r\n(?=m=)/);
    return parts.map((sec) => {
      if (!sec.startsWith('m=video')) return sec;
      const lines = sec.split('\r\n');
      const pts = [];
      for (const l of lines) { const m = l.match(/^a=rtpmap:(\d+) (VP8|VP9|AV1|H264)\/90000/i); if (m) pts.push(m[1]); }
      for (const pt of pts) {
        const fi = lines.findIndex((l) => l.startsWith(`a=fmtp:${pt} `));
        if (fi >= 0) { if (!lines[fi].includes('x-google-start-bitrate')) lines[fi] += ';' + VIDEO_BW; }
        else { const ri = lines.findIndex((l) => l.startsWith(`a=rtpmap:${pt} `)); lines.splice(ri + 1, 0, `a=fmtp:${pt} ${VIDEO_BW}`); }
      }
      return lines.join('\r\n');
    }).join('\r\n');
  }

  // Ordena os codecs da transmissão: o melhor que os dois lados suportam vence
  function preferCodecs(pc, sender) {
    try {
      const tr = pc.getTransceivers().find((t) => t.sender === sender);
      const caps = RTCRtpReceiver.getCapabilities?.('video')?.codecs;
      if (!tr?.setCodecPreferences || !caps) return;
      const order = preset().codecs;
      const rank = (c) => { const i = order.indexOf(c.mimeType.split('/')[1].toUpperCase()); return i < 0 ? 99 : i; };
      const main = caps.filter((c) => rank(c) < 99);
      const extra = caps.filter((c) => rank(c) === 99); // rtx, red, ulpfec: mantidos
      // dentro do mesmo codec, VP9 perfil 0 e H264 "high" primeiro (mais compatível / mais eficiente)
      const sub = (c) => (/profile-id=0/.test(c.sdpFmtpLine || '') || /profile-level-id=64/.test(c.sdpFmtpLine || '') ? 0 : 1);
      main.sort((a, b) => rank(a) - rank(b) || sub(a) - sub(b));
      tr.setCodecPreferences([...main, ...extra]);
    } catch (e) { console.warn('preferência de codec ignorada', e); }
  }

  async function tuneSenders(p) {
    for (const s of p.pc.getSenders()) {
      if (!s.track) continue;
      const isScreen = (p.screenSenders || []).includes(s);
      try {
        const prm = s.getParameters();
        if (!prm.encodings || !prm.encodings.length) continue; // ainda não negociado
        const enc = prm.encodings[0];
        if (s.track.kind === 'audio') {
          enc.maxBitrate = (isScreen ? SCREEN_AUDIO_KBPS : cfg.music ? MUSIC_KBPS : VOICE_KBPS) * 1000;
          enc.priority = isScreen ? 'medium' : 'high';
          enc.networkPriority = isScreen ? 'medium' : 'high';
        } else {
          const pr = preset();
          enc.maxBitrate = pr.kbps * 1000; enc.maxFramerate = pr.fps; enc.scaleResolutionDownBy = 1;
          enc.priority = 'medium'; enc.networkPriority = 'medium'; // a voz continua com prioridade alta
          prm.degradationPreference = pr.degrade;
        }
        await s.setParameters(prm);
      } catch {}
    }
  }
  const tuneAllSenders = () => Object.values(S.peers).forEach(tuneSenders);

  // ---------- volume por pessoa ----------
  const volKey = (kind, uid) => `${kind}:u${uid}`;
  const getVol = (kind, name) => cfg.volumes[volKey(kind, name)] ?? 100;
  function setVol(kind, uid, v) {
    const name = uid;
    if (v === 100) delete cfg.volumes[volKey(kind, name)]; else cfg.volumes[volKey(kind, name)] = v;
    saveCfg();
    for (const [id, p] of Object.entries(S.peers)) if (memberUid(id) === uid) applyVolumes(p, uid);
  }
  function memberUid(id) { return (S.voice[S.voiceKey] || []).find((m) => m.id === id)?.uid; }
  function applyVolumes(p, name) {
    if (!name) return;
    for (const m of Object.values(p.media)) {
      if (!m.audio) continue;
      const isScreen = m.stream.getVideoTracks().length > 0;
      m.audio.volume = Math.min(1, getVol(isScreen ? 'screen' : 'voice', name) / 100);
    }
  }

  // ---------- voz: palco ----------
  let openVol = null; // "voice:<id>" ou "screen:<id>" com o controle aberto

  function renderStage() {
    const c = currentChannel(); if (!c || c.type !== 'voice') return;
    const key = keyOf(S.serverId, S.channelId);
    const inThis = S.voiceKey === key;
    const members = S.voice[key] || [];
    const stage = $('stage');
    $('controls').hidden = !inThis;
    $('voiceEmpty').hidden = inThis;
    if (!inThis) {
      stage.replaceChildren();
      $('voiceEmptyTitle').textContent = c.name;
      $('voiceEmptyText').textContent = members.length
        ? `${members.map((m) => m.name).join(', ')} ${members.length === 1 ? 'está' : 'estão'} aqui.` + (members.some((m) => m.sharing) ? ' Tem tela sendo compartilhada.' : '')
        : 'Ninguém por aqui ainda. Entre para falar e compartilhar sua tela.';
      $('joinVoiceBtn').textContent = S.voiceKey ? 'Mudar para esta sala' : 'Entrar na sala';
      return;
    }
    const screens = members.filter((m) => m.sharing).map((m) => {
      const isMe = m.id === S.me.id;
      return screenTile(m, isMe ? S.screen : S.peers[m.id]?.screenStream, isMe);
    });
    const peopleTiles = members.map((m) => personTile(m));
    stage.replaceChildren();
    if (screens.length) {
      stage.classList.add('has-screen');
      const sc = el('div', 'screens'); sc.append(...screens);
      const strip = el('div', 'people-strip'); strip.append(...peopleTiles);
      stage.append(sc, strip);
    } else {
      stage.classList.remove('has-screen');
      stage.append(...peopleTiles);
    }
  }

  function volPanel(kind, m) {
    const box = el('div', 'vol');
    box.onclick = (e) => e.stopPropagation();
    const id = `vol-${kind}-${m.id}`;
    const lab = el('label'); lab.htmlFor = id;
    const val = el('span', null, getVol(kind, m.uid) + '%');
    lab.append(el('span', null, kind === 'screen' ? 'Volume da transmissão' : `Volume de ${m.name}`), val);
    const r = document.createElement('input'); r.type = 'range'; r.min = 0; r.max = 100; r.step = 5; r.id = id; r.value = getVol(kind, m.uid);
    r.oninput = () => { const v = +r.value; val.textContent = v + '%'; setVol(kind, m.uid, v); };
    r.onchange = () => renderStage();
    box.append(lab, r);
    return box;
  }

  function personTile(m) {
    const isMe = m.id === S.me.id;
    const t = el('div', 'tile' + (isMe ? '' : ' person') + (S.speaking.has(m.id) ? ' speaking' : '')); t.dataset.pid = m.id;
    t.append(avatar(m.name, m.uid));
    const n = el('div', 'name'); n.append(el('span', null, m.name + (isMe ? ' (você)' : '')));
    if (m.muted) n.append(el('span', 'muted-ic', '✕'));
    if (!isMe && getVol('voice', m.uid) !== 100) n.append(el('span', 'lowvol', getVol('voice', m.uid) + '%'));
    t.append(n);
    if (!isMe) {
      t.tabIndex = 0; t.title = 'Ajustar volume'; t.setAttribute('aria-label', `${m.name}. Ajustar volume`);
      const k = 'voice:' + m.id;
      const toggle = () => { openVol = openVol === k ? null : k; renderStage(); };
      t.onclick = toggle; t.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } };
      if (openVol === k) t.append(volPanel('voice', m));
    }
    return t;
  }

  function screenTile(m, stream, isMe) {
    const t = el('div', 'tile screen'); t.tabIndex = 0;
    t.setAttribute('aria-label', `Tela de ${m.name}`);
    t.append(el('span', 'tag live-tag', 'AO VIVO'));
    if (stream) {
      const v = document.createElement('video'); v.autoplay = true; v.playsInline = true; v.muted = true; // o áudio da tela toca num elemento separado
      const q = el('span', 'qbadge'); q.hidden = true; t.append(q);
      v.srcObject = stream; t.append(v);
    } else {
      t.append(el('div', 'waiting', 'Conectando à transmissão…'));
    }
    const fs = el('button', 'icon-btn fs'); fs.title = 'Tela cheia'; fs.setAttribute('aria-label', 'Tela cheia');
    fs.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>';
    const goFs = () => (document.fullscreenElement ? document.exitFullscreen() : t.requestFullscreen?.())?.catch?.(() => {});
    fs.onclick = (e) => { e.stopPropagation(); goFs(); };
    t.ondblclick = goFs;
    const n = el('div', 'name'); n.append(el('span', null, isMe ? 'Sua tela' : `Tela de ${m.name}`)); t.append(n, fs);
    if (!isMe && stream && stream.getAudioTracks().length) {
      const k = 'screen:' + m.id;
      const vb = el('button', 'icon-btn vol-btn'); vb.title = 'Volume da transmissão'; vb.setAttribute('aria-label', 'Volume da transmissão');
      vb.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05A4.5 4.5 0 0 0 16.5 12zM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06a9 9 0 0 0 0-17.54z"/></svg>';
      vb.onclick = (e) => { e.stopPropagation(); openVol = openVol === k ? null : k; renderStage(); };
      t.append(vb);
      if (openVol === k) t.append(volPanel('screen', m));
    }
    return t;
  }

  // Atualiza o selo "1440p · 30 fps" das telas a cada segundo
  setInterval(() => {
    for (const v of document.querySelectorAll('.tile.screen video')) {
      const q = v.parentElement.querySelector('.qbadge'); if (!q || !v.videoHeight) continue;
      const frames = v.getVideoPlaybackQuality?.().totalVideoFrames ?? 0;
      const now = performance.now();
      const fps = v._lf != null ? Math.round(((frames - v._lf) * 1000) / (now - v._lt)) : null;
      v._lf = frames; v._lt = now;
      q.textContent = `${v.videoHeight}p` + (fps != null ? ` · ${fps} fps` : ''); q.hidden = false;
    }
  }, 1000);

  // ---------- voz: entrar, sair, mudo, apertar para falar ----------
  $('joinVoiceBtn').onclick = () => joinVoice(keyOf(S.serverId, S.channelId));
  $('leaveBtn').onclick = leaveVoice;
  $('voiceBarLeave').onclick = leaveVoice;
  $('muteBtn').onclick = toggleMute;
  $('shareBtn').onclick = toggleScreen;

  async function joinVoice(key) {
    if (S.voiceKey) leaveVoice();
    ensureCtx();
    try { await openMic(); }
    catch { stopMic(); toast('Sem acesso ao microfone: você entra só para ouvir e ver telas.'); }
    S.muted = !A.raw; applyMute();
    refreshDevices();
    watchSpeaking(S.me.id, A.out);
    socket.emit('voice-join', key, (peerIds) => {
      S.voiceKey = key;
      roomBaseline = null; // a primeira lista da sala só marca quem já estava lá
      playCue('selfJoin');
      for (const id of peerIds) getPeer(id); // quem chega inicia as conexões
      if (S.muted) socket.emit('voice-update', { muted: true });
      renderChannels(); renderStage();
    });
  }

  function leaveVoice() {
    if (!S.voiceKey) return;
    stopScreen(true);
    for (const id of Object.keys(S.peers)) closePeer(id);
    stopMic(); stopAllMeters();
    socket.emit('voice-leave');
    S.voiceKey = null; openVol = null; roomBaseline = null;
    playCue('selfLeave');
    renderChannels(); renderStage();
  }

  // ---------- avisos de entrada e saída na sala ----------
  // Sons sintetizados na hora (sem arquivos): sobe ao entrar, desce ao sair.
  const CUES = {
    join:      [[523.25, 0], [783.99, 0.09]],
    leave:     [[783.99, 0], [523.25, 0.09]],
    selfJoin:  [[523.25, 0], [659.25, 0.08], [783.99, 0.16]],
    selfLeave: [[783.99, 0], [659.25, 0.08], [523.25, 0.16]],
    stream:    [[880, 0], [880, 0.12], [1174.66, 0.24]],
  };
  function playCue(name) {
    if (!cfg.sounds || myStatus() === 'dnd') return;
    const ctx = A.ctx; if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const out = ctx.createGain(); out.gain.value = (cfg.soundVol / 100) * 0.22; out.connect(ctx.destination);
    const t0 = ctx.currentTime + 0.02;
    for (const [freq, at] of CUES[name]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = freq;
      // um pouco de 2º harmônico deixa o som menos "bipe"
      const o2 = ctx.createOscillator(), g2 = ctx.createGain(); o2.type = 'sine'; o2.frequency.value = freq * 2; g2.gain.value = 0.18;
      o2.connect(g2).connect(g); o.connect(g).connect(out);
      const t = t0 + at;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(1, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      o.start(t); o2.start(t); o.stop(t + 0.25); o2.stop(t + 0.25);
    }
    setTimeout(() => out.disconnect(), 1200);
  }

  let roomBaseline = null; // Map id -> membro, da última lista da minha sala
  function roomEvents(v) {
    if (!S.voiceKey) { roomBaseline = null; return; }
    const now = new Map((v[S.voiceKey] || []).map((m) => [m.id, m]));
    const prev = roomBaseline; roomBaseline = now;
    if (!prev) return;
    const names = (list) => list.map((m) => m.name).join(', ');
    const joined = [...now.values()].filter((m) => m.id !== S.me.id && !prev.has(m.id));
    const left = [...prev.values()].filter((m) => m.id !== S.me.id && !now.has(m.id));
    const streaming = [...now.values()].filter((m) => m.id !== S.me.id && m.sharing && prev.get(m.id) && !prev.get(m.id).sharing);
    if (joined.length) { playCue('join'); toast(`${names(joined)} ${joined.length > 1 ? 'entraram' : 'entrou'} na sala`); }
    if (left.length) { playCue('leave'); toast(`${names(left)} ${left.length > 1 ? 'saíram' : 'saiu'} da sala`); }
    if (streaming.length) { playCue('stream'); toast(`${names(streaming)} começou a transmitir a tela`); }
  }

  function applyMute() {
    $('muteBtn').setAttribute('aria-pressed', String(S.muted));
    $('muteBtn').title = S.muted ? 'Ativar microfone' : 'Silenciar';
    updateGate();
  }
  function toggleMute() {
    if (!A.raw) { toast('Nenhum microfone disponível. Verifique a permissão do navegador.'); return; }
    S.muted = !S.muted; applyMute(); socket.emit('voice-update', { muted: S.muted });
  }

  const typingTarget = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  function setPtt(down) {
    if (A.pttDown === down) return;
    A.pttDown = down; updateGate();
  }
  window.addEventListener('keydown', (e) => {
    if (capturingKey || cfg.mode !== 'ptt' || !S.voiceKey || e.code !== cfg.pttCode || typingTarget(e.target)) return;
    if (!$('settings').hidden || !$('modal').hidden) return;
    e.preventDefault(); if (!e.repeat) setPtt(true);
  });
  window.addEventListener('keyup', (e) => { if (e.code === cfg.pttCode) setPtt(false); });
  window.addEventListener('blur', () => setPtt(false)); // soltou a tecla com a janela fora de foco
  const pttBtn = $('pttBtn');
  pttBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); pttBtn.setPointerCapture?.(e.pointerId); setPtt(true); });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) pttBtn.addEventListener(ev, () => setPtt(false));
  pttBtn.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---------- configurações ----------
  let capturingKey = false;
  const keyName = (e) => (e.key === ' ' ? 'Espaço' : e.key.length === 1 ? e.key.toUpperCase() : e.code.replace(/^(Key|Digit)/, '').replace('Left', ' esq.').replace('Right', ' dir.'));

  function syncSettingsUI() {
    $('soundsOn').checked = cfg.sounds; $('soundVol').value = cfg.soundVol; $('soundVolVal').textContent = cfg.soundVol + '%';
    $('soundVolRow').hidden = !cfg.sounds;
    $(cfg.mode === 'ptt' ? 'inPtt' : 'inVad').checked = true;
    $({ ai: 'nsAi', browser: 'nsBrowser', off: 'nsOff' }[cfg.noise]).checked = true;
    $('musicMode').checked = cfg.music;
    for (const r of document.querySelectorAll('input[name=noise]')) r.disabled = cfg.music;
    $('pttRow').hidden = cfg.mode !== 'ptt';
    $('pttKeyBtn').textContent = cfg.pttLabel; $('pttKeyLabel').textContent = cfg.pttLabel;
    $('pttBtn').hidden = cfg.mode !== 'ptt';
    const ns = cfg.music ? 'sem filtros' : { ai: 'supressão por IA', browser: 'filtro do navegador', off: 'sem supressão' }[cfg.noise];
    $('qualityLine').textContent = `Envio: Opus ${cfg.music ? MUSIC_KBPS : VOICE_KBPS} kbps, ${cfg.music ? 'estéreo' : 'voz'}, 48 kHz, ${ns}, correção de perdas ligada.`;
  }

  async function refreshDevices() {
    try {
      const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
      const sel = $('micSelect'); sel.replaceChildren();
      const def = el('option', null, 'Padrão do sistema'); def.value = ''; sel.append(def);
      devs.filter((d) => d.deviceId && d.deviceId !== 'default').forEach((d, i) => {
        const o = el('option', null, d.label || `Microfone ${i + 1}`); o.value = d.deviceId; sel.append(o);
      });
      sel.value = devs.some((d) => d.deviceId === cfg.deviceId) ? cfg.deviceId : '';
    } catch {}
  }
  navigator.mediaDevices?.addEventListener?.('devicechange', refreshDevices);

  // aplica mudanças que exigem reabrir o microfone, se estiver numa sala
  async function reopenIfLive() {
    if (!S.voiceKey || !A.raw) return;
    try { await openMic(); } catch { toast('Não foi possível abrir esse microfone.'); }
  }

  $('settingsBtn').onclick = () => { syncSettingsUI(); refreshDevices(); $('settings').hidden = false; $('settingsClose').focus(); };
  $('settingsClose').onclick = () => { $('settings').hidden = true; capturingKey = false; };
  $('settings').addEventListener('click', (e) => { if (e.target === $('settings')) $('settingsClose').click(); });
  $('settings').addEventListener('keydown', (e) => { if (e.key === 'Escape' && !capturingKey) $('settingsClose').click(); });

  for (const r of document.querySelectorAll('input[name=inmode]')) r.onchange = () => {
    cfg.mode = r.value; saveCfg(); A.pttDown = false; syncSettingsUI(); updateGate();
  };
  for (const r of document.querySelectorAll('input[name=noise]')) r.onchange = async () => {
    cfg.noise = r.value; saveCfg(); syncSettingsUI(); await reopenIfLive();
  };
  $('soundsOn').onchange = () => { cfg.sounds = $('soundsOn').checked; saveCfg(); syncSettingsUI(); playCue('join'); };
  $('soundVol').oninput = () => { cfg.soundVol = +$('soundVol').value; saveCfg(); $('soundVolVal').textContent = cfg.soundVol + '%'; };
  $('soundVol').onchange = () => playCue('join');
  $('musicMode').onchange = async () => {
    cfg.music = $('musicMode').checked; saveCfg(); syncSettingsUI(); await reopenIfLive(); tuneAllSenders();
  };
  $('micSelect').onchange = async () => { cfg.deviceId = $('micSelect').value; saveCfg(); await reopenIfLive(); };
  $('pttKeyBtn').onclick = () => {
    capturingKey = true; $('pttKeyBtn').classList.add('listening'); $('pttKeyBtn').textContent = '…';
    $('pttHint').textContent = 'Aperte a tecla agora. Esc cancela.';
  };
  window.addEventListener('keydown', (e) => {
    if (!capturingKey) return;
    e.preventDefault(); e.stopPropagation();
    if (e.key !== 'Escape') { cfg.pttCode = e.code; cfg.pttLabel = keyName(e); saveCfg(); }
    capturingKey = false; $('pttKeyBtn').classList.remove('listening');
    $('pttHint').textContent = 'Funciona enquanto a aba do Junta estiver em foco.';
    syncSettingsUI();
  }, true);
  syncSettingsUI();

  // Clique em "Compartilhar tela": primeiro escolhe a predefinição, depois a tela
  function toggleScreen() {
    if (S.screen) { stopScreen(); return; }
    if (!navigator.mediaDevices?.getDisplayMedia) { toast('Este navegador não permite compartilhar tela. Use Chrome, Edge ou Firefox no computador.'); return; }
    const r = document.querySelector(`input[name=preset][value="${cfg.screenPreset}"]`); if (r) r.checked = true;
    $('shareModal').hidden = false; r?.focus();
  }
  $('shareCancel').onclick = () => { $('shareModal').hidden = true; };
  $('shareModal').addEventListener('keydown', (e) => { if (e.key === 'Escape') $('shareModal').hidden = true; });
  $('shareModal').addEventListener('click', (e) => { if (e.target === $('shareModal')) $('shareModal').hidden = true; });
  $('shareForm').addEventListener('submit', (e) => {
    e.preventDefault();
    cfg.screenPreset = document.querySelector('input[name=preset]:checked')?.value || 'sharp'; saveCfg();
    $('shareModal').hidden = true;
    startScreen(); // ainda dentro do clique: o navegador exige um gesto do usuário
  });

  async function startScreen() {
    S.screenPreset = cfg.screenPreset;
    const pr = preset();
    try {
      S.screen = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: pr.fps, max: pr.fps }, width: { ideal: pr.w, max: pr.w }, height: { ideal: pr.h, max: pr.h } },
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2, sampleRate: 48000 },
        systemAudio: 'include',
      });
    } catch { return; } // cancelou a escolha
    const vt = S.screen.getVideoTracks()[0];
    if (vt) { vt.contentHint = pr.hint; vt.onended = () => stopScreen(); }
    S.screen.getAudioTracks().forEach((t) => (t.contentHint = 'music'));
    for (const p of Object.values(S.peers)) addScreenTo(p);
    $('shareBtn').setAttribute('aria-pressed', 'true'); $('shareLabel').textContent = 'Parar transmissão';
    socket.emit('voice-update', { sharing: true });
    toast(`Transmitindo em ${pr.label}: até ${pr.h}p, ${pr.fps} fps.`);
  }

  function addScreenTo(p) {
    if (!S.screen) return;
    p.screenSenders = S.screen.getTracks().map((t) => p.pc.addTrack(t, S.screen));
    for (const snd of p.screenSenders) if (snd.track?.kind === 'video') preferCodecs(p.pc, snd);
  }

  function stopScreen(silent) {
    if (!S.screen) return;
    S.screen.getTracks().forEach((t) => t.stop());
    for (const p of Object.values(S.peers)) { (p.screenSenders || []).forEach((s) => { try { p.pc.removeTrack(s); } catch {} }); p.screenSenders = []; }
    S.screen = null; S.screenPreset = null;
    $('shareBtn').setAttribute('aria-pressed', 'false'); $('shareLabel').textContent = 'Compartilhar tela';
    if (!silent) socket.emit('voice-update', { sharing: false });
  }

  // ---------- WebRTC (malha, negociação "perfect negotiation") ----------
  function getPeer(id) {
    if (S.peers[id]) return S.peers[id];
    const pc = new RTCPeerConnection(ICE);
    const p = { pc, polite: S.me.id < id, makingOffer: false, ignoreOffer: false, screenSenders: [], media: {}, screenStream: null };
    S.peers[id] = p;
    if (A.out) A.out.getAudioTracks().forEach((t) => { t.contentHint = 'speech'; pc.addTrack(t, A.out); });
    addScreenTo(p);

    pc.onnegotiationneeded = async () => {
      try { p.makingOffer = true; await pc.setLocalDescription(); socket.emit('signal', { to: id, data: { description: pc.localDescription } }); }
      catch (e) { console.error(e); } finally { p.makingOffer = false; }
    };
    pc.onicecandidate = ({ candidate }) => { if (candidate) socket.emit('signal', { to: id, data: { candidate } }); };
    pc.oniceconnectionstatechange = () => { if (pc.iceConnectionState === 'failed') pc.restartIce(); };
    pc.onconnectionstatechange = () => { if (pc.connectionState === 'connected') tuneSenders(p); };
    pc.ontrack = ({ track, streams }) => {
      const stream = streams[0] || new MediaStream([track]);
      handleRemoteStream(id, p, stream);
      stream.onaddtrack = () => handleRemoteStream(id, p, stream);
      stream.onremovetrack = () => handleRemoteStream(id, p, stream);
      track.onunmute = () => handleRemoteStream(id, p, stream);
    };
    return p;
  }

  // Áudio (voz ou som da tela) toca num <audio>; vídeo vai para o bloco da tela.
  function handleRemoteStream(id, p, stream) {
    const hasVideo = stream.getVideoTracks().some((t) => t.readyState === 'live');
    const hasAudio = stream.getAudioTracks().length > 0;
    const m = (p.media[stream.id] ||= { stream, audio: null, metered: false });
    if (hasAudio && !m.audio) {
      const a = new Audio(); a.autoplay = true; a.srcObject = stream; a.play().catch(() => armAutoplay(a));
      m.audio = a;
    }
    if (hasAudio && !hasVideo && !m.metered) { m.metered = true; watchSpeaking(id, stream); }
    applyVolumes(p, memberUid(id));
    if (hasVideo) { if (p.screenStream !== stream) { p.screenStream = stream; renderStage(); } }
    else if (p.screenStream === stream) { p.screenStream = null; renderStage(); }
  }

  function armAutoplay(a) {
    toast('Clique em qualquer lugar para ativar o áudio da sala.');
    const go = () => { a.play().catch(() => {}); document.removeEventListener('click', go); };
    document.addEventListener('click', go);
  }

  function closePeer(id) {
    const p = S.peers[id]; if (!p) return;
    try { p.pc.close(); } catch {}
    for (const m of Object.values(p.media)) { if (m.audio) { m.audio.pause(); m.audio.srcObject = null; } }
    stopMeter(id);
    delete S.peers[id];
  }

  socket.on('signal', async ({ from, data }) => {
    if (!S.voiceKey) return;
    const p = getPeer(from); const pc = p.pc;
    try {
      if (data.description) {
        const d = data.description;
        const collision = d.type === 'offer' && (p.makingOffer || pc.signalingState !== 'stable');
        p.ignoreOffer = !p.polite && collision;
        if (p.ignoreOffer) return;
        await pc.setRemoteDescription({ type: d.type, sdp: tuneVideo(tuneOpus(d.sdp)) });
        if (d.type === 'offer') { await pc.setLocalDescription(); socket.emit('signal', { to: from, data: { description: pc.localDescription } }); }
        tuneSenders(p);
      } else if (data.candidate) {
        try { await pc.addIceCandidate(data.candidate); } catch (e) { if (!p.ignoreOffer) console.warn(e); }
      }
    } catch (e) { console.error(e); }
  });

  socket.on('peer-left', (id) => { closePeer(id); renderStage(); });

  // ---------- indicador de fala ----------
  const meters = {};
  function watchSpeaking(id, stream) {
    try {
      const ctx = ensureCtx();
      const src = ctx.createMediaStreamSource(stream);
      const an = ctx.createAnalyser(); an.fftSize = 512; src.connect(an);
      const buf = new Uint8Array(an.fftSize); let hold = 0;
      stopMeter(id);
      meters[id] = setInterval(() => {
        an.getByteTimeDomainData(buf);
        let sum = 0; for (const v of buf) { const x = (v - 128) / 128; sum += x * x; }
        const loud = Math.sqrt(sum / buf.length) > 0.03;
        hold = loud ? 4 : Math.max(0, hold - 1);
        const was = S.speaking.has(id), now = hold > 0;
        if (was !== now) { now ? S.speaking.add(id) : S.speaking.delete(id); document.querySelectorAll(`.tile[data-pid="${CSS.escape(id)}"]`).forEach((t) => t.classList.toggle('speaking', now)); }
      }, 100);
    } catch {}
  }
  function stopMeter(id) { clearInterval(meters[id]); delete meters[id]; S.speaking.delete(id); }
  function stopAllMeters() { Object.keys(meters).forEach(stopMeter); }

  // ---------- eventos do servidor ----------
  socket.on('servers', (servers) => {
    S.servers = servers; renderRail();
    if (!currentServer()) { selectServer(S.servers[0].id); return; }
    if (!currentChannel()) { toast('O canal que você estava foi apagado.'); selectServer(S.serverId); return; }
    renderChannels();
  });
  socket.on('voice-kicked', () => { if (S.voiceKey) leaveVoice(); });

  socket.on('voice-state', (v) => {
    roomEvents(v);
    S.voice = v;
    // remove tela de quem parou de transmitir
    const mine = S.voiceKey ? v[S.voiceKey] || [] : [];
    for (const m of mine) { const p = S.peers[m.id]; if (p && !m.sharing && p.screenStream) p.screenStream = null; }
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
    applyPresence(d);
    $('addServerBtn').hidden = !isOwner();
  }
  function start() {
    socket.emit('hello', helloPayload(), (d) => {
      afterHello(d);
      const last = (localStorage.getItem('junta:last') || '').split('/');
      const s = d.servers.find((x) => x.id === last[0]);
      if (s && s.channels.some((c) => c.id === last[1])) { S.serverId = s.id; selectChannel(last[1]); }
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
      if (S.channelId) selectChannel(S.channelId);
      if (wasIn) { stopScreen(true); stopMic(); stopAllMeters(); toast('Conexão restabelecida. Entre de novo na sala de voz.'); renderChannels(); renderStage(); }
    });
  });
  socket.on('connect_error', (err) => {
    if (err?.message === 'unauthorized') { socket.disconnect(); showAuth('Sua sessão expirou. Entre de novo.'); }
  });

  // ---------- cartão de perfil ----------
  const fmtMonth = (ts) => new Date(ts).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' });
  // monta o cartão a partir de um "perfil" (o real ou o rascunho do editor)
  function buildCard(u, { serverName, nick, avatarSrc } = {}) {
    const shown = nick || u.name;
    const card = el('div', 'card-inner');
    const banner = el('div', 'card-banner'); banner.style.background = u.color || colorFor(u.name); card.append(banner);
    const av = el('div', 'avatar card-av');
    if (avatarSrc) { const im = el('img'); im.src = avatarSrc; im.alt = ''; av.append(im); av.classList.add('has-img'); }
    else { av.textContent = initials(shown); av.style.background = u.color || colorFor(u.name); }
    card.append(av);
    const body = el('div', 'card-body');
    const h = el('h4', 'card-name', shown);
    if (u.role === 'owner') { const c = el('span', 'crown', '★'); c.title = 'Dono do Junta'; h.append(c); }
    body.append(h);
    const sub = el('div', 'card-sub'); sub.append(el('span', null, '@' + (u.username || 'usuario')));
    if (u.pronouns) sub.append(el('span', 'dotsep', u.pronouns));
    body.append(sub);
    if (u.statusText) body.append(el('div', 'card-status', u.statusText));
    const box = el('div', 'card-box');
    if (u.bio) { box.append(el('div', 'lbl', 'Sobre mim')); box.append(el('p', 'card-bio', u.bio)); }
    if (nick && nick !== u.name) { box.append(el('div', 'lbl', 'Nome de exibição')); box.append(el('p', null, u.name)); }
    if (u.created) { box.append(el('div', 'lbl', 'Membro desde')); box.append(el('p', null, fmtMonth(u.created))); }
    if (box.childNodes.length) body.append(box);
    card.append(body);
    return card;
  }

  let cardUid = null, cardAnchor = null;
  function openCard(uid, anchor) {
    const u = S.users.get(uid); if (!u) return;
    cardUid = uid; cardAnchor = anchor;
    const pc = $('pcard'); pc.replaceChildren();
    pc.append(buildCard(u, { serverName: currentServer()?.name, nick: S.nicks?.[uid]?.[S.serverId], avatarSrc: avatarUrl(u) }));
    if (uid === S.me.uid) {
      const b = el('button', 'primary card-edit', 'Editar perfil'); b.type = 'button';
      b.onclick = () => { closeCard(); openProfileEditor(); };
      pc.querySelector('.card-body').append(b);
    }
    pc.hidden = false;
    // posiciona ao lado de quem foi clicado, sem sair da tela
    const r = anchor?.getBoundingClientRect?.();
    const W = pc.offsetWidth, H = pc.offsetHeight, vw = innerWidth, vh = innerHeight, m = 12;
    if (!r || vw < 600) { pc.classList.add('sheet'); pc.style.left = ''; pc.style.top = ''; }
    else {
      pc.classList.remove('sheet');
      let left = r.left - W - m; // à esquerda (lista de membros)
      if (left < m) left = Math.min(r.right + m, vw - W - m); // à direita (mensagens)
      const top = Math.max(m, Math.min(r.top, vh - H - m));
      pc.style.left = left + 'px'; pc.style.top = top + 'px';
    }
    pc.querySelector('button')?.focus({ preventScroll: true });
  }
  function closeCard() { $('pcard').hidden = true; cardUid = null; }
  document.addEventListener('mousedown', (e) => {
    if ($('pcard').hidden || $('pcard').contains(e.target) || cardAnchor?.contains?.(e.target)) return;
    closeCard();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('pcard').hidden) closeCard(); });

  // ---------- editor de perfil ----------
  const PROFILE_COLORS = ['#f0a43a', '#e5534b', '#e88aa8', '#b49cf0', '#6cb4ee', '#5fcfc3', '#46c28a', '#e5c15a', '#8c9c98'];
  let draft = null; // { color, avatar: 'keep' | 'remove' | Blob, previewUrl }
  const crop = { img: null, base: 1, zoom: 1, x: 0, y: 0, size: 200 };

  function openProfileEditor() {
    const u = S.users.get(S.me.uid); if (!u) return;
    draft = { color: u.color, avatar: 'keep', previewUrl: avatarUrl(u) };
    $('pfDisplay').value = u.name; $('pfPronouns').value = u.pronouns || ''; $('pfStatus').value = u.statusText || ''; $('pfBio').value = u.bio || '';
    $('pfNick').value = S.nicks?.[u.id]?.[S.serverId] || '';
    $('pfNickLbl').textContent = `Apelido em ${currentServer()?.name || 'este servidor'}`;
    $('cropper').hidden = true; $('pfError').hidden = true;
    renderSwatches(); updateEditor();
    $('profileModal').hidden = false; $('pfDisplay').focus();
  }
  function renderSwatches() {
    const box = $('pfSwatches'); box.replaceChildren();
    const auto = el('button', 'swatch auto' + (!draft.color ? ' on' : ''), 'Auto'); auto.type = 'button'; auto.title = 'Cor automática';
    auto.onclick = () => { draft.color = null; renderSwatches(); updateEditor(); }; box.append(auto);
    for (const c of PROFILE_COLORS) {
      const b = el('button', 'swatch' + (draft.color === c ? ' on' : '')); b.type = 'button'; b.style.background = c; b.setAttribute('aria-label', `Cor ${c}`);
      b.onclick = () => { draft.color = c; renderSwatches(); updateEditor(); }; box.append(b);
    }
    const custom = el('label', 'swatch custom' + (draft.color && !PROFILE_COLORS.includes(draft.color) ? ' on' : '')); custom.title = 'Outra cor';
    if (draft.color && !PROFILE_COLORS.includes(draft.color)) custom.style.background = draft.color;
    const inp = el('input'); inp.type = 'color'; inp.value = draft.color || '#f0a43a'; inp.setAttribute('aria-label', 'Escolher outra cor');
    inp.oninput = () => { draft.color = inp.value; custom.style.background = inp.value; updateEditor(); };
    inp.onchange = () => renderSwatches();
    custom.append('+', inp); box.append(custom);
  }
  function updateEditor() {
    const u = S.users.get(S.me.uid);
    const d = { ...u, name: $('pfDisplay').value.trim() || u.name, pronouns: $('pfPronouns').value.trim(), statusText: $('pfStatus').value.trim(), bio: $('pfBio').value.trim(), color: draft.color };
    $('pfBioCount').textContent = `${$('pfBio').value.length}/190`;
    $('pfPreview').replaceChildren(buildCard(d, { serverName: currentServer()?.name, nick: $('pfNick').value.trim(), avatarSrc: draft.previewUrl }));
    $('avatarRemove').hidden = !draft.previewUrl;
  }
  for (const id of ['pfDisplay', 'pfNick', 'pfPronouns', 'pfStatus', 'pfBio']) $(id).addEventListener('input', updateEditor);

  // foto: escolher, enquadrar (arrastar + zoom) e recortar em 256×256 no próprio navegador
  $('avatarPick').onclick = () => $('avatarFile').click();
  $('avatarFile').onchange = () => {
    const f = $('avatarFile').files[0]; $('avatarFile').value = '';
    if (!f) return;
    if (!/^image\//.test(f.type)) { showPfError('Escolha um arquivo de imagem.'); return; }
    if (f.size > 15 * 1048576) { showPfError('Essa imagem é muito grande (máximo 15 MB).'); return; }
    const img = new Image();
    img.onload = () => {
      crop.img = img; crop.base = Math.max(crop.size / img.naturalWidth, crop.size / img.naturalHeight);
      crop.zoom = 1; crop.x = 0; crop.y = 0; $('cropZoom').value = 1;
      $('cropImg').src = img.src; $('cropper').hidden = false; applyCrop();
    };
    img.onerror = () => showPfError('Não consegui abrir essa imagem.');
    img.src = URL.createObjectURL(f);
  };
  function clampCrop() {
    const s = crop.base * crop.zoom, w = crop.img.naturalWidth * s, h = crop.img.naturalHeight * s;
    const mx = Math.max(0, (w - crop.size) / 2), my = Math.max(0, (h - crop.size) / 2);
    crop.x = Math.max(-mx, Math.min(mx, crop.x)); crop.y = Math.max(-my, Math.min(my, crop.y));
  }
  let cropTimer = null;
  function applyCrop() {
    clampCrop();
    const s = crop.base * crop.zoom, im = $('cropImg');
    im.style.width = crop.img.naturalWidth * s + 'px'; im.style.height = crop.img.naturalHeight * s + 'px';
    im.style.transform = `translate(calc(-50% + ${crop.x}px), calc(-50% + ${crop.y}px))`;
    clearTimeout(cropTimer); cropTimer = setTimeout(exportCrop, 120); // atualiza a prévia sem travar o arraste
  }
  function exportCrop() {
    const out = 256, k = out / crop.size, s = crop.base * crop.zoom;
    const cv = document.createElement('canvas'); cv.width = cv.height = out;
    const g = cv.getContext('2d'); g.imageSmoothingQuality = 'high';
    const w = crop.img.naturalWidth * s, h = crop.img.naturalHeight * s;
    const left = crop.size / 2 - w / 2 + crop.x, top = crop.size / 2 - h / 2 + crop.y;
    g.drawImage(crop.img, left * k, top * k, w * k, h * k);
    cv.toBlob((b) => {
      if (!b) return;
      if (draft.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(draft.previewUrl);
      draft.avatar = b; draft.previewUrl = URL.createObjectURL(b); updateEditor();
    }, 'image/webp', 0.9);
  }
  $('cropZoom').oninput = () => { crop.zoom = +$('cropZoom').value; applyCrop(); };
  {
    const view = $('cropView'); let drag = null;
    view.addEventListener('pointerdown', (e) => { if (!crop.img) return; drag = { x: e.clientX - crop.x, y: e.clientY - crop.y }; view.setPointerCapture(e.pointerId); });
    view.addEventListener('pointermove', (e) => { if (!drag) return; crop.x = e.clientX - drag.x; crop.y = e.clientY - drag.y; applyCrop(); });
    for (const ev of ['pointerup', 'pointercancel']) view.addEventListener(ev, () => { drag = null; });
    view.addEventListener('wheel', (e) => { if (!crop.img) return; e.preventDefault(); crop.zoom = Math.max(1, Math.min(4, crop.zoom - e.deltaY * 0.002)); $('cropZoom').value = crop.zoom; applyCrop(); }, { passive: false });
    view.addEventListener('keydown', (e) => {
      const d = { ArrowLeft: [8, 0], ArrowRight: [-8, 0], ArrowUp: [0, 8], ArrowDown: [0, -8] }[e.key];
      if (d && crop.img) { e.preventDefault(); crop.x += d[0]; crop.y += d[1]; applyCrop(); }
    });
  }
  $('avatarRemove').onclick = () => {
    if (draft.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(draft.previewUrl);
    draft.avatar = 'remove'; draft.previewUrl = null; crop.img = null; $('cropper').hidden = true; updateEditor();
  };
  function showPfError(msg) { $('pfError').textContent = msg; $('pfError').hidden = false; }
  function closeProfileEditor() { $('profileModal').hidden = true; crop.img = null; }
  $('pfCancel').onclick = closeProfileEditor;
  $('profileModal').addEventListener('keydown', (e) => { if (e.key === 'Escape') closeProfileEditor(); });
  const emitP = (ev, data) => new Promise((res, rej) => socket.emit(ev, data, (r) => (r?.error ? rej(new Error(r.error)) : res(r))));
  $('profileForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('pfSave').disabled = true; $('pfError').hidden = true;
    try {
      clearTimeout(cropTimer);
      if (draft.avatar instanceof Blob) {
        const fd = new FormData(); fd.append('avatar', draft.avatar, 'avatar.' + (draft.avatar.type.split('/')[1] || 'png'));
        const r = await fetch('/api/avatar', { method: 'POST', body: fd }); const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || 'Não foi possível enviar a foto.');
      } else if (draft.avatar === 'remove') {
        await fetch('/api/avatar', { method: 'DELETE' });
      }
      await emitP('profile-update', { display: $('pfDisplay').value, pronouns: $('pfPronouns').value, statusText: $('pfStatus').value, bio: $('pfBio').value, color: draft.color });
      const nick = $('pfNick').value.trim();
      if (nick !== (S.nicks?.[S.me.uid]?.[S.serverId] || '')) await emitP('set-nick', { serverId: S.serverId, nick });
      closeProfileEditor(); toast('Perfil atualizado.');
    } catch (err) { showPfError(err.message); }
    finally { $('pfSave').disabled = false; }
  });

  // ---------- login ----------
  let authMode = 'login';
  function setAuthMode(mode) {
    authMode = mode;
    $('tabLogin').setAttribute('aria-selected', String(mode === 'login'));
    $('tabSignup').setAttribute('aria-selected', String(mode === 'signup'));
    $('inviteField').hidden = mode !== 'signup';
    $('authInvite').required = mode === 'signup';
    $('authPass').autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
    $('authSubmit').textContent = mode === 'signup' ? 'Criar conta' : 'Entrar';
    $('authHint').textContent = mode === 'signup'
      ? 'Usuário: 3 a 24 letras, números, ponto, hífen ou sublinhado. Senha: pelo menos 6 caracteres.'
      : 'Ainda não tem conta? Clique em "Criar conta" e use o código de convite de quem administra o Junta.';
    $('authError').hidden = true;
  }
  $('tabLogin').onclick = () => setAuthMode('login');
  $('tabSignup').onclick = () => setAuthMode('signup');
  function showAuth(msg) {
    $('auth').hidden = false; setAuthMode(authMode);
    if (msg) { $('authError').textContent = msg; $('authError').hidden = false; }
    setTimeout(() => $('authUser').focus(), 30);
  }
  $('authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('authSubmit').disabled = true; $('authError').hidden = true;
    try {
      const body = { username: $('authUser').value.trim(), password: $('authPass').value, invite: $('authInvite').value };
      const r = await fetch(authMode === 'signup' ? '/api/register' : '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Não foi possível entrar.');
      $('authPass').value = '';
      await boot();
    } catch (err) {
      $('authError').textContent = err.message; $('authError').hidden = false;
    } finally { $('authSubmit').disabled = false; }
  });

  async function logout() {
    if (S.voiceKey) leaveVoice();
    try { await fetch('/api/logout', { method: 'POST' }); } catch {}
    location.reload();
  }

  // ---------- convite (dono) ----------
  async function openInvite() {
    try {
      const r = await fetch('/api/invite'); const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      $('inviteCode').textContent = d.code; $('inviteModal').hidden = false; $('inviteCopy').focus();
    } catch (err) { toast(err.message || 'Não foi possível abrir o convite.'); }
  }
  $('inviteCopy').onclick = async () => {
    const text = `Entre no Junta: ${location.origin}\nCódigo de convite: ${$('inviteCode').textContent}`;
    try { await navigator.clipboard.writeText(text); toast('Convite copiado. Agora é só colar para o amigo.'); }
    catch { const rg = document.createRange(); rg.selectNodeContents($('inviteCode')); getSelection().removeAllRanges(); getSelection().addRange(rg); toast('Selecionei o código: aperte Ctrl+C para copiar.'); }
  };
  $('inviteNew').onclick = async () => {
    const r = await fetch('/api/invite/new', { method: 'POST' }); const d = await r.json();
    if (r.ok) { $('inviteCode').textContent = d.code; toast('Código novo gerado. O anterior não funciona mais.'); } else toast(d.error);
  };
  $('inviteClose').onclick = () => { $('inviteModal').hidden = true; };
  $('inviteModal').addEventListener('keydown', (e) => { if (e.key === 'Escape') $('inviteModal').hidden = true; });

  async function boot() {
    try {
      const r = await fetch('/api/me');
      if (r.ok) {
        const d = await r.json();
        S.me.uid = d.user.id; S.me.name = d.user.name; S.me.role = d.user.role;
        S.limits = { maxFileMb: d.maxFileMb, maxFiles: d.maxFiles };
        $('auth').hidden = true;
        $('ownerItems').hidden = !isOwner();
        renderMe();
        socket.connect();
        return;
      }
    } catch {}
    showAuth();
  }
  boot();

  socket.on('disconnect', () => toast('Conexão perdida. Tentando reconectar…'));
  window.addEventListener('beforeunload', () => { if (S.voiceKey) socket.emit('voice-leave'); });
})();
