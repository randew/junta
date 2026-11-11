// Junta — emojis personalizados e soundboard
'use strict';

// ---------- configurações: aba "Emojis e sons" ----------
function renderExprTab() {
  const s = ssServer(); if (!s) return;
  const emojis = s.emojis || [], sounds = s.sounds || [];
  $('emojiCount').textContent = `${emojis.length} de 60`;
  $('soundCount').textContent = `${sounds.length} de 40`;
  const eb = $('emojiList'); eb.replaceChildren();
  if (!emojis.length) eb.append(el('p', 'side-empty', 'Nenhum emoji ainda.'));
  for (const e of emojis) {
    const it = el('div', 'expr-item');
    it.append(customEmojiImg(e), el('span', 'expr-name', `:${e.name}:`));
    const del = el('button', 'icon-btn danger', '×'); del.type = 'button'; del.title = `Apagar :${e.name}:`; del.setAttribute('aria-label', del.title);
    del.onclick = async () => {
      const ok = await ask({ title: `Apagar :${e.name}:?`, text: 'Onde ele foi usado, volta a aparecer como texto.', noInput: true, ok: 'Apagar', danger: true });
      if (ok) api('DELETE', `/api/servers/${encodeURIComponent(s.id)}/emojis/${e.id}`).catch((x) => toast(x.message));
    };
    it.append(del); eb.append(it);
  }
  const sb = $('soundList'); sb.replaceChildren();
  if (!sounds.length) sb.append(el('p', 'side-empty', 'Nenhum som ainda.'));
  for (const so of sounds) {
    const row = el('div', 'sound-row');
    const play = el('button', 'icon-btn', '▶'); play.type = 'button'; play.title = 'Ouvir'; play.setAttribute('aria-label', `Ouvir ${so.name}`);
    play.onclick = () => playSoundFile(so.file, true);
    row.append(play, el('span', 'sound-emo', so.emoji || '🔊'), el('span', 'expr-name', so.name));
    const del = el('button', 'icon-btn danger', '×'); del.type = 'button'; del.title = `Apagar ${so.name}`; del.setAttribute('aria-label', del.title);
    del.onclick = async () => {
      const ok = await ask({ title: `Apagar o som "${so.name}"?`, noInput: true, ok: 'Apagar', danger: true });
      if (ok) api('DELETE', `/api/servers/${encodeURIComponent(s.id)}/sounds/${so.id}`).catch((x) => toast(x.message));
    };
    row.append(del); sb.append(row);
  }
}

const slug = (n) => n.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32);
async function uploadTo(url, file, fields) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  fd.append('file', file, file.name || 'arquivo');
  const r = await fetch(url, { method: 'POST', body: fd });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Não foi possível enviar.');
  return d;
}

// emoji: imagens paradas viram 128×128 (cabe tudo); GIF animado vai como está
$('emojiAdd').onclick = () => $('emojiFile').click();
$('emojiFile').onchange = async () => {
  const f = $('emojiFile').files[0]; $('emojiFile').value = '';
  const s = ssServer(); if (!f || !s) return;
  if (!/^image\/(png|jpeg|webp|gif)$/.test(f.type)) return toast('Escolha uma imagem PNG, JPG, WEBP ou GIF.');
  const r = await ask({ title: 'Nome do emoji', text: 'Letras minúsculas, números e _. Nas mensagens, ele aparece com :nome:.', value: slug(f.name) || 'emoji', ok: 'Enviar' });
  if (!r) return;
  try {
    let file = f;
    if (f.type !== 'image/gif') file = await fitImage(f, 128);
    else if (f.size > 512 * 1024) throw new Error('GIF animado de até 512 KB. Tente um menor.');
    const d = await uploadTo(`/api/servers/${encodeURIComponent(s.id)}/emojis`, file, { name: r.value.trim() });
    toast(`Emoji :${d.name}: adicionado.`);
  } catch (x) { toast(x.message); }
};
function fitImage(file, max) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(img.naturalWidth * k)); cv.height = Math.max(1, Math.round(img.naturalHeight * k));
      const g = cv.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(img.src);
      cv.toBlob((b) => (b ? resolve(new File([b], 'emoji.png', { type: 'image/png' })) : reject(new Error('Não consegui processar a imagem.'))), 'image/png');
    };
    img.onerror = () => reject(new Error('Não consegui abrir essa imagem.'));
    img.src = URL.createObjectURL(file);
  });
}

// som: confere a duração antes de enviar (até 6 segundos)
$('soundAdd').onclick = () => $('soundFile').click();
$('soundFile').onchange = async () => {
  const f = $('soundFile').files[0]; $('soundFile').value = '';
  const s = ssServer(); if (!f || !s) return;
  if (f.size > 1024 * 1024) return toast('O som pode ter no máximo 1 MB.');
  let secs = 0;
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    secs = (await ac.decodeAudioData(await f.arrayBuffer())).duration; ac.close();
  } catch { return toast('Não consegui ler esse áudio. Use MP3, OGG, WAV, WEBM ou M4A.'); }
  if (secs > 6.2) return toast(`Esse som tem ${secs.toFixed(1)} s. O limite é 6 segundos: corte um trecho e tente de novo.`);
  const base = f.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 32);
  const r = await ask({ title: 'Nome do som', text: 'Pode começar com um emoji, que aparece no botão (ex.: 🎉 Festa).', value: base, ok: 'Enviar' });
  if (!r) return;
  // um emoji no começo do nome vira o ícone do botão
  const m = /^\s*(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*)\s*(.*)$/u.exec(r.value);
  const emoji = m ? m[1] : '', name = (m ? m[2] : r.value).trim() || base;
  try { await uploadTo(`/api/servers/${encodeURIComponent(s.id)}/sounds`, f, { name, emoji }); toast(`Som "${name}" adicionado.`); }
  catch (x) { toast(x.message); }
};

