// Junta — cliente
(() => {
  const $ = (id) => document.getElementById(id);
  const socket = io();

  const ICE = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }] };
  const PALETTE = ['#f0a43a', '#46c28a', '#6cb4ee', '#e88aa8', '#b49cf0', '#e5c15a', '#5fcfc3', '#ef8a5b'];

  const S = {
    me: { id: null, name: localStorage.getItem('junta:name') || '' },
    servers: [], voice: {}, presence: [],
    serverId: null, channelId: null,
    messages: [],
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
  const avatar = (name) => { const a = el('div', 'avatar', initials(name)); a.style.background = colorFor(name); return a; };
  const time = (ts) => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const dayLabel = (ts) => new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  let toastT;
  const toast = (msg) => { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 3500); };

  const currentServer = () => S.servers.find((s) => s.id === S.serverId);
  const currentChannel = () => currentServer()?.channels.find((c) => c.id === S.channelId);

  // ---------- modal ----------
  let modalResolve = null;
  function ask({ title, text = '', value = '', placeholder = '', ok = 'OK', withType = false, cancellable = true }) {
    $('modalTitle').textContent = title; $('modalText').textContent = text; $('modalText').hidden = !text;
    const inp = $('modalInput'); inp.value = value; inp.placeholder = placeholder;
    $('modalOk').textContent = ok; $('modalType').hidden = !withType; $('modalCancel').hidden = !cancellable;
    if (withType) document.querySelector('input[name=ctype][value=text]').checked = true;
    $('modal').hidden = false; setTimeout(() => inp.focus(), 30);
    return new Promise((res) => (modalResolve = res));
  }
  function closeModal(result) { $('modal').hidden = true; const r = modalResolve; modalResolve = null; r && r(result); }
  $('modalForm').addEventListener('submit', (e) => {
    e.preventDefault();
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
      const add = el('button', null, '+'); add.title = 'Criar canal'; add.setAttribute('aria-label', 'Criar canal');
      add.onclick = () => createChannel(type); cat.append(add); box.append(cat);
      for (const c of s.channels.filter((c) => c.type === type)) {
        const b = el('button', 'chan' + (c.id === S.channelId ? ' active' : ''));
        b.append(el('span', 'glyph', type === 'text' ? '#' : '◖'), el('span', 'label', c.name));
        b.onclick = () => { selectChannel(c.id); document.getElementById('app').classList.remove('drawer'); };
        box.append(b);
        const members = S.voice[keyOf(s.id, c.id)] || [];
        if (type === 'voice' && members.length) {
          const ml = el('div', 'chan-members');
          for (const m of members) {
            const row = el('div', 'chan-member'); row.append(avatar(m.name), el('span', 'nm', m.name));
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
    $('meName').textContent = S.me.name;
    const a = $('meAvatar'); a.textContent = initials(S.me.name); a.style.background = colorFor(S.me.name);
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
  const helloPayload = () => ({ name: S.me.name, status: myStatus() });
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

  function voiceWhere(id) {
    for (const [key, list] of Object.entries(S.voice)) {
      const m = list.find((x) => x.id === id); if (!m) continue;
      const [sid, cid] = key.split('/');
      const sv = S.servers.find((x) => x.id === sid); const ch = sv?.channels.find((c) => c.id === cid);
      return { room: ch?.name || cid, server: sv?.name || sid, serverId: sid, sharing: m.sharing };
    }
    return null;
  }

  function renderMembers() {
    // a mesma pessoa em várias abas aparece uma vez só, com o status "mais ativo"
    const byName = new Map();
    for (const u of S.presence) {
      const where = voiceWhere(u.id); const cur = byName.get(u.name);
      if (!cur) { byName.set(u.name, { name: u.name, status: u.status, where, me: u.id === S.me.id }); continue; }
      if (RANK[u.status] < RANK[cur.status]) cur.status = u.status;
      if (where && (!cur.where || where.sharing)) cur.where = where;
      if (u.id === S.me.id) cur.me = true;
    }
    const people = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    const box = $('memberList'); box.replaceChildren();
    for (const [label, list] of [['Online', people.filter((p) => p.status !== 'idle')], ['Ausente', people.filter((p) => p.status === 'idle')]]) {
      if (!list.length) continue;
      box.append(el('div', 'mgroup', `${label} — ${list.length}`));
      for (const p of list) {
        const row = el('div', 'mrow' + (p.status === 'idle' ? ' away' : ''));
        const w = el('span', 'av-wrap'); w.title = STATUS_LABEL[p.status];
        w.append(avatar(p.name), el('span', 'sdot s-' + p.status));
        const txt = el('div', 'txt');
        const nm = el('span', 'nm', p.name); if (p.me) nm.append(el('span', 'you', ' (você)'));
        txt.append(nm);
        if (p.where) {
          const other = p.where.serverId !== S.serverId ? ` · ${p.where.server}` : '';
          txt.append(el('span', 'act' + (p.where.sharing ? ' live' : ''), (p.where.sharing ? `Transmitindo em ${p.where.room}` : `Em ${p.where.room}`) + other));
        } else if (p.status === 'dnd') txt.append(el('span', 'act', 'Não perturbe'));
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
      socket.emit('join-text', keyOf(S.serverId, id), (msgs) => { S.messages = msgs; renderMessages(true); });
    } else {
      renderStage();
    }
    renderRail(); renderChannels(); renderMembers();
  }

  async function createChannel(type) {
    const r = await ask({ title: 'Criar canal', text: `Em ${currentServer().name}`, placeholder: type === 'text' ? 'novo-canal' : 'Sala de jogos', ok: 'Criar', withType: true });
    if (!r) return;
    socket.emit('create-channel', { serverId: S.serverId, name: r.value, type: r.type || type });
  }
  $('addServerBtn').onclick = async () => {
    const r = await ask({ title: 'Criar servidor', text: 'Ele já vem com um canal de texto e uma sala de voz.', placeholder: 'Nome do servidor', ok: 'Criar' });
    if (r) { pendingServerName = r.value; socket.emit('create-server', r.value); }
  };
  let pendingServerName = null;

  $('renameBtn').onclick = async () => {
    const r = await ask({ title: 'Seu nome', value: S.me.name, ok: 'Salvar' });
    if (!r) return;
    S.me.name = r.value.slice(0, 32); localStorage.setItem('junta:name', S.me.name);
    socket.emit('hello', helloPayload(), () => {}); renderMe();
    toast('Nome atualizado. Ele aparece nas próximas mensagens e salas.');
  };
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

  function msgNode(m, prev) {
    const grouped = prev && prev.author === m.author && m.ts - prev.ts < 5 * 60e3 && dayLabel(prev.ts) === dayLabel(m.ts);
    const row = el('div', 'msg' + (grouped ? '' : ' head'));
    if (grouped) {
      row.append(el('div', 'side', time(m.ts)));
    } else {
      row.append(avatar(m.author));
      const meta = el('div', 'meta'); const who = el('span', 'who', m.author); who.style.color = colorFor(m.author);
      meta.append(who, el('span', 'when', `${dayLabel(m.ts)} ${time(m.ts)}`)); row.append(meta);
    }
    const body = el('div', 'body'); linkify(m.text, body); row.append(body);
    return row;
  }

  function renderMessages(scroll) {
    const box = $('messages'); box.replaceChildren();
    const c = currentChannel();
    const w = el('div', 'welcome'); w.append(el('div', 'big', '#'), el('h3', null, `Bem-vindo a #${c.name}`), el('p', null, `Este é o começo do canal #${c.name}.`));
    box.append(w);
    S.messages.forEach((m, i) => box.append(msgNode(m, S.messages[i - 1])));
    if (scroll) box.scrollTop = box.scrollHeight;
  }

  socket.on('message', ({ key, msg }) => {
    if (key !== keyOf(S.serverId, S.channelId)) return;
    const box = $('messages');
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
    const prev = S.messages[S.messages.length - 1];
    S.messages.push(msg); box.append(msgNode(msg, prev));
    if (nearBottom || msg.authorId === S.me.id) box.scrollTop = box.scrollHeight;
    typingNames.delete(msg.author); renderTyping();
  });

  const input = $('msgInput');
  const autosize = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 200) + 'px'; };
  let lastTyping = 0;
  input.addEventListener('input', () => {
    autosize();
    if (Date.now() - lastTyping > 2000) { lastTyping = Date.now(); socket.emit('typing', keyOf(S.serverId, S.channelId)); }
  });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('composer').requestSubmit(); } });
  $('composer').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim(); if (!text) return;
    socket.emit('message', { key: keyOf(S.serverId, S.channelId), text });
    input.value = ''; autosize();
  });

  const typingNames = new Map();
  function renderTyping() {
    const names = [...typingNames.keys()];
    $('typing').textContent = !names.length ? '' : names.length === 1 ? `${names[0]} está digitando…` : `${names.slice(0, 3).join(', ')} estão digitando…`;
  }
  socket.on('typing', ({ key, name }) => {
    if (key !== keyOf(S.serverId, S.channelId)) return;
    clearTimeout(typingNames.get(name)); typingNames.set(name, setTimeout(() => { typingNames.delete(name); renderTyping(); }, 3500)); renderTyping();
  });

  // ---------- preferências de áudio ----------
  const CFG_KEY = 'junta:audio';
  const cfg = Object.assign(
    { mode: 'vad', pttCode: 'KeyV', pttLabel: 'V', noise: 'ai', music: false, deviceId: '', volumes: {}, sounds: true, soundVol: 60 },
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
          enc.maxBitrate = 2_500_000; enc.priority = 'low'; enc.networkPriority = 'low';
          prm.degradationPreference = 'maintain-resolution';
        }
        await s.setParameters(prm);
      } catch {}
    }
  }
  const tuneAllSenders = () => Object.values(S.peers).forEach(tuneSenders);

  // ---------- volume por pessoa ----------
  const volKey = (kind, name) => `${kind}:${name}`;
  const getVol = (kind, name) => cfg.volumes[volKey(kind, name)] ?? 100;
  function setVol(kind, name, v) {
    if (v === 100) delete cfg.volumes[volKey(kind, name)]; else cfg.volumes[volKey(kind, name)] = v;
    saveCfg();
    for (const [id, p] of Object.entries(S.peers)) if (memberName(id) === name) applyVolumes(p, name);
  }
  function memberName(id) { return (S.voice[S.voiceKey] || []).find((m) => m.id === id)?.name; }
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
    const val = el('span', null, getVol(kind, m.name) + '%');
    lab.append(el('span', null, kind === 'screen' ? 'Volume da transmissão' : `Volume de ${m.name}`), val);
    const r = document.createElement('input'); r.type = 'range'; r.min = 0; r.max = 100; r.step = 5; r.id = id; r.value = getVol(kind, m.name);
    r.oninput = () => { const v = +r.value; val.textContent = v + '%'; setVol(kind, m.name, v); };
    r.onchange = () => renderStage();
    box.append(lab, r);
    return box;
  }

  function personTile(m) {
    const isMe = m.id === S.me.id;
    const t = el('div', 'tile' + (isMe ? '' : ' person') + (S.speaking.has(m.id) ? ' speaking' : '')); t.dataset.pid = m.id;
    t.append(avatar(m.name));
    const n = el('div', 'name'); n.append(el('span', null, m.name + (isMe ? ' (você)' : '')));
    if (m.muted) n.append(el('span', 'muted-ic', '✕'));
    if (!isMe && getVol('voice', m.name) !== 100) n.append(el('span', 'lowvol', getVol('voice', m.name) + '%'));
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

  async function toggleScreen() {
    if (S.screen) { stopScreen(); return; }
    if (!navigator.mediaDevices?.getDisplayMedia) { toast('Este navegador não permite compartilhar tela. Use Chrome, Edge ou Firefox no computador.'); return; }
    try {
      S.screen = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30 }, width: { max: 1920 }, height: { max: 1080 } },
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2, sampleRate: 48000 },
        systemAudio: 'include',
      });
    } catch { return; } // cancelou a escolha
    const vt = S.screen.getVideoTracks()[0];
    if (vt) { vt.contentHint = 'detail'; vt.onended = () => stopScreen(); }
    S.screen.getAudioTracks().forEach((t) => (t.contentHint = 'music'));
    for (const p of Object.values(S.peers)) addScreenTo(p);
    $('shareBtn').setAttribute('aria-pressed', 'true'); $('shareLabel').textContent = 'Parar transmissão';
    socket.emit('voice-update', { sharing: true });
  }

  function addScreenTo(p) {
    if (!S.screen) return;
    p.screenSenders = S.screen.getTracks().map((t) => p.pc.addTrack(t, S.screen));
  }

  function stopScreen(silent) {
    if (!S.screen) return;
    S.screen.getTracks().forEach((t) => t.stop());
    for (const p of Object.values(S.peers)) { (p.screenSenders || []).forEach((s) => { try { p.pc.removeTrack(s); } catch {} }); p.screenSenders = []; }
    S.screen = null;
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
    applyVolumes(p, memberName(id));
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
        await pc.setRemoteDescription({ type: d.type, sdp: tuneOpus(d.sdp) });
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
    if (pendingServerName) {
      const s = [...servers].reverse().find((x) => x.name === pendingServerName); pendingServerName = null;
      if (s) { selectServer(s.id); return; }
    }
    if (!currentChannel()) selectServer(S.servers[0].id); else renderChannels();
  });

  socket.on('voice-state', (v) => {
    roomEvents(v);
    S.voice = v;
    // remove tela de quem parou de transmitir
    const mine = S.voiceKey ? v[S.voiceKey] || [] : [];
    for (const m of mine) { const p = S.peers[m.id]; if (p && !m.sharing && p.screenStream) p.screenStream = null; }
    renderRail(); renderChannels(); renderStage(); renderMembers();
  });

  socket.on('presence', (list) => { S.presence = list; renderMembers(); });

  async function start() {
    if (!S.me.name) {
      const r = await ask({ title: 'Como podemos te chamar?', text: 'Seu nome aparece nas mensagens e nas salas de voz.', placeholder: 'Seu nome', ok: 'Entrar', cancellable: false });
      S.me.name = r.value.slice(0, 32); localStorage.setItem('junta:name', S.me.name);
    }
    renderMe();
    hello();
  }
  function hello() {
    socket.emit('hello', helloPayload(), ({ id, servers, voice, presence }) => {
      S.me.id = id; S.servers = servers; S.voice = voice; S.presence = presence || []; renderMembers();
      const last = (localStorage.getItem('junta:last') || '').split('/');
      const s = servers.find((x) => x.id === last[0]);
      if (s && s.channels.some((c) => c.id === last[1])) { S.serverId = s.id; selectChannel(last[1]); }
      else selectServer(servers[0].id);
    });
  }
  let booted = false;
  socket.on('connect', () => {
    if (!booted) { booted = true; start(); return; }
    // reconexão: o id mudou, a sala de voz precisa ser refeita
    const wasIn = S.voiceKey;
    if (wasIn) { for (const id of Object.keys(S.peers)) closePeer(id); S.voiceKey = null; }
    socket.emit('hello', helloPayload(), ({ id, servers, voice, presence }) => {
      S.me.id = id; S.servers = servers; S.voice = voice; S.presence = presence || []; renderMembers();
      if (S.channelId) selectChannel(S.channelId);
      if (wasIn) { stopScreen(true); stopMic(); stopAllMeters(); toast('Conexão restabelecida. Entre de novo na sala de voz.'); renderChannels(); renderStage(); }
    });
  });
  socket.on('disconnect', () => toast('Conexão perdida. Tentando reconectar…'));
  window.addEventListener('beforeunload', () => { if (S.voiceKey) socket.emit('voice-leave'); });
})();
