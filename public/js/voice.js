// Junta — voz, tela e áudio (WebRTC)
'use strict';

// ---------- preferências de áudio ----------
const CFG_KEY = 'junta:audio';
const cfg = Object.assign(
  { mode: 'vad', pttCode: 'KeyV', pttLabel: 'V', noise: 'ai', music: false, deviceId: '', camId: '', volumes: {}, sounds: true, soundVol: 60, screenPreset: 'sharp' },
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

// minha entrada na sala: sem "Falar" ou silenciado por um moderador, o microfone fica fechado
const myVoice = () => (S.voice[S.voiceKey] || []).find((m) => m.id === S.me.id);
const forcedMute = () => { const m = myVoice(); return !!m && (m.speak === false || m.serverMuted); };
const micOpen = () => !!A.raw && !S.muted && !forcedMute() && (cfg.mode === 'vad' || A.pttDown);
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
        if ((p.camSenders || []).includes(s)) { // câmera: 720p até 1,5 Mbps, cede espaço para a tela
          enc.active = p.want?.cam !== false; // a pessoa não está vendo: pausa só para ela
          enc.maxBitrate = 1_500_000; enc.maxFramerate = 30; enc.priority = 'low'; enc.networkPriority = 'low';
          prm.degradationPreference = 'balanced';
        } else {
          const pr = preset();
          enc.active = p.want?.screen !== false;
          enc.maxBitrate = pr.kbps * 1000; enc.maxFramerate = pr.fps; enc.scaleResolutionDownBy = 1;
          enc.priority = 'medium'; enc.networkPriority = 'medium'; // a voz continua com prioridade alta
          prm.degradationPreference = pr.degrade;
        }
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
  // quem ouve também respeita as permissões: voz de quem não pode falar (ou foi silenciado) e
  // som de tela de quem não pode transmitir não tocam
  const mem = (S.voice[S.voiceKey] || []).find((x) => S.peers[x.id] === p);
  for (const m of Object.values(p.media)) {
    if (!m.audio) continue;
    const isScreen = m.stream.getVideoTracks().length > 0;
    m.audio.volume = Math.min(1, getVol(isScreen ? 'screen' : 'voice', name) / 100);
    m.audio.muted = !!mem && (isScreen ? mem.stream === false : (mem.speak === false || !!mem.serverMuted));
  }
}
// depois de cada mudança na sala: aplica permissões nos áudios e no meu microfone
function enforceVoicePerms() {
  for (const [id, p] of Object.entries(S.peers)) applyVolumes(p, memberUid(id));
  const m = myVoice(); if (!m) return;
  updateGate();
  const blocked = forcedMute();
  $('muteBtn').disabled = blocked;
  $('muteBtn').setAttribute('aria-pressed', String(S.muted || blocked));
  $('muteBtn').title = m.serverMuted ? 'Um moderador silenciou você' : m.speak === false ? 'Você não tem permissão para falar nesta sala' : (S.muted ? 'Ativar microfone' : 'Silenciar');
  const streamOk = m.stream !== false;
  $('shareBtn').disabled = !streamOk && !S.screen; $('camBtn').disabled = !streamOk && !S.cam;
  $('shareBtn').title = streamOk ? '' : 'Você não tem permissão para transmitir nesta sala';
  $('camBtn').title = $('shareBtn').title;
  if (!streamOk && (S.screen || S.cam)) { stopScreen(); stopCamera(); toast('Você perdeu a permissão de transmitir nesta sala.'); }
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
    const can = canHere(P.CONNECT);
    $('joinVoiceBtn').disabled = !can;
    $('joinVoiceBtn').textContent = !can ? 'Sem permissão para entrar' : S.voiceKey ? 'Mudar para esta sala' : 'Entrar na sala';
    return;
  }
  // destaque: uma tela (ou câmera) grande, o resto numa faixa embaixo
  const fk = S.focus?.split(':')[0], fid = S.focus?.slice(fk?.length + 1);
  const fm = S.focus && members.find((m) => m.id === fid && m.stream !== false && (fk === 'screen' ? m.sharing : m.camera));
  if (S.focus && !fm) S.focus = null;
  const sharing = members.filter((m) => m.sharing && m.stream !== false);
  const screenOf = (m) => screenTile(m, m.id === S.me.id ? S.screen : remoteVideo(m, 'screen'), m.id === S.me.id);
  stage.replaceChildren();
  stage.classList.toggle('focused', !!fm);
  if (fm) {
    stage.classList.add('has-screen');
    const big = el('div', 'screens focus');
    big.append(fk === 'screen' ? screenOf(fm) : personTile(fm, true));
    const strip = el('div', 'people-strip');
    strip.append(...sharing.filter((m) => !(fk === 'screen' && m.id === fm.id)).map(screenOf));
    strip.append(...members.filter((m) => !(fk === 'cam' && m.id === fm.id)).map((m) => personTile(m)));
    stage.append(big, strip);
  } else if (sharing.length) {
    stage.classList.add('has-screen');
    const sc = el('div', 'screens'); sc.append(...sharing.map(screenOf));
    const strip = el('div', 'people-strip'); strip.append(...members.map((m) => personTile(m)));
    stage.append(sc, strip);
  } else {
    stage.classList.remove('has-screen');
    stage.append(...members.map((m) => personTile(m)));
  }
  syncPip();
  scheduleWants();
}

