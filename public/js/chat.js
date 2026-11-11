// Junta — mensagens: histórico, envio, respostas, reações, prévias de links e anexos
'use strict';

const fmtSize = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const attUrl = (a) => `/anexos/${a.id}/${encodeURIComponent(a.name)}`;
let editingId = null, confirmDel = null, stickBottom = true, flashId = null;
const ICON = {
  reply: '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z"/></svg>',
  react: '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8zm-3.5-9A1.5 1.5 0 1 0 7 9.5 1.5 1.5 0 0 0 8.5 11zm7 0A1.5 1.5 0 1 0 14 9.5a1.5 1.5 0 0 0 1.5 1.5zM12 17.5a5.5 5.5 0 0 0 5.1-3.5H6.9a5.5 5.5 0 0 0 5.1 3.5z"/></svg>',
  edit: '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zm17.71-10.21a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>',
  del: '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>',
};
const iconBtn = (cls, label, svg, onclick) => { const b = el('button', 'icon-btn ' + cls); b.type = 'button'; b.title = label; b.setAttribute('aria-label', label); b.innerHTML = svg; b.onclick = onclick; return b; };

// ---------- anexos e prévias ----------
function attNode(a) {
  if (/^image\/(png|jpe?g|gif|webp|avif)$/.test(a.mime)) {
    const lk = el('a', 'att-img'); lk.href = attUrl(a); lk.target = '_blank'; lk.rel = 'noopener';
    const img = el('img'); img.src = attUrl(a); img.alt = a.name; img.loading = 'lazy';
    img.onload = keepBottom;
    lk.append(img); return lk;
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
function embedNode(e) {
  const card = el('div', 'embed'); if (e.color) card.style.borderLeftColor = e.color;
  const txt = el('div', 'embed-txt');
  txt.append(el('div', 'embed-site', e.site));
  const t = el('a', 'embed-title', e.title); t.href = e.url; t.target = '_blank'; t.rel = 'noopener noreferrer'; txt.append(t);
  if (e.description) txt.append(el('p', 'embed-desc', e.description));
  card.append(txt);
  if (e.image) {
    const lk = el('a', 'embed-img'); lk.href = e.url; lk.target = '_blank'; lk.rel = 'noopener noreferrer';
    const img = el('img'); img.src = e.image; img.alt = ''; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer';
    img.onload = keepBottom; img.onerror = () => lk.remove();
    lk.append(img); card.append(lk);
  }
  return card;
}

// ---------- uma mensagem ----------
function reactionsNode(m) {
  const box = el('div', 'reactions');
  for (const r of m.reactions) {
    const mine = r.users.includes(S.me.uid);
    const b = el('button', 'react' + (mine ? ' mine' : '')); b.type = 'button';
    b.append(el('span', 'remoji', r.e), el('span', 'rcount', String(r.users.length)));
    const names = r.users.map((u) => userName(u)).join(', ');
    b.title = `${names} reagiu com ${r.e}`; b.setAttribute('aria-label', `${r.e} ${r.users.length}. ${mine ? 'Clique para tirar a sua reação' : 'Clique para reagir também'}`);
    b.setAttribute('aria-pressed', String(mine));
    b.onclick = () => react(m.id, r.e);
    box.append(b);
  }
  if (canHere(P.REACT)) {
    const add = el('button', 'react add'); add.type = 'button'; add.title = 'Adicionar reação'; add.setAttribute('aria-label', 'Adicionar reação');
    add.innerHTML = ICON.react; add.onclick = () => openEmojiPicker(add, (e) => react(m.id, e));
    box.append(add);
  }
  return box;
}
function replyQuote(m) {
  const q = el('button', 'reply-quote'); q.type = 'button';
  if (m.reply.missing) { q.append(el('span', 'rq-text', 'A mensagem original foi apagada.')); q.disabled = true; return q; }
  const name = userName(m.reply.uid);
  q.append(avatar(name, m.reply.uid), el('span', 'rq-name', name), el('span', 'rq-text', plainPreview(m.reply.text) || (m.reply.att ? '📎 anexo' : '')));
  q.title = 'Ir até a mensagem respondida';
  q.onclick = () => jumpTo(curKey(), m.reply.seq, m.reply.id);
  return q;
}

function msgNode(m, prev) {
  const name = userName(m.uid);
  const grouped = !m.reply && prev && prev.uid === m.uid && m.ts - prev.ts < 5 * 60e3 && dayLabel(prev.ts) === dayLabel(m.ts);
  const hitMe = m.uid !== S.me.uid && (mentionsMe(m.text) || m.everyone || m.reply?.uid === S.me.uid);
  const row = el('div', 'msg' + (grouped ? '' : ' head') + (editingId === m.id ? ' editing' : '') + (hitMe ? ' mentioned' : '') + (flashId === m.id ? ' flash' : ''));
  row.dataset.id = m.id;
  if (m.reply) row.append(replyQuote(m));
  if (grouped) {
    row.append(el('div', 'side', time(m.ts)));
  } else {
    const av = avatar(name, m.uid); av.classList.add('clickable'); av.onclick = () => openCard(m.uid, av); row.append(av);
    const meta = el('div', 'meta'); const who = el('button', 'who', name); who.type = 'button';
    who.style.color = (S.home ? null : roleColor(m.uid)) || S.users.get(m.uid)?.color || colorFor(name); who.onclick = () => openCard(m.uid, who);
    meta.append(who, el('span', 'when', `${dayLabel(m.ts)} ${time(m.ts)}`)); row.append(meta);
  }
  const body = el('div', 'body');
  if (editingId === m.id) {
    const ta = el('textarea', 'edit-box'); ta.value = m.text; ta.rows = 1; ta.setAttribute('aria-label', 'Editar mensagem');
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); renderMessages(); }
      else if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); saveEdit(m, ta.value); }
    });
    ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; });
    body.append(ta, el('small', 'edit-hint', 'Enter salva · Esc cancela'));
    setTimeout(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); ta.style.height = ta.scrollHeight + 'px'; }, 0);
  } else {
    if (m.text) renderRich(m.text, body);
    if (m.edited) { const ed = el('span', 'edited', ' (editado)'); ed.title = `${dayLabel(m.edited)} ${time(m.edited)}`; body.append(ed); }
  }
  row.append(body);
  if (m.att?.length) { const box = el('div', 'atts'); m.att.forEach((a) => box.append(attNode(a))); row.append(box); }
  if (m.embeds?.length && editingId !== m.id) { const box = el('div', 'embeds'); m.embeds.forEach((e) => box.append(embedNode(e))); row.append(box); }
  if (m.reactions?.length) row.append(reactionsNode(m));

  if (editingId !== m.id) {
    const mine = m.uid === S.me.uid;
    const act = el('div', 'msg-actions');
    if (canHere(P.REACT)) { const rb = iconBtn('', 'Reagir', ICON.react, () => openEmojiPicker(rb, (e) => react(m.id, e))); act.append(rb); }
    if (canHere(P.SEND)) act.append(iconBtn('', 'Responder', ICON.reply, () => startReply(m)));
    if (mine) act.append(iconBtn('', 'Editar', ICON.edit, () => startEdit(m.id)));
    if (mine || (!S.home && canHere(P.MANAGE_MESSAGES))) {
      act.append(iconBtn('danger', 'Apagar (Shift+clique apaga sem perguntar)', ICON.del, (e) => { if (e.shiftKey) deleteMessage(m.id); else { confirmDel = m.id; renderMessages(); } }));
    }
    row.append(act);
  }
  if (confirmDel === m.id) {
    const bar = el('div', 'del-confirm'); bar.append(el('span', null, 'Apagar esta mensagem para todos?'));
    const yes = el('button', 'danger-btn', 'Apagar'); yes.onclick = () => deleteMessage(m.id);
    const no = el('button', 'ghost', 'Cancelar'); no.onclick = () => { confirmDel = null; renderMessages(); };
    bar.append(no, yes); row.append(bar); setTimeout(() => yes.focus(), 0);
  }
  return row;
}

