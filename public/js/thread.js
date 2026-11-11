// Junta — threads (conversas paralelas a partir de uma mensagem) e mensagens fixadas
'use strict';

// ---------- threads ----------
// S.thread = { key, root, messages, more } enquanto o painel está aberto
const relTime = (ts) => {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'agora';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  return dayLabel(ts).toLowerCase();
};
function threadChip(m) {
  const b = el('button', 'thread-chip'); b.type = 'button';
  const n = m.thread.n;
  const who = m.thread.lastUid ? avatar(userName(m.thread.lastUid), m.thread.lastUid) : null;
  if (who) b.append(who);
  b.append(el('strong', null, `${n} ${n === 1 ? 'resposta' : 'respostas'}`), el('span', null, `última ${relTime(m.thread.last)}`));
  b.title = 'Abrir a thread';
  b.onclick = () => openThread(m.id);
  return b;
}

async function openThread(id, flash) {
  let d;
  try { d = await emitP('thread', { id }); } catch (x) { toast(x.message); return; }
  if (d.key !== curKey()) return;
  closeSearch();
  S.thread = { key: d.key, root: d.root, messages: d.messages, more: d.more };
  $('threadPanel').hidden = false; $('app').classList.add('threading');
  const c = isDmKey(d.key) ? null : textChannel();
  $('threadWhere').textContent = c ? `em #${c.name}` : '';
  const ok = canHere(P.SEND);
  $('threadForm').hidden = !ok; $('threadNoSend').hidden = ok;
  renderThread(true, flash);
  if (ok && !flash) $('threadInput').focus();
  markThreadRead();
}
function closeThread() {
  if (!S.thread) return;
  S.thread = null;
  $('threadPanel').hidden = true; $('app').classList.remove('threading');
  $('threadMsgs').replaceChildren();
}
$('threadClose').onclick = () => closeThread();
$('threadPanel').addEventListener('keydown', (e) => { if (e.key === 'Escape' && !editingId && document.activeElement?.closest('#threadPanel')) { e.preventDefault(); closeThread(); input.focus(); } });

function renderThread(toBottom, flash) {
  const t = S.thread; if (!t) return;
  const box = $('threadMsgs');
  const near = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
  box.replaceChildren();
  const root = el('div', 'thread-root'); root.append(msgNode(t.root, null, { thread: true }));
  box.append(root);
  const n = t.root.thread?.n || 0;
  box.append(el('div', 'thread-sep', n ? `${n} ${n === 1 ? 'resposta' : 'respostas'}` : 'Ninguém respondeu ainda. Comece a conversa!'));
  if (t.more) {
    const older = el('button', 'ghost thread-older', 'Ver respostas anteriores'); older.type = 'button';
    older.onclick = async () => {
      const d = await emitP('thread', { id: t.root.id, before: t.messages[0]?.seq }).catch(() => null);
      if (!d || S.thread !== t) return;
      t.messages = [...d.messages, ...t.messages]; t.more = d.more; renderThread();
    };
    box.append(older);
  }
  t.messages.forEach((m, i) => box.append(msgNode(m, t.messages[i - 1], { thread: true })));
  if (flash) {
    const node = box.querySelector(`[data-id="${CSS.escape(flash)}"]`);
    node?.classList.add('flash'); node?.scrollIntoView({ block: 'center' });
    setTimeout(() => node?.classList.remove('flash'), 2500);
  } else if (toBottom || near) box.scrollTop = box.scrollHeight;
}

// eventos repassados pelo chat.js
function threadIncoming(msg) {
  const t = S.thread;
  if (!t || msg.threadRoot !== t.root.id) return;
  t.messages.push(msg);
  renderThread(msg.uid === S.me.uid);
  markThreadRead();
}
function threadUpdate(msg) {
  const t = S.thread; if (!t) return;
  if (msg.id === t.root.id) { t.root = msg; renderThread(); return; }
  const i = t.messages.findIndex((x) => x.id === msg.id);
  if (i >= 0) { t.messages[i] = msg; renderThread(); }
}
function threadDelete(id) {
  const t = S.thread; if (!t) return;
  if (id === t.root.id) { closeThread(); toast('A mensagem que começou a thread foi apagada.'); return; }
  if (t.messages.some((x) => x.id === id)) { t.messages = t.messages.filter((x) => x.id !== id); renderThread(); }
}
// quem está com a thread aberta leu as respostas (e as menções nelas)
function markThreadRead() {
  const t = S.thread;
  if (!t || !t.messages.length || document.hidden || !document.hasFocus() || !S.atLatest) return;
  const seq = Math.max(...t.messages.map((m) => m.seq));
  socket.emit('read', { key: t.key, seq });
}