// botões pequenos dos blocos: destacar e janela flutuante
const SVG_FOCUS = '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M3 5v4h2V5h4V3H5a2 2 0 0 0-2 2zm2 10H3v4a2 2 0 0 0 2 2h4v-2H5v-4zm14 4h-4v2h4a2 2 0 0 0 2-2v-4h-2v4zm0-16h-4v2h4v4h2V5a2 2 0 0 0-2-2zM8 8h8v8H8z"/></svg>';
const SVG_UNFOCUS = '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M3 3h8v8H3zm2 2v4h4V5zm8-2h8v8h-8zm2 2v4h4V5zM3 13h8v8H3zm2 2v4h4v-4zm8-2h8v8h-8zm2 2v4h4v-4z"/></svg>';
const SVG_PIP = '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M19 11h-8v6h8v-6zm4 8V4.98C23 3.88 22.1 3 21 3H3c-1.1 0-2 .88-2 1.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H3V4.97h18v14.05z"/></svg>';
function tileBtn(cls, label, svg, fn) {
  const b = el('button', 'icon-btn tile-btn ' + cls); b.type = 'button'; b.title = label; b.setAttribute('aria-label', label); b.innerHTML = svg;
  b.onclick = (e) => { e.stopPropagation(); fn(); };
  return b;
}
function toggleFocus(k) { S.focus = S.focus === k ? null : k; renderStage(); }
// Esc sai do destaque
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !S.focus || $('voiceView').hidden || typingTarget(e.target) || document.fullscreenElement) return;
  if (document.querySelector('.modal-back:not([hidden]), .settings-back:not([hidden])')) return;
  S.focus = null; renderStage();
});

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
  // moderação: só para quem tem a permissão e está acima da pessoa
  if (kind === 'voice' && S.voiceKey && topOf(m.uid) < myTop()) {
    const acts = el('div', 'mod-acts');
    if (canChan(S.voiceKey, P.MUTE_MEMBERS)) {
      const b = el('button', 'ghost-btn', m.serverMuted ? 'Deixar falar' : 'Silenciar para todos'); b.type = 'button';
      b.onclick = () => emitP('voice-moderate', { sid: m.id, mute: !m.serverMuted }).catch((x) => toast(x.message));
      acts.append(b);
    }
    if (canChan(S.voiceKey, P.MOVE_MEMBERS)) {
      const b = el('button', 'ghost-btn danger-text', 'Desconectar'); b.type = 'button';
      b.onclick = () => emitP('voice-disconnect', { sid: m.id }).then(() => { openVol = null; }).catch((x) => toast(x.message));
      acts.append(b);
    }
    if (acts.childNodes.length) box.append(acts);
  }
  return box;
}