// ---------- a conversa ----------
function welcomeNode() {
  const w = el('div', 'welcome');
  if (S.home && S.dmKey) {
    const uid = dmOther(S.dmKey); const name = userName(uid);
    const big = avatar(name, uid); big.classList.add('big-av'); w.append(big);
    w.append(el('h3', null, name), el('p', null, `Este é o começo da sua conversa com ${name}. Só vocês dois veem estas mensagens.`));
  } else {
    const c = textChannel();
    w.append(el('div', 'big', '#'), el('h3', null, `Bem-vindo a #${c?.name}`), el('p', null, `Este é o começo do canal #${c?.name}.`));
  }
  return w;
}

// No máximo MAX_MSGS mensagens ficam na tela: ao rolar, as do outro extremo saem e voltam
// a ser buscadas no servidor quando você rolar de volta. Assim a página não pesa com o tempo.
const MAX_MSGS = 250, TRIM_STEP = 50;
// a mensagem no topo da área visível e a distância dela até o topo
function anchorOf(box) {
  const top = box.getBoundingClientRect().top;
  for (const n of box.querySelectorAll('.msg[data-id]')) { const r = n.getBoundingClientRect(); if (r.bottom > top) return { id: n.dataset.id, off: r.top - top }; }
  return null;
}
function restoreAnchor(box, a) {
  const n = a && box.querySelector(`.msg[data-id="${CSS.escape(a.id)}"]`); if (!n) return false;
  box.scrollTop += n.getBoundingClientRect().top - box.getBoundingClientRect().top - a.off;
  return true;
}