// ---------- tocar ----------
const SB_KEY = 'junta:soundboard';
const sbCfg = (() => { try { return { on: true, vol: 70, ...JSON.parse(localStorage.getItem(SB_KEY)) }; } catch { return { on: true, vol: 70 }; } })();
const saveSb = () => { try { localStorage.setItem(SB_KEY, JSON.stringify(sbCfg)); } catch {} };
function syncSbUI() {
  $('sbOn').checked = sbCfg.on; $('sbVol').value = sbCfg.vol; $('sbVolVal').textContent = sbCfg.vol + '%';
  $('sbVolRow').hidden = !sbCfg.on;
}
$('settingsBtn').addEventListener('click', syncSbUI);
$('sbOn').onchange = () => { sbCfg.on = $('sbOn').checked; saveSb(); syncSbUI(); };
$('sbVol').oninput = () => { sbCfg.vol = +$('sbVol').value; saveSb(); $('sbVolVal').textContent = sbCfg.vol + '%'; };

const sbCache = new Map(); // arquivo → <audio> já carregado
function playSoundFile(file, preview) {
  if (!preview && !sbCfg.on) return;
  let base = sbCache.get(file);
  if (!base) { base = new Audio('/sons/' + file); base.preload = 'auto'; sbCache.set(file, base); }
  const a = base.cloneNode(); // vários sons ao mesmo tempo
  a.volume = Math.min(1, (preview ? 70 : sbCfg.vol) / 100);
  a.play().catch(() => {});
}
socket.on('sound', ({ file, name, emoji, by, key }) => {
  if (key !== S.voiceKey) return;
  playSoundFile(file);
  // aviso discreto no palco: quem tocou o quê
  const tag = el('div', 'sb-toast'); tag.textContent = `${emoji || '🔊'} ${userName(by)}: ${name}`;
  $('voiceView').append(tag);
  setTimeout(() => tag.classList.add('out'), 2200); setTimeout(() => tag.remove(), 2700);
});

// ---------- botão "Sons" na sala ----------
function voiceServer() { return S.voiceKey ? S.servers.find((s) => s.id === S.voiceKey.split('/')[0]) : null; }
function closeSoundPop() { $('soundPop').hidden = true; $('soundBtn').setAttribute('aria-expanded', 'false'); }
$('soundBtn').onclick = () => {
  const pop = $('soundPop');
  if (!pop.hidden) { closeSoundPop(); return; }
  const s = voiceServer(); if (!s) return;
  const sid = S.voiceKey.split('/')[0];
  const allowed = canChan(S.voiceKey, P.USE_SOUNDBOARD);
  pop.replaceChildren(el('h4', null, 'Soundboard'));
  if (!allowed) pop.append(el('p', 'side-empty', 'Você não tem permissão para usar o soundboard nesta sala.'));
  else if (!s.sounds?.length) {
    pop.append(el('p', 'side-empty', 'Este servidor ainda não tem sons.'));
    if (canSrv(P.MANAGE_EXPRESSIONS, sid)) {
      const b = el('button', 'ghost-btn', 'Enviar sons'); b.type = 'button';
      b.onclick = () => { closeSoundPop(); openServerSettings(sid); showSsTab('expr'); };
      pop.append(b);
    } else pop.append(el('small', 'help', 'Quem gerencia o servidor pode enviar em Configurações do servidor → Emojis e sons.'));
  } else {
    const grid = el('div', 'sound-grid');
    for (const so of s.sounds) {
      const b = el('button', 'sound-btn'); b.type = 'button';
      b.append(el('span', 'sound-emo', so.emoji || '🔊'), el('span', 'expr-name', so.name));
      b.onclick = () => emitP('sound-play', so.id).catch((x) => toast(x.message));
      grid.append(b);
    }
    pop.append(grid);
    if (!sbCfg.on) pop.append(el('small', 'help', 'Você desligou o som do soundboard em Áudio: os outros ouvem, você não.'));
  }
  pop.hidden = false; $('soundBtn').setAttribute('aria-expanded', 'true');
  const r = $('soundBtn').getBoundingClientRect();
  const W = pop.offsetWidth, H = pop.offsetHeight;
  pop.style.left = Math.max(8, Math.min(innerWidth - W - 8, r.left + r.width / 2 - W / 2)) + 'px';
  pop.style.top = Math.max(8, r.top - H - 8) + 'px';
};
document.addEventListener('mousedown', (e) => { if (!$('soundPop').hidden && !e.target.closest('#soundPop, #soundBtn')) closeSoundPop(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('soundPop').hidden) closeSoundPop(); });