function personTile(m, big) {
  const isMe = m.id === S.me.id;
  const cam = m.camera && m.stream !== false ? (isMe ? S.cam : remoteVideo(m, 'cam')) : null;
  const t = el('div', 'tile' + (isMe ? '' : ' person') + (cam ? ' has-cam' : '') + (big ? ' big' : '') + (S.speaking.has(m.id) ? ' speaking' : '')); t.dataset.pid = m.id;
  if (m.camera && m.stream !== false) {
    const k = 'cam:' + m.id, on = S.focus === k;
    t.append(tileBtn('focus-btn', on ? 'Sair do destaque' : 'Destacar câmera', on ? SVG_UNFOCUS : SVG_FOCUS, () => toggleFocus(k)));
    if (!isMe && cam) t.append(tileBtn('pip-btn', 'Janela flutuante', SVG_PIP, () => openPip('cam', m)));
  }
  if (cam) {
    const v = document.createElement('video'); v.className = 'cam' + (isMe ? ' mirror' : ''); // a sua imagem aparece espelhada, como num espelho
    v.autoplay = true; v.playsInline = true; v.muted = true; v.srcObject = cam; t.append(v);
  } else t.append(avatar(m.name, m.uid));
  const n = el('div', 'name'); n.append(el('span', null, m.name + (isMe ? ' (você)' : '')));
  if (m.muted || m.speak === false || m.serverMuted) n.append(el('span', 'muted-ic', '✕'));
  if (m.serverMuted) { const b = el('span', 'tag mod-tag', 'SILENCIADO'); b.title = 'Silenciado por um moderador'; n.append(b); }
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
  const k = 'screen:' + m.id, on = S.focus === k;
  t.onclick = () => toggleFocus(k);
  t.onkeydown = (e) => { if (e.key === 'Enter' && e.target === t) { e.preventDefault(); toggleFocus(k); } };
  t.title = on ? 'Clique para sair do destaque · duplo clique: tela cheia' : 'Clique para destacar · duplo clique: tela cheia';
  const n = el('div', 'name'); n.append(el('span', null, isMe ? 'Sua tela' : `Tela de ${m.name}`)); t.append(n, fs);
  t.append(tileBtn('focus-btn', on ? 'Sair do destaque' : 'Destacar', on ? SVG_UNFOCUS : SVG_FOCUS, () => toggleFocus(k)));
  if (!isMe && stream) t.append(tileBtn('pip-btn', 'Janela flutuante', SVG_PIP, () => openPip('screen', m)));
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
$('camBtn').onclick = toggleCamera;

async function joinVoice(key) {
  if (S.voiceKey) leaveVoice();
  ensureCtx();
  try { await openMic(); }
  catch { stopMic(); toast('Sem acesso ao microfone: você entra só para ouvir e ver telas.'); }
  S.muted = !A.raw; applyMute();
  refreshDevices();
  watchSpeaking(S.me.id, A.out);
  await Promise.race([loadIce(), new Promise((r) => setTimeout(r, 3000))]); // credenciais do TURN, sem segurar a entrada
  socket.emit('voice-join', key, (peerIds) => {
    S.voiceKey = key;
    roomBaseline = null; // a primeira lista da sala só marca quem já estava lá
    playCue('selfJoin');
    for (const id of peerIds) getPeer(id); // quem chega inicia as conexões
    if (S.muted) socket.emit('voice-update', { muted: true });
    renderChannels(); renderStage();
    if (S.channelId && keyOf(S.serverId, S.channelId) === key) syncSideChat();
  });
}

function leaveVoice() {
  if (!S.voiceKey) return;
  stopScreen(true); stopCamera(true);
  for (const id of Object.keys(S.peers)) closePeer(id);
  stopMic(); stopAllMeters();
  socket.emit('voice-leave');
  S.voiceKey = null; openVol = null; roomBaseline = null; S.focus = null;
  closePip();
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
  mention:   [[987.77, 0], [1318.51, 0.1]],
};
function playCue(name) {
  if (!cfg.sounds || myStatus() === 'dnd') return;
  let ctx = A.ctx;
  if (!ctx) { try { ctx = A.cueCtx ||= new (window.AudioContext || window.webkitAudioContext)(); } catch { return; } }
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
  updateGate(); syncPip();
}
function toggleMute() {
  if (forcedMute()) { toast(myVoice()?.serverMuted ? 'Um moderador silenciou você nesta sala.' : 'Você não tem permissão para falar nesta sala.'); return; }
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
    const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput' && d.deviceId);
    const cs = $('camSelect'); cs.replaceChildren();
    const cd = el('option', null, 'Padrão do sistema'); cd.value = ''; cs.append(cd);
    cams.forEach((d, i) => { const o = el('option', null, d.label || `Câmera ${i + 1}`); o.value = d.deviceId; cs.append(o); });
    cs.value = cams.some((d) => d.deviceId === cfg.camId) ? cfg.camId : '';
  } catch {}
}
navigator.mediaDevices?.addEventListener?.('devicechange', refreshDevices);

// aplica mudanças que exigem reabrir o microfone, se estiver numa sala
async function reopenIfLive() {
  if (!S.voiceKey || !A.raw) return;
  try { await openMic(); } catch { toast('Não foi possível abrir esse microfone.'); }
}

$('settingsBtn').onclick = () => { syncSettingsUI(); refreshDevices(); $('settings').hidden = false; $('settingsClose').focus(); renderConnInfo(); };
$('settingsClose').onclick = () => { $('settings').hidden = true; capturingKey = false; };