function renderMessages(scroll, anchor) {
  const box = $('messages');
  const keep = !scroll && box.scrollHeight - box.scrollTop; // mantém a posição ao redesenhar
  box.replaceChildren();
  if (!curKey()) return;
  if (S.more) box.append(el('div', 'older', S.loadingOlder ? 'Carregando mensagens antigas…' : 'Role para cima para ver mensagens antigas'));
  else box.append(welcomeNode());
  let dividerDone = false;
  S.messages.forEach((m, i) => {
    // linha "Novas mensagens" antes da primeira não lida
    if (!dividerDone && S.lastRead && m.seq > S.lastRead && m.uid !== S.me.uid) {
      dividerDone = true;
      if (i > 0 || S.more) { const d = el('div', 'new-divider'); d.append(el('span', null, 'Novas mensagens')); box.append(d); }
    }
    box.append(msgNode(m, S.messages[i - 1]));
  });
  if (!S.atLatest) box.append(el('div', 'older', S.loadingNewer ? 'Carregando mensagens mais novas…' : 'Role para baixo para ver mensagens mais novas'));
  if (scroll) box.scrollTop = box.scrollHeight;
  else if (anchor && restoreAnchor(box, anchor)) { /* posição mantida pela mensagem de referência */ }
  else if (keep) box.scrollTop = box.scrollHeight - keep;
  $('jumpBar').hidden = S.atLatest;
  markRead();
}
function keepBottom() { if (stickBottom && S.atLatest) $('messages').scrollTop = $('messages').scrollHeight; }

