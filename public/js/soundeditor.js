// Junta — editor de sons do soundboard
// Abre qualquer áudio (ou o som de um vídeo), deixa escolher um trecho de até 6 segundos,
// ajustar volume, normalizar e suavizar começo e fim, e gera um WAV mono que cabe no limite.
// Tudo acontece no navegador: o arquivo original nunca é enviado.
'use strict';

const SE_MAX = 6;            // segundos
const SE_RATE = 48000;       // WAV final: mono, 16 bits, 48 kHz → 6 s ≈ 576 KB
const SE_MIN = 0.1;
const SE_IN_MAX_MB = 200;    // arquivo de entrada (o que o navegador aguenta decodificar)
const se = { buf: null, mono: null, start: 0, end: 0, dur: 0, view: [0, 0], peaks: null, replace: null, playing: null, ctx: null, raf: 0 };

const seFmt = (t) => { const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(2).padStart(5, '0')}`; };

async function openSoundEditor(file, { name = '', replace = null } = {}) {
  if (file.size > SE_IN_MAX_MB * 1048576) return toast(`Arquivo grande demais (máximo ${SE_IN_MAX_MB} MB).`);
  toast('Abrindo o áudio…');
  let buf;
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    buf = await ac.decodeAudioData(await file.arrayBuffer()); ac.close();
  } catch { return toast('Não consegui ler o som desse arquivo. Tente MP3, OGG, WAV, M4A ou um vídeo MP4.'); }
  // mistura os canais (só para desenhar e medir; o corte final usa o áudio original)
  const mono = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) mono[i] += d[i] / buf.numberOfChannels; }
  Object.assign(se, { buf, mono, dur: buf.duration, replace, start: 0, end: Math.min(buf.duration, SE_MAX) });
  // som longo: começa no trecho mais alto (costuma ser o "momento" que a pessoa quer)
  if (buf.duration > SE_MAX * 1.5) {
    const win = Math.floor(SE_MAX * buf.sampleRate), hop = Math.floor(buf.sampleRate / 4);
    let best = 0, bestAt = 0, acc = 0;
    const sq = (i) => mono[i] * mono[i];
    for (let i = 0; i < Math.min(win, mono.length); i++) acc += sq(i);
    best = acc;
    for (let s = hop; s + win <= mono.length; s += hop) {
      for (let i = s - hop; i < s; i++) acc -= sq(i);
      for (let i = s + win - hop; i < s + win; i++) acc += sq(i);
      if (acc > best) { best = acc; bestAt = s; }
    }
    // e começa onde o som de verdade começa dentro desse trecho
    let pk = 0; for (let i = bestAt; i < bestAt + win; i += 16) pk = Math.max(pk, Math.abs(mono[i]));
    let i = bestAt; while (i < bestAt + win && Math.abs(mono[i]) < pk * 0.2) i++;
    se.start = Math.max(0, i / buf.sampleRate - 0.03); se.end = Math.min(buf.duration, se.start + SE_MAX);
  }
  $('seInfo').textContent = `${file.name || 'som'} · ${seFmt(buf.duration)} · ${buf.numberOfChannels === 1 ? 'mono' : 'estéreo'}. Arraste na onda para escolher o trecho (até ${SE_MAX} s) e as alças para ajustar.`;
  $('seName').value = name || (file.name || '').replace(/\.[a-z0-9]+$/i, '').slice(0, 32);
  $('seGain').value = 0; $('seGainVal').textContent = '0 dB';
  $('seSave').textContent = replace ? 'Salvar alterações' : 'Enviar som';
  $('soundEditor').hidden = false;
  seFitView(true);
  seDraw();
  $('seName').focus();
}

// ---------- janela de detalhe: acompanha o trecho, com uma folga dos lados ----------
function seFitView(force) {
  const len = Math.min(se.dur, Math.max(SE_MAX * 1.6, (se.end - se.start) * 1.6));
  const [a, b] = se.view;
  if (!force && se.start >= a && se.end <= b && b - a === len) return;
  let v0 = (se.start + se.end) / 2 - len / 2;
  v0 = Math.max(0, Math.min(se.dur - len, v0));
  se.view = [v0, v0 + len];
}
function seCanvas(cv) {
  const dpr = Math.min(devicePixelRatio || 1, 2), w = cv.clientWidth, h = cv.clientHeight;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  return { g, w, h };
}
// desenha a onda entre t0 e t1 (pico de cada coluna de pixels)
function seWave(g, w, h, t0, t1, color) {
  const sr = se.buf.sampleRate, d = se.mono;
  const a = Math.floor(t0 * sr), b = Math.floor(t1 * sr), per = Math.max(1, (b - a) / w);
  g.fillStyle = color;
  for (let x = 0; x < w; x++) {
    let lo = 0, hi = 0;
    const i0 = Math.floor(a + x * per), i1 = Math.min(d.length, Math.floor(a + (x + 1) * per));
    const step = Math.max(1, Math.floor((i1 - i0) / 200)); // amostra colunas muito largas
    for (let i = i0; i < i1; i += step) { const v = d[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
    const y1 = h / 2 - hi * h / 2, y2 = h / 2 - lo * h / 2;
    g.fillRect(x, y1, 1, Math.max(1, y2 - y1));
  }
}
const seCss = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
function seDraw(playhead) {
  if (!se.buf) return;
  const amber = seCss('--amber'), dim = seCss('--fg-dim'), ink = seCss('--ink-4');
  // visão geral
  { const { g, w, h } = seCanvas($('seOverview'));
    seWave(g, w, h, 0, se.dur, dim);
    const x0 = se.start / se.dur * w, x1 = se.end / se.dur * w;
    g.fillStyle = amber + '44'; g.fillRect(x0, 0, Math.max(2, x1 - x0), h);
    g.strokeStyle = ink; g.lineWidth = 1;
    const v0 = se.view[0] / se.dur * w, v1 = se.view[1] / se.dur * w; g.strokeRect(v0 + .5, .5, v1 - v0 - 1, h - 1); }
  // detalhe
  const cv = $('seWave'); const { g, w, h } = seCanvas(cv);
  const [t0, t1] = se.view, X = (t) => (t - t0) / (t1 - t0) * w;
  g.fillStyle = amber + '22'; g.fillRect(X(se.start), 0, X(se.end) - X(se.start), h);
  seWave(g, w, h, t0, t1, dim);
  g.save(); g.beginPath(); g.rect(X(se.start), 0, X(se.end) - X(se.start), h); g.clip(); seWave(g, w, h, t0, t1, amber); g.restore();
  // marcas de segundo
  g.fillStyle = dim; g.font = '10px system-ui, sans-serif';
  for (let s = Math.ceil(t0); s <= t1; s++) { const x = X(s); g.fillRect(x, h - 6, 1, 6); if (x > 12 && x < w - 20) g.fillText(seFmt(s).replace(/\.00$/, ''), x + 3, h - 8); }
  if (playhead != null) { g.fillStyle = seCss('--fg'); g.fillRect(X(playhead), 0, 2, h); }
  // alças
  $('seStartH').style.left = X(se.start) + 'px'; $('seEndH').style.left = X(se.end) + 'px';
  for (const [hd, v] of [[$('seStartH'), se.start], [$('seEndH'), se.end]]) { hd.setAttribute('aria-valuetext', seFmt(v)); }
  const len = se.end - se.start;
  $('seRange').textContent = `${seFmt(se.start)} → ${seFmt(se.end)}`;
  $('seLen').textContent = `${len.toFixed(1).replace('.', ',')} s de ${SE_MAX}`;
  $('seLen').classList.toggle('full', len >= SE_MAX - 0.01);
  $('seSize').textContent = `Arquivo final: WAV mono, cerca de ${Math.round((44 + len * SE_RATE * 2) / 1024)} KB (limite 1 MB).`;
}

// ---------- seleção com o mouse ou o dedo ----------
function seSet(start, end, moved) {
  start = Math.max(0, start); end = Math.min(se.dur, end);
  if (end - start > SE_MAX) { if (moved === 'start') start = end - SE_MAX; else end = start + SE_MAX; }
  if (end - start < SE_MIN) { if (moved === 'start') start = end - SE_MIN; else end = start + SE_MIN; }
  se.start = Math.max(0, start); se.end = Math.min(se.dur, end);
  if (!seDrag) seFitView(); // enquanto arrasta, a janela fica parada (senão a onda foge do dedo)
  seDraw();
}
function seTimeAt(e) { const r = $('seWave').getBoundingClientRect(); return se.view[0] + (e.clientX - r.left) / r.width * (se.view[1] - se.view[0]); }
let seDrag = null;
$('seWaveWrap').addEventListener('pointerdown', (e) => {
  if (!se.buf || e.button !== 0) return;
  const t = seTimeAt(e);
  const tol = 10 / $('seWave').clientWidth * (se.view[1] - se.view[0]);
  if (e.target.id === 'seStartH' || Math.abs(t - se.start) < tol) seDrag = { kind: 'start' };
  else if (e.target.id === 'seEndH' || Math.abs(t - se.end) < tol) seDrag = { kind: 'end' };
  else if (t > se.start && t < se.end) seDrag = { kind: 'move', off: t - se.start, len: se.end - se.start };
  else { seDrag = { kind: 'new', anchor: t }; seSet(t, t + SE_MIN, 'end'); }
  $('seWaveWrap').setPointerCapture(e.pointerId); e.preventDefault();
  seStop();
});
$('seWaveWrap').addEventListener('pointermove', (e) => {
  if (!seDrag) return;
  const t = seTimeAt(e);
  if (seDrag.kind === 'start') seSet(Math.min(t, se.end - SE_MIN), se.end, 'start');
  else if (seDrag.kind === 'end') seSet(se.start, Math.max(t, se.start + SE_MIN), 'end');
  else if (seDrag.kind === 'move') { let s = Math.max(0, Math.min(se.dur - seDrag.len, t - seDrag.off)); se.start = s; se.end = s + seDrag.len; seFitViewSoft(); seDraw(); }
  else { const a = seDrag.anchor; if (t >= a) seSet(a, t, 'end'); else seSet(t, a, 'start'); }
});
// ao mover o trecho inteiro, a janela só anda quando o trecho encosta na borda
function seFitViewSoft() {
  const [a, b] = se.view, len = b - a;
  if (se.start < a) se.view = [se.start, se.start + len];
  else if (se.end > b) se.view = [se.end - len, se.end];
  se.view = [Math.max(0, se.view[0]), Math.min(se.dur, se.view[0] + len)];
}
const seUp = () => { if (seDrag) { seDrag = null; seFitView(); seDraw(); } };
$('seWaveWrap').addEventListener('pointerup', seUp);
$('seWaveWrap').addEventListener('pointercancel', seUp);
// visão geral: clicar ou arrastar leva o trecho para lá
let seOvDrag = false;
const seOvMove = (e) => {
  const r = $('seOverview').getBoundingClientRect();
  const t = (e.clientX - r.left) / r.width * se.dur, len = se.end - se.start;
  const s = Math.max(0, Math.min(se.dur - len, t - len / 2));
  se.start = s; se.end = s + len; seFitView(true); seDraw();
};
$('seOverview').addEventListener('pointerdown', (e) => { if (!se.buf) return; seOvDrag = true; $('seOverview').setPointerCapture(e.pointerId); seStop(); seOvMove(e); });
$('seOverview').addEventListener('pointermove', (e) => { if (seOvDrag) seOvMove(e); });
$('seOverview').addEventListener('pointerup', () => { seOvDrag = false; });
// alças pelo teclado: setas movem 0,05 s (com Shift, 0,5 s)
for (const [id, kind] of [['seStartH', 'start'], ['seEndH', 'end']]) {
  $(id).addEventListener('keydown', (e) => {
    const d = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0; if (!d) return;
    e.preventDefault(); const step = (e.shiftKey ? 0.5 : 0.05) * d;
    if (kind === 'start') seSet(Math.min(se.start + step, se.end - SE_MIN), se.end, 'start'); else seSet(se.start, Math.max(se.end + step, se.start + SE_MIN), 'end');
  });
}
addEventListener('resize', () => { if (!$('soundEditor').hidden) seDraw(); });

// ---------- pular silêncio ----------
$('seTrim').onclick = () => {
  const sr = se.buf.sampleRate, d = se.mono;
  let peak = 0; for (let i = 0; i < d.length; i += 64) peak = Math.max(peak, Math.abs(d[i]));
  const th = Math.max(0.01, peak * 0.06);
  let i = Math.floor(se.start * sr); while (i < d.length && Math.abs(d[i]) < th) i++;
  if (i >= d.length) return toast('Não achei som depois do início do trecho.');
  const s = Math.max(0, i / sr - 0.03), len = Math.min(SE_MAX, se.dur - s);
  seSet(s, s + len, 'end');
};

// ---------- volume, normalização e fades ----------
$('seGain').oninput = () => { const v = +$('seGain').value; $('seGainVal').textContent = `${v > 0 ? '+' : ''}${v} dB`; };
// gera o trecho final (mono, 48 kHz) com todos os ajustes
async function seRender() {
  const len = se.end - se.start, frames = Math.ceil(len * SE_RATE);
  const off = new OfflineAudioContext(1, frames, SE_RATE);
  const src = off.createBufferSource(); src.buffer = se.buf;
  const gain = off.createGain();
  let g = Math.pow(10, +$('seGain').value / 20);
  if ($('seNorm').checked) { // pico do trecho em -1 dB
    const sr = se.buf.sampleRate; let peak = 0;
    for (let c = 0; c < se.buf.numberOfChannels; c++) { const d = se.buf.getChannelData(c); for (let i = Math.floor(se.start * sr); i < Math.min(d.length, se.end * sr); i++) peak = Math.max(peak, Math.abs(d[i])); }
    if (peak > 0.0001) g *= 0.891 / peak;
  }
  const fi = $('seFadeIn').checked ? Math.min(0.03, len / 4) : 0, fo = $('seFadeOut').checked ? Math.min(0.25, len / 3) : 0;
  gain.gain.setValueAtTime(fi ? 0 : g, 0);
  if (fi) gain.gain.linearRampToValueAtTime(g, fi);
  if (fo) { gain.gain.setValueAtTime(g, Math.max(fi, len - fo)); gain.gain.linearRampToValueAtTime(0, len); }
  src.connect(gain).connect(off.destination);
  src.start(0, se.start, len);
  const out = await off.startRendering();
  // limitador simples: nada passa de 0 dBFS (aumentar o volume não distorce)
  const d = out.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.max(-1, Math.min(1, d[i]));
  return out;
}
function seWav(ab) {
  const d = ab.getChannelData(0), n = d.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, SE_RATE, true);
  v.setUint32(28, SE_RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, d[i] < 0 ? d[i] * 0x8000 : d[i] * 0x7fff, true);
  return new Blob([buf], { type: 'audio/wav' });
}

// ---------- ouvir ----------
function seStop() {
  if (se.playing) { try { se.playing.stop(); } catch {} se.playing = null; }
  cancelAnimationFrame(se.raf); $('sePlay').textContent = '▶ Ouvir trecho'; seDraw();
}
$('sePlay').onclick = async () => {
  if (se.playing) { seStop(); return; }
  const out = await seRender();
  se.ctx ||= new (window.AudioContext || window.webkitAudioContext)();
  await se.ctx.resume();
  const src = se.ctx.createBufferSource(); src.buffer = out;
  const vol = se.ctx.createGain(); vol.gain.value = Math.min(1, (typeof sbCfg !== 'undefined' ? sbCfg.vol : 70) / 100);
  src.connect(vol).connect(se.ctx.destination);
  const t0 = se.ctx.currentTime; src.start();
  se.playing = src; $('sePlay').textContent = '■ Parar';
  src.onended = () => { if (se.playing === src) seStop(); };
  const tick = () => { if (se.playing !== src) return; seDraw(se.start + (se.ctx.currentTime - t0)); se.raf = requestAnimationFrame(tick); };
  tick();
};

// ---------- enviar ----------
function closeSoundEditor() { seStop(); $('soundEditor').hidden = true; se.buf = null; se.mono = null; }
$('seCancel').onclick = closeSoundEditor;
$('soundEditor').addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('modal').hidden) { e.stopPropagation(); closeSoundEditor(); } });
$('seSave').onclick = async () => {
  const s = ssServer(); if (!s || !se.buf) return;
  const raw = $('seName').value.trim();
  const m = /^\s*(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*)\s*(.*)$/u.exec(raw);
  const emoji = m ? m[1] : '', name = (m ? m[2] : raw).trim();
  if (!name) { toast('Dê um nome ao som.'); $('seName').focus(); return; }
  $('seSave').disabled = true;
  try {
    seStop();
    const wav = seWav(await seRender());
    if (wav.size > 1024 * 1024) throw new Error('O trecho ficou grande demais. Encurte um pouco.');
    const file = new File([wav], 'som.wav', { type: 'audio/wav' });
    await uploadTo(`/api/servers/${encodeURIComponent(s.id)}/sounds`, file, { name, emoji });
    if (se.replace) await api('DELETE', `/api/servers/${encodeURIComponent(s.id)}/sounds/${se.replace}`).catch(() => {});
    toast(se.replace ? `Som "${name}" atualizado.` : `Som "${name}" adicionado.`);
    closeSoundEditor();
  } catch (x) { toast(x.message); }
  finally { $('seSave').disabled = false; }
};
$('seName').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('seSave').click(); } });

// editar um som que já está no servidor (corta de novo, muda o nome ou o volume)
async function editExistingSound(so) {
  try {
    const r = await fetch('/sons/' + so.file); if (!r.ok) throw new Error();
    const blob = await r.blob();
    await openSoundEditor(new File([blob], so.name, { type: blob.type }), { name: (so.emoji ? so.emoji + ' ' : '') + so.name, replace: so.id });
  } catch { toast('Não consegui abrir esse som.'); }
}