// ---------- tipo de conexão com cada pessoa (direta ou pelo TURN) ----------
async function connType(p) {
  try {
    const stats = await p.pc.getStats();
    let pair = null;
    stats.forEach((r) => { if (r.type === 'transport' && r.selectedCandidatePairId) pair = stats.get(r.selectedCandidatePairId); });
    if (!pair) stats.forEach((r) => { if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') pair = r; });
    if (!pair) return null;
    const l = stats.get(pair.localCandidateId), r = stats.get(pair.remoteCandidateId);
    return l?.candidateType === 'relay' || r?.candidateType === 'relay' ? 'turn' : 'direct';
  } catch { return null; }
}
async function renderConnInfo() {
  const box = $('connInfo'); if (!box || $('settings').hidden) return;
  const list = $('connList');
  $('connTurn').textContent = iceTurn ? 'TURN ativo: quem não conseguir conexão direta passa pelo servidor TURN.' : 'TURN desligado: só conexões diretas. Quem estiver em 4G ou rede de empresa pode não ouvir a sala.';
  $('connTurn').classList.toggle('ok', iceTurn);
  const others = S.voiceKey ? (S.voice[S.voiceKey] || []).filter((m) => m.id !== S.me.id) : [];
  const rows = await Promise.all(others.map(async (m) => {
    const p = S.peers[m.id]; const st = p?.pc.connectionState;
    const t = st === 'connected' ? await connType(p) : null;
    const label = st === 'failed' ? 'sem conexão' : t === 'turn' ? 'via TURN' : t === 'direct' ? 'direta' : 'conectando…';
    const row = el('li', 'conn-row ' + (st === 'failed' ? 'bad' : t || 'wait'));
    row.append(el('span', null, m.name), el('span', 'conn-tag', label));
    return row;
  }));
  list.replaceChildren(...rows);
  list.hidden = !rows.length;
  $('connEmpty').hidden = !!rows.length;
}
setInterval(renderConnInfo, 2000);
// credenciais do TURN vencem: renova as de quem está numa sala
setInterval(async () => {
  if (!S.voiceKey) return;
  await loadIce(true);
  for (const p of Object.values(S.peers)) { try { p.pc.setConfiguration({ ...p.pc.getConfiguration(), iceServers: ICE.iceServers }); } catch {} }
}, 6 * 3600_000);
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
$('camSelect').onchange = async () => { cfg.camId = $('camSelect').value; saveCfg(); if (S.cam) { stopCamera(true); await toggleCamera(); } };
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
  if (myVoice()?.stream === false) { toast('Você não tem permissão para transmitir nesta sala.'); return; }
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
  socket.emit('voice-update', { sharing: true, screenId: S.screen.id });
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
  if (!silent) socket.emit('voice-update', { sharing: false, screenId: null });
}

// ---------- câmera ----------
async function toggleCamera() {
  if (S.cam) { stopCamera(); return; }
  if (myVoice()?.stream === false) { toast('Você não tem permissão para transmitir nesta sala.'); return; }
  if (!navigator.mediaDevices?.getUserMedia) { toast('Este navegador não dá acesso à câmera.'); return; }
  const dev = cfg.camId;
  try {
    S.cam = await navigator.mediaDevices.getUserMedia({ video: {
      ...(dev ? { deviceId: { exact: dev } } : {}), width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 },
    } });
  } catch (e) {
    if (dev) { cfg.camId = ''; saveCfg(); return toggleCamera(); } // a câmera salva sumiu: tenta a padrão
    toast(e?.name === 'NotAllowedError' ? 'O navegador bloqueou a câmera. Libere nas configurações do site (cadeado ao lado do endereço).' : 'Não encontrei uma câmera. Verifique se ela está conectada.');
    return;
  }
  const vt = S.cam.getVideoTracks()[0];
  if (vt) { vt.contentHint = 'motion'; vt.onended = () => stopCamera(); }
  for (const p of Object.values(S.peers)) addCamTo(p);
  $('camBtn').setAttribute('aria-pressed', 'true');
  socket.emit('voice-update', { camera: true, camId: S.cam.id });
  refreshDevices(); renderStage();
}
function addCamTo(p) {
  if (!S.cam) return;
  p.camSenders = S.cam.getTracks().map((t) => p.pc.addTrack(t, S.cam));
}
function stopCamera(silent) {
  if (!S.cam) return;
  S.cam.getTracks().forEach((t) => t.stop());
  for (const p of Object.values(S.peers)) { (p.camSenders || []).forEach((s) => { try { p.pc.removeTrack(s); } catch {} }); p.camSenders = []; }
  S.cam = null;
  $('camBtn').setAttribute('aria-pressed', 'false');
  if (!silent) socket.emit('voice-update', { camera: false, camId: null });
  renderStage();
}
// vídeo recebido de alguém: a câmera ou a tela, conforme o id que a pessoa anunciou
function remoteVideo(m, kind) {
  const p = S.peers[m.id]; if (!p) return null;
  const id = kind === 'cam' ? m.camId : m.screenId;
  if (id && p.videos[id]) return p.videos[id];
  if (kind === 'screen' && m.sharing) return Object.values(p.videos).find((v) => v.id !== m.camId) || null; // versões antigas não anunciam o id
  return null;
}