// abre um canal ou conversa: no fim, ou em volta de uma mensagem (seq)
function openText(key, { seq = null, highlight = null } = {}) {
  cancelEdit(); confirmDel = null; cancelReply();
  S.messages = []; S.more = false; S.atLatest = true; S.lastRead = 0;
  renderMessages(true);
  const done = ({ messages, more, atLatest, lastRead, error }) => {
    if (key !== curKey()) return; // trocou de canal antes da resposta
    if (error) { toast(error); return; }
    S.messages = messages; S.more = more; S.atLatest = atLatest !== false; S.lastRead = lastRead || 0;
    if (seq == null) { renderMessages(true); return; }
    flashId = highlight || messages.find((m) => m.seq === seq)?.id || null;
    renderMessages(true);
    const target = flashId && $('messages').querySelector(`[data-id="${CSS.escape(flashId)}"]`);
    target?.scrollIntoView({ block: 'center' });
    setTimeout(() => { flashId = null; target?.classList.remove('flash'); }, 2500);
  };
  if (seq == null) socket.emit('join-text', key, done);
  else socket.emit('jump', { key, seq }, done);
}
// pular para uma mensagem (resposta, resultado da busca)
function jumpTo(key, seq, id) {
  if (!key || seq == null) return;
  const here = S.messages.find((m) => m.id === id || m.seq === seq);
  if (key === curKey() && here) {
    const node = $('messages').querySelector(`[data-id="${CSS.escape(here.id)}"]`);
    node?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    node?.classList.add('flash'); setTimeout(() => node?.classList.remove('flash'), 2500);
    return;
  }
  navigateTo(key, { seq, highlight: id });
}

// rolagem: busca mensagens antigas (topo) ou mais novas (fim, depois de um salto)
$('messages').addEventListener('scroll', () => {
  const box = $('messages');
  stickBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  const key = curKey(); if (!key || !S.messages.length) return;
  if (box.scrollTop < 150 && S.more && !S.loadingOlder) {
    S.loadingOlder = true; renderMessages();
    socket.emit('history', { key, before: S.messages[0].seq }, ({ messages, more }) => {
      S.loadingOlder = false;
      if (key !== curKey()) return;
      const a = anchorOf(box);
      S.messages = [...messages, ...S.messages]; S.more = more;
      if (S.messages.length > MAX_MSGS) { S.messages = S.messages.slice(0, MAX_MSGS); S.atLatest = false; } // as mais novas saem da tela
      renderMessages(false, a);
    });
  } else if (stickBottom && !S.atLatest && !S.loadingNewer) {
    S.loadingNewer = true;
    socket.emit('history-newer', { key, after: S.messages.at(-1).seq }, ({ messages, atLatest }) => {
      S.loadingNewer = false;
      if (key !== curKey()) return;
      const a = anchorOf(box);
      S.messages = [...S.messages, ...messages]; S.atLatest = atLatest;
      if (S.messages.length > MAX_MSGS) { S.messages = S.messages.slice(-MAX_MSGS); S.more = true; } // as mais antigas saem da tela
      renderMessages(false, a);
    });
  }
  markRead();
}, { passive: true });
$('jumpLatest').onclick = () => openText(curKey());

// ---------- ações ----------
function startEdit(id) { editingId = id; confirmDel = null; renderMessages(); }
function cancelEdit() { editingId = null; }
function saveEdit(m, text) {
  const t = text.trim();
  if (t === m.text) { cancelEdit(); renderMessages(); return; }
  if (!t && !m.att?.length) { confirmDel = m.id; cancelEdit(); renderMessages(); return; }
  socket.emit('message-edit', { id: m.id, text: t }, (res) => {
    if (res?.error) return toast(res.error);
    cancelEdit(); renderMessages(); input.focus();
  });
}
function deleteMessage(id) {
  confirmDel = null;
  socket.emit('message-delete', id, (res) => { if (res?.error) toast(res.error); });
}
function react(id, emoji) { socket.emit('react', { id, emoji }, (res) => { if (res?.error) toast(res.error); }); }

function startReply(m) {
  S.replyTo = m;
  $('replyName').textContent = userName(m.uid);
  $('replyBar').hidden = false; input.focus();
}
function cancelReply() { S.replyTo = null; $('replyBar').hidden = true; }
$('replyCancel').onclick = () => { cancelReply(); input.focus(); };

