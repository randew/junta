// Junta — no celular, segurar uma mensagem abre um menu com as ações dela
// (reagir, responder, thread, fixar, copiar, editar, apagar). Os botões em cima de cada
// mensagem ficam escondidos em telas de toque, para a conversa ficar limpa.
'use strict';

const touchUI = matchMedia('(hover: none)');
const HOLD_MS = 420;
const QUICK = ['👍', '❤️', '😂', '😮', '😢', '🔥'];
const COPY_ICON = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z"/></svg>';

const findMsg = (id) => S.messages.find((m) => m.id === id) || (S.thread && (S.thread.root.id === id ? S.thread.root : S.thread.messages.find((m) => m.id === id))) || null;

function openMsgSheet(node) {
  const m = findMsg(node.dataset.id); if (!m) return;
  const sheet = $('msgSheet'); sheet.replaceChildren();
  const pv = el('div', 'ms-preview'); pv.append(el('strong', null, userName(m.uid) + ': '), plainPreview(m.text || (m.att?.length ? '📎 anexo' : ''), 80));
  sheet.append(pv);
  // reações rápidas: as mais usadas por você primeiro
  const acts = node.querySelector('.msg-actions');
  if (canHere(P.REACT) && acts?.querySelector('[aria-label="Reagir"]')) {
    const row = el('div', 'ms-reacts');
    const recent = recentEmojis().filter((e) => !/^:/.test(e) || customEmoji(e.slice(1, -1)));
    for (const e of [...new Set([...recent, ...QUICK])].slice(0, 5)) {
      const b = el('button'); b.type = 'button'; b.append(emojiNode(e)); b.setAttribute('aria-label', `Reagir com ${e}`);
      b.onclick = () => { closeMsgSheet(); rememberEmoji(e); react(m.id, e); };
      row.append(b);
    }
    const more = el('button', null, '＋'); more.type = 'button'; more.setAttribute('aria-label', 'Mais emojis');
    more.onclick = () => { closeMsgSheet(); openEmojiPicker(node, (e) => react(m.id, e)); };
    row.append(more);
    sheet.append(row);
  }
  // as mesmas ações dos botões da mensagem (cada uma chama o botão original)
  const group = el('div', 'ms-group');
  for (const b of acts?.querySelectorAll('button') || []) {
    const label = b.getAttribute('aria-label') || b.title;
    if (label === 'Reagir') continue;
    const it = el('button', 'ms-item' + (b.classList.contains('danger') ? ' danger' : '')); it.type = 'button';
    it.innerHTML = b.innerHTML; it.append(el('span', null, label.replace(/ \(Shift\+clique.*\)$/, '')));
    it.onclick = () => { closeMsgSheet(); b.click(); };
    group.append(it);
  }
  if (m.text) {
    const cp = el('button', 'ms-item'); cp.type = 'button'; cp.innerHTML = COPY_ICON; cp.append(el('span', null, 'Copiar texto'));
    cp.onclick = async () => {
      closeMsgSheet();
      try { await navigator.clipboard.writeText(m.text); toast('Texto copiado.'); } catch { toast('Não consegui copiar.'); }
    };
    group.insertBefore(cp, group.querySelector('.danger'));
  }
  if (group.children.length) sheet.append(group);
  $('msgSheetBack').hidden = false;
}
function closeMsgSheet() {
  $('msgSheetBack').hidden = true;
  document.querySelectorAll('.msg.pressed').forEach((n) => n.classList.remove('pressed'));
}
$('msgSheetBack').addEventListener('click', (e) => { if (e.target === $('msgSheetBack')) closeMsgSheet(); });
$('msgSheetBack').addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMsgSheet(); });

// segurar a mensagem (sem arrastar) abre o menu
let hold = null;
function startHold(e) {
  if (!touchUI.matches || e.pointerType === 'mouse') return;
  const node = e.target.closest('.msg[data-id]');
  if (!node || e.target.closest('a, button, input, textarea, .spoiler, video, audio, .att img, .editing')) return;
  cancelHold();
  hold = { x: e.clientX, y: e.clientY, node, t: setTimeout(() => {
    node.classList.add('pressed');
    navigator.vibrate?.(10);
    hold.fired = true;
    openMsgSheet(node);
  }, HOLD_MS) };
}
function cancelHold() { if (hold) { clearTimeout(hold.t); hold = null; } }
for (const box of [$('messages'), $('threadMsgs')]) {
  box.addEventListener('pointerdown', startHold);
  box.addEventListener('pointermove', (e) => { if (hold && Math.hypot(e.clientX - hold.x, e.clientY - hold.y) > 10) cancelHold(); });
  box.addEventListener('pointerup', cancelHold);
  box.addEventListener('pointercancel', cancelHold);
  box.addEventListener('scroll', cancelHold, { passive: true });
  // no Android, segurar também dispara o menu do navegador: usa o nosso no lugar
  box.addEventListener('contextmenu', (e) => { if (touchUI.matches && e.target.closest('.msg[data-id]')) e.preventDefault(); });
}

// dica, uma vez só, para quem usa pelo celular
function holdHint() {
  if (!touchUI.matches) return;
  try { if (localStorage.getItem('junta:holdhint')) return; localStorage.setItem('junta:holdhint', '1'); } catch { return; }
  setTimeout(() => toast('Dica: segure uma mensagem para reagir, responder e mais.'), 1500);
}