// ---------- janela flutuante (picture-in-picture) ----------
// No Chrome e no Edge, uma janelinha própria com a transmissão e os botões de microfone e sair.
// Nos outros (Safari), o picture-in-picture padrão do vídeo.
let pip = null; // { kind, id, name, win, video }
const pipStream = (kind, id) => { const m = (S.voice[S.voiceKey] || []).find((x) => x.id === id); return m && m.stream !== false && (kind === 'screen' ? m.sharing : m.camera) ? remoteVideo(m, kind) : null; };

async function openPip(kind, m) {
  const stream = remoteVideo(m, kind); if (!stream) return;
  if (pip?.kind === kind && pip.id === m.id) { closePip(); return; }
  closePip();
  const label = kind === 'screen' ? `Tela de ${m.name}` : m.name;
  if (window.documentPictureInPicture?.requestWindow) {
    try {
      const win = await documentPictureInPicture.requestWindow({ width: 560, height: 340 });
      buildPipWindow(win, stream, label);
      pip = { kind, id: m.id, name: label, win, video: win.document.querySelector('video') };
      win.addEventListener('pagehide', () => { if (pip?.win === win) { pip = null; renderStage(); } });
      renderStage();
      return;
    } catch (e) { console.warn('janela flutuante própria indisponível', e); }
  }
  const v = $('pipVideo');
  if (!document.pictureInPictureEnabled || !v.requestPictureInPicture) { toast('Este navegador não tem janela flutuante. Use Chrome, Edge ou Safari.'); return; }
  try {
    v.srcObject = stream; await v.play();
    await v.requestPictureInPicture();
    pip = { kind, id: m.id, name: label, win: null, video: v };
    renderStage();
  } catch { v.srcObject = null; toast('Não consegui abrir a janela flutuante.'); }
}
$('pipVideo').addEventListener('leavepictureinpicture', () => {
  const v = $('pipVideo'); v.pause(); v.srcObject = null;
  if (pip && !pip.win) { pip = null; renderStage(); }
});
function closePip() {
  if (!pip) return;
  const p = pip; pip = null;
  if (p.win) { try { p.win.close(); } catch {} }
  else if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
}
// mantém a janela em dia: a transmissão acabou, mudou de conexão, ou o microfone mudou
function syncPip() {
  if (!pip) return;
  const stream = S.voiceKey && pipStream(pip.kind, pip.id);
  if (!stream) { closePip(); toast('A transmissão da janela flutuante terminou.'); return; }
  if (pip.video.srcObject !== stream) { pip.video.srcObject = stream; pip.video.play().catch(() => {}); }
  if (pip.win) {
    const d = pip.win.document, mb = d.getElementById('pipMute');
    const off = S.muted || forcedMute();
    mb.textContent = off ? 'Microfone desligado' : 'Microfone ligado'; mb.classList.toggle('off', off); mb.disabled = forcedMute() || !A.raw;
  }
}
function buildPipWindow(win, stream, label) {
  const d = win.document;
  d.title = label + ' · Junta';
  const st = d.createElement('style');
  st.textContent = `
    :root { color-scheme: dark; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
    html, body { margin: 0; height: 100%; background: #0e1013; color: #e7e9ee; overflow: hidden; }
    body { display: grid; grid-template-rows: 1fr auto; }
    video { width: 100%; height: 100%; min-height: 0; object-fit: contain; background: #000; display: block; }
    .bar { display: flex; gap: 8px; align-items: center; padding: 8px 10px; background: #16191e; font-size: 13px; }
    .bar .nm { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #aab0bc; }
    button { font: inherit; font-size: 12px; border: 0; border-radius: 6px; padding: 7px 10px; cursor: pointer; background: #262b33; color: #e7e9ee; }
    button:hover { background: #303640; } button.off { background: #4a2a2a; color: #ffb4a9; } button:disabled { opacity: .55; cursor: default; }
    button.leave { background: #c8453b; color: #fff; } button.leave:hover { background: #d9554a; }
    body.min .bar { display: none; } body:hover .bar { display: flex; }`;
  d.head.append(st);
  const v = d.createElement('video'); v.autoplay = true; v.muted = true; v.playsInline = true; v.srcObject = stream;
  const bar = d.createElement('div'); bar.className = 'bar';
  const nm = d.createElement('span'); nm.className = 'nm'; nm.textContent = label;
  const mute = d.createElement('button'); mute.id = 'pipMute'; mute.onclick = () => { toggleMute(); syncPip(); };
  const back = d.createElement('button'); back.textContent = 'Voltar'; back.title = 'Voltar para o Junta';
  back.onclick = () => { window.focus(); closePip(); };
  const leave = d.createElement('button'); leave.className = 'leave'; leave.textContent = 'Sair da sala'; leave.onclick = () => leaveVoice();
  bar.append(nm, mute, back, leave);
  d.body.append(v, bar);
  v.play().catch(() => {});
  // janela pequena: a barra só aparece com o mouse em cima
  const fit = () => d.body.classList.toggle('min', win.innerHeight < 200);
  win.addEventListener('resize', fit); fit();
  setTimeout(syncPip, 0);
}