// ---------- eventos do servidor ----------
socket.on('message', ({ key, msg }) => {
  if (key !== curKey()) return;
  if (!S.atLatest) { $('jumpBar').hidden = false; $('jumpText').textContent = 'Há mensagens novas abaixo.'; return; } // vendo mensagens antigas
  const box = $('messages');
  const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 120;
  const prev = S.messages[S.messages.length - 1];
  S.messages.push(msg); box.append(msgNode(msg, prev));
  if (nearBottom || msg.uid === S.me.uid) box.scrollTop = box.scrollHeight;
  // canal movimentado: quem está acompanhando no fim não acumula mensagens sem limite
  if (S.messages.length > MAX_MSGS + TRIM_STEP && (nearBottom || msg.uid === S.me.uid)) { S.messages = S.messages.slice(-MAX_MSGS); S.more = true; renderMessages(true); }
  if (msg.uid === S.me.uid) S.lastRead = msg.seq; // respondeu: some a linha de "novas"
  typingNames.delete(userName(msg.uid)); renderTyping();
  markRead();
});
socket.on('message-update', ({ key, msg }) => {
  if (key !== curKey()) return;
  const i = S.messages.findIndex((x) => x.id === msg.id); if (i < 0) return;
  S.messages[i] = msg;
  // atualiza só esta mensagem quando possível (sem perder o foco nem a rolagem)
  const node = $('messages').querySelector(`[data-id="${CSS.escape(msg.id)}"]`);
  if (node && editingId !== msg.id && confirmDel !== msg.id) { node.replaceWith(msgNode(msg, S.messages[i - 1])); keepBottom(); }
  else renderMessages();
  // citações desta mensagem em respostas
  if (S.messages.some((x) => x.reply?.id === msg.id)) {
    S.messages.forEach((x) => { if (x.reply?.id === msg.id) x.reply = { ...x.reply, text: msg.text.slice(0, 140) }; });
    renderMessages();
  }
});
socket.on('message-delete', ({ key, id }) => {
  if (key !== curKey()) return;
  S.messages = S.messages.filter((x) => x.id !== id);
  S.messages.forEach((x) => { if (x.reply?.id === id) x.reply = { id, missing: true }; });
  if (editingId === id) cancelEdit();
  if (S.replyTo?.id === id) cancelReply();
  renderMessages();
});

// ---------- compositor ----------
const input = $('msgInput');
const autosize = () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 200) + 'px'; };
let lastTyping = 0;
input.addEventListener('input', () => {
  autosize();
  updateMentionPop();
  if (Date.now() - lastTyping > 2000 && curKey()) { lastTyping = Date.now(); socket.emit('typing', curKey()); }
});
input.addEventListener('keydown', (e) => {
  if (mentionKeydown(e)) return;
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('composer').requestSubmit(); }
  else if (e.key === 'Escape' && S.replyTo) { e.preventDefault(); cancelReply(); }
  else if (e.key === 'ArrowUp' && !input.value) { // como no Discord: seta para cima edita a sua última mensagem
    const last = [...S.messages].reverse().find((m) => m.uid === S.me.uid);
    if (last) { e.preventDefault(); startEdit(last.id); }
  }
});
function insertAtCursor(text) {
  const a = input.selectionStart ?? input.value.length, b = input.selectionEnd ?? a;
  input.value = input.value.slice(0, a) + text + input.value.slice(b);
  input.selectionStart = input.selectionEnd = a + text.length;
  input.focus(); autosize();
}
$('emojiBtn').onclick = () => openEmojiPicker($('emojiBtn'), (e) => insertAtCursor(e));

