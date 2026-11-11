// Junta — busca nas mensagens (no servidor aberto ou nas suas conversas diretas)
'use strict';

const searchInput = $('searchInput');
function closeSearch() { $('searchPanel').hidden = true; $('app').classList.remove('searching'); }
$('searchClose').onclick = () => { closeSearch(); searchInput.value = ''; };
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { searchInput.value = ''; closeSearch(); searchInput.blur(); }
  if (e.key === 'Enter') { e.preventDefault(); runSearch(); }
});
// Ctrl+F / Ctrl+K: foca a busca
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'f') && $('auth').hidden) { e.preventDefault(); searchInput.focus(); searchInput.select(); }
});

async function runSearch() {
  const q = searchInput.value.trim(); if (!q) return closeSearch();
  const scope = S.home ? 'dm' : S.serverId;
  const where = S.home ? 'nas suas conversas diretas' : `em ${currentServer()?.name}`;
  const box = $('searchResults'); box.replaceChildren(el('p', 'side-empty', 'Buscando…'));
  $('searchTitle').textContent = `Resultados ${where}`;
  $('searchPanel').hidden = false; $('app').classList.add('searching');
  let results = [];
  try { results = (await emitP('search', { q, scope })).results; } catch (err) { box.replaceChildren(el('p', 'side-empty', err.message)); return; }
  box.replaceChildren();
  if (!results.length) { box.append(el('p', 'side-empty', 'Nada encontrado. Tente outras palavras ou "de:usuario" para filtrar por pessoa.')); return; }
  box.append(el('p', 'search-count', `${results.length === 25 ? 'Os 25 mais recentes' : results.length + (results.length === 1 ? ' resultado' : ' resultados')}`));
  for (const { key, msg } of results) {
    const card = el('button', 'sresult'); card.type = 'button';
    const sv = isDmKey(key) ? null : key.split('/')[0];
    const where = isDmKey(key) ? '@' + userName(dmOther(key), null) : '#' + (S.servers.find((s) => s.id === sv)?.channels.find((c) => c.id === key.split('/')[1])?.name || key);
    const head = el('div', 'sr-head');
    head.append(avatar(userName(msg.uid, sv), msg.uid), el('span', 'sr-name', userName(msg.uid, sv)), el('span', 'sr-where', where), el('span', 'sr-when', `${dayLabel(msg.ts)} ${time(msg.ts)}`));
    const body = el('div', 'sr-body'); renderRich(msg.text || (msg.att.length ? '📎 anexo' : ''), body);
    highlightTerms(body, q);
    card.append(head, body);
    card.onclick = (e) => { if (e.target.closest('a, .mention, .spoiler')) return; jumpTo(key, msg.seq, msg.id); };
    box.append(card);
  }
}

// destaca as palavras buscadas (ignorando acentos) dentro do resultado
function highlightTerms(root, q) {
  const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const terms = q.replace(/(?:^|\s)de:@?\S+/gi, ' ').split(/\s+/).map(fold).filter((t) => t.length > 1);
  if (!terms.length) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const n of nodes) {
    const text = n.nodeValue, f = fold(text);
    const marks = [];
    for (const t of terms) { let i = 0; while ((i = f.indexOf(t, i)) >= 0) { marks.push([i, i + t.length]); i += t.length; } }
    if (!marks.length) continue;
    marks.sort((a, b) => a[0] - b[0]);
    const frag = document.createDocumentFragment(); let last = 0;
    for (const [a, b] of marks) { if (a < last) continue; frag.append(text.slice(last, a), el('mark', null, text.slice(a, b))); last = b; }
    frag.append(text.slice(last)); n.replaceWith(frag);
  }
}