// ---------- só receber vídeo que está sendo visto ----------
// Cada transmissão é enviada separadamente para cada pessoa. Quando você não está vendo a tela
// ou a câmera de alguém (outro canal aberto, aba minimizada), o Junta avisa essa pessoa para
// pausar o vídeo só para você: economiza o upload dela e o processamento do seu computador.
// O som da transmissão continua.
const WANT_OFF_DELAY = 3000; // espera um pouco antes de pausar, para não piscar ao trocar de aba rápido
function stageVisible() {
  return !!S.voiceKey && !document.hidden && !S.home && !$('voiceView').hidden && keyOf(S.serverId, S.channelId) === S.voiceKey;
}
function updateWants() {
  if (!S.voiceKey) return;
  const vis = stageVisible();
  const now = Date.now();
  for (const m of S.voice[S.voiceKey] || []) {
    const p = S.peers[m.id]; if (!p || m.id === S.me.id) continue;
    const want = {
      screen: vis || (pip?.kind === 'screen' && pip.id === m.id),
      cam: vis || (pip?.kind === 'cam' && pip.id === m.id),
    };
    const sent = p.sentWant || { screen: true, cam: true };
    const out = { ...sent };
    for (const k of ['screen', 'cam']) {
      if (want[k]) { out[k] = true; p.offSince && delete p.offSince[k]; }
      else if (sent[k]) { p.offSince ||= {}; p.offSince[k] ||= now; if (now - p.offSince[k] >= WANT_OFF_DELAY) out[k] = false; }
    }
    if (out.screen !== sent.screen || out.cam !== sent.cam) {
      p.sentWant = out;
      socket.emit('signal', { to: m.id, data: { want: out } });
    }
  }
}
let wantsT = null;
function scheduleWants() { clearTimeout(wantsT); wantsT = setTimeout(updateWants, 50); }
setInterval(() => { updateWants(); syncPip(); }, 1000);
document.addEventListener('visibilitychange', scheduleWants);

// ---------- WebRTC (malha, negociação "perfect negotiation") ----------
function getPeer(id) {
  if (S.peers[id]) return S.peers[id];
  const pc = new RTCPeerConnection(ICE);
  const p = { pc, polite: S.me.id < id, makingOffer: false, ignoreOffer: false, screenSenders: [], camSenders: [], media: {}, videos: {} };
  S.peers[id] = p;
  if (A.out) A.out.getAudioTracks().forEach((t) => { t.contentHint = 'speech'; pc.addTrack(t, A.out); });
  addScreenTo(p); addCamTo(p);

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
  if (hasVideo) { if (p.videos[stream.id] !== stream) { p.videos[stream.id] = stream; renderStage(); } }
  else if (p.videos[stream.id]) { delete p.videos[stream.id]; renderStage(); }
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
    } else if (data.want) { // quem assiste avisou o que está vendo
      p.want = { screen: data.want.screen !== false, cam: data.want.cam !== false };
      tuneSenders(p);
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