// autocompletar @menção
let mentionList = [], mentionIdx = 0, mentionStart = -1;
function updateMentionPop() {
  const before = input.value.slice(0, input.selectionStart);
  const m = before.match(/(?:^|\s)@([\w.-]{0,24})$/);
  if (!m) return hideMentionPop();
  const q = m[1].toLowerCase();
  mentionStart = before.length - m[1].length - 1;
  mentionList = [...S.users.values()]
    .filter((u) => !u.disabled && u.id !== S.me.uid && (u.username.toLowerCase().startsWith(q) || u.name.toLowerCase().includes(q) || userName(u.id).toLowerCase().includes(q)))
    .slice(0, 8);
  if (!S.home && canHere(P.MENTION_ALL) && 'todos'.startsWith(q)) mentionList.unshift({ id: 'all', username: 'todos', name: 'todos', all: true });
  if (!mentionList.length) return hideMentionPop();
  mentionIdx = Math.min(mentionIdx, mentionList.length - 1);
  const pop = $('mentionPop'); pop.replaceChildren();
  mentionList.forEach((u, i) => {
    const b = el('button', 'mp-item' + (i === mentionIdx ? ' on' : '')); b.type = 'button'; b.setAttribute('role', 'option');
    if (u.all) b.append(el('span', 'avatar mp-all', '@'), el('span', 'mp-name', '@todos'), el('span', 'mp-user', 'avisa todo mundo que vê o canal'));
    else b.append(avatar(userName(u.id), u.id), el('span', 'mp-name', userName(u.id)), el('span', 'mp-user', '@' + u.username));
    b.onmousedown = (e) => { e.preventDefault(); pickMention(i); };
    pop.append(b);
  });
  pop.hidden = false;
}
function hideMentionPop() { $('mentionPop').hidden = true; mentionList = []; mentionIdx = 0; }
function pickMention(i) {
  const u = mentionList[i]; if (!u) return;
  const end = input.selectionStart;
  input.value = input.value.slice(0, mentionStart) + '@' + u.username + ' ' + input.value.slice(end);
  input.selectionStart = input.selectionEnd = mentionStart + u.username.length + 2;
  hideMentionPop(); input.focus();
}
function mentionKeydown(e) {
  if ($('mentionPop').hidden) return false;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); mentionIdx = (mentionIdx + (e.key === 'ArrowDown' ? 1 : -1) + mentionList.length) % mentionList.length; updateMentionPop(); return true; }
  if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickMention(mentionIdx); return true; }
  if (e.key === 'Escape') { e.preventDefault(); hideMentionPop(); return true; }
  return false;
}
input.addEventListener('blur', () => setTimeout(hideMentionPop, 100));

// ---------- anexos no compositor ----------
let pending = []; // { file, url }
let uploading = false;
function addFiles(list) {
  if (!canHere(P.ATTACH)) { toast('Você não tem permissão para anexar arquivos neste canal.'); return; }
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
  const key = curKey(); if (!key) return;
  let att = [];
  if (pending.length) {
    uploading = true; $('sendBtn').disabled = true; renderTray(0);
    try { att = await uploadPending(); }
    catch (err) { uploading = false; $('sendBtn').disabled = false; renderTray(); toast(err.message); return; }
    uploading = false; $('sendBtn').disabled = false;
  }
  const replyTo = S.replyTo?.id || null;
  if (!S.atLatest) openText(key); // estava vendo mensagens antigas: volta para o fim
  socket.emit('message', { key, text, att, replyTo }, (res) => { if (res?.error) toast(res.error); });
  pending.forEach((p) => p.url && URL.revokeObjectURL(p.url)); pending = []; renderTray();
  input.value = ''; autosize(); cancelReply(); hideMentionPop();
  if (isDmKey(key)) touchDm(key);
});

// mostra ou bloqueia a caixa de mensagem conforme as permissões do canal aberto
function updateComposer() {
  const key = curKey(); if (!key) return;
  const send = canHere(P.SEND);
  const dmGone = S.home && S.users.get(dmOther(key))?.disabled;
  $('composer').hidden = !send || dmGone;
  $('noSend').hidden = send || dmGone;
  $('attachBtn').hidden = !canHere(P.ATTACH);
  if (!send) { cancelReply(); hideMentionPop(); }
}

// ---------- digitando ----------
const typingNames = new Map();
function renderTyping() {
  const names = [...typingNames.keys()];
  $('typing').textContent = !names.length ? '' : names.length === 1 ? `${names[0]} está digitando…` : `${names.slice(0, 3).join(', ')} estão digitando…`;
}
socket.on('typing', ({ key, uid }) => {
  if (key !== curKey()) return;
  const name = userName(uid);
  clearTimeout(typingNames.get(name)); typingNames.set(name, setTimeout(() => { typingNames.delete(name); renderTyping(); }, 3500)); renderTyping();
});