// compositor da thread: Enter envia, Shift+Enter quebra a linha
const tInput = $('threadInput');
const tAutosize = () => { tInput.style.height = 'auto'; tInput.style.height = Math.min(tInput.scrollHeight, 160) + 'px'; };
tInput.addEventListener('input', tAutosize);
tInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('threadForm').requestSubmit(); }
});
$('threadEmojiBtn').onclick = () => openEmojiPicker($('threadEmojiBtn'), (e) => {
  const s = tInput.selectionStart ?? tInput.value.length;
  tInput.value = tInput.value.slice(0, s) + e + tInput.value.slice(tInput.selectionEnd ?? s);
  tInput.focus(); tInput.selectionStart = tInput.selectionEnd = s + e.length; tAutosize();
});
$('threadForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const t = S.thread; const text = tInput.value.trim();
  if (!t || !text) return;
  tInput.value = ''; tAutosize();
  try { await emitP('message', { key: t.key, text, att: [], thread: t.root.id }); }
  catch (x) { toast(x.message); tInput.value = text; tAutosize(); }
});

// ---------- mensagens fixadas ----------
function togglePin(m) {
  emitP('pin', { id: m.id, on: !m.pinned })
    .then(() => toast(m.pinned ? 'Mensagem desafixada.' : 'Mensagem fixada no canal. Veja todas no 📌 do topo.'))
    .catch((x) => toast(x.message));
}
let pinsKey = null;
async function openPins() {
  const key = curKey(); if (!key) return;
  const pop = $('pinsPop');
  if (!pop.hidden && pinsKey === key) { closePins(); return; }
  pinsKey = key;
  pop.replaceChildren(el('p', 'side-empty', 'Carregando…'));
  pop.hidden = false; $('pinsBtn').setAttribute('aria-expanded', 'true');
  placePins();
  await fillPins();
}
async function fillPins() {
  const key = pinsKey, pop = $('pinsPop');
  let d; try { d = await emitP('pins', key); } catch { d = { messages: [] }; }
  if (key !== pinsKey || pop.hidden) return;
  pop.replaceChildren(el('h4', null, 'Mensagens fixadas'));
  if (!d.messages.length) {
    pop.append(el('p', 'side-empty', d.canPin ? 'Nada fixado ainda. Passe o mouse numa mensagem e clique no 📌 para fixar.' : 'Nada fixado neste canal ainda.'));
    return;
  }
  for (const m of d.messages) {
    const card = el('div', 'pin-card');
    const head = el('div', 'sr-head');
    head.append(avatar(userName(m.uid), m.uid), el('span', 'sr-name', userName(m.uid)), el('span', 'sr-when', `${dayLabel(m.ts)} ${time(m.ts)}`));
    const body = el('div', 'sr-body');
    if (m.text && isGifUrl(m.text)) body.append(gifNode(m.text)); else renderRich(m.text || (m.att.length ? '📎 anexo' : ''), body);
    const acts = el('div', 'pin-acts');
    const go = el('button', 'ghost', 'Ir até a mensagem'); go.type = 'button';
    go.onclick = () => { closePins(); jumpTo(key, m.seq, m.id); };
    acts.append(go);
    if (d.canPin) {
      const un = el('button', 'ghost', 'Desafixar'); un.type = 'button';
      un.onclick = () => emitP('pin', { id: m.id, on: false }).catch((x) => toast(x.message));
      acts.append(un);
    }
    card.append(head, body, acts);
    pop.append(card);
  }
}
// abaixo do botão, alinhado pela direita, mas sempre dentro da tela (no celular, de ponta a ponta)
function placePins() {
  const pop = $('pinsPop'), r = $('pinsBtn').getBoundingClientRect(), m = 8;
  const W = Math.min(420, innerWidth - m * 2);
  pop.style.width = W + 'px'; pop.style.right = 'auto';
  pop.style.left = Math.max(m, Math.min(innerWidth - W - m, r.right - W)) + 'px';
  pop.style.top = (r.bottom + 6) + 'px';
  pop.style.maxHeight = Math.max(200, Math.min(560, innerHeight - r.bottom - 6 - m)) + 'px';
}
addEventListener('resize', () => { if (!$('pinsPop').hidden) placePins(); });
function closePins() { $('pinsPop').hidden = true; pinsKey = null; $('pinsBtn').setAttribute('aria-expanded', 'false'); }
$('pinsBtn').onclick = openPins;
document.addEventListener('mousedown', (e) => { if (!$('pinsPop').hidden && !e.target.closest('#pinsPop, #pinsBtn')) closePins(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('pinsPop').hidden) closePins(); });
socket.on('pins-changed', ({ key, by, on }) => {
  if (key === pinsKey && !$('pinsPop').hidden) fillPins();
  if (key === curKey() && by !== S.me.uid && on) toast(`${userName(by)} fixou uma mensagem neste canal.`);
});
