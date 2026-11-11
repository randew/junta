// Junta — GIFs: busca (KLIPY ou GIPHY, pelo servidor do Junta) e favoritos de cada pessoa
'use strict';

const gifFavs = new Set(); // endereços dos favoritos (para a estrela nas mensagens)
let gifFavList = [], gifTab = 'search', gifNext = null, gifQuery = '', gifLoading = false, gifProvider = 'KLIPY';
async function loadGifFavs() {
  try { gifFavList = (await api('GET', '/api/gifs/favorites')).items; gifFavs.clear(); gifFavList.forEach((g) => gifFavs.add(g.url)); } catch {}
}
async function toggleGifFav(g) {
  const on = !gifFavs.has(g.url);
  try {
    await api('POST', '/api/gifs/favorites', { ...g, on });
    if (on) { gifFavs.add(g.url); gifFavList.unshift(g); toast('GIF guardado nos favoritos ★'); }
    else { gifFavs.delete(g.url); gifFavList = gifFavList.filter((x) => x.url !== g.url); }
    if (!$('gifPanel').hidden && gifTab === 'fav') drawGifs(gifFavList, false);
  } catch (x) { toast(x.message); }
}

function openGifs() {
  const p = $('gifPanel');
  if (!p.hidden) { closeGifs(); return; }
  p.hidden = false; $('gifBtn').setAttribute('aria-expanded', 'true');
  const r = $('composer').getBoundingClientRect();
  p.style.left = Math.max(8, Math.min(innerWidth - p.offsetWidth - 8, r.right - p.offsetWidth)) + 'px';
  p.style.top = Math.max(8, r.top - p.offsetHeight - 8) + 'px';
  setGifTab(gifTab);
  $('gifSearch').focus();
}
function closeGifs() { $('gifPanel').hidden = true; $('gifBtn').setAttribute('aria-expanded', 'false'); }
function setGifTab(tab) {
  gifTab = tab;
  for (const b of document.querySelectorAll('[data-gif-tab]')) b.setAttribute('aria-selected', String(b.dataset.gifTab === tab));
  $('gifSearch').hidden = tab !== 'search';
  if (tab === 'fav') { loadGifFavs().then(() => drawGifs(gifFavList, false)); $('gifFoot').textContent = ''; }
  else searchGifs($('gifSearch').value.trim());
}
for (const b of document.querySelectorAll('[data-gif-tab]')) b.onclick = () => setGifTab(b.dataset.gifTab);

async function searchGifs(q, more) {
  if (gifLoading) return;
  if (!more) { gifQuery = q; gifNext = null; $('gifGrid').replaceChildren(el('p', 'side-empty', 'Carregando…')); }
  gifLoading = true;
  let d;
  try { d = await api('GET', `/api/gifs/search?q=${encodeURIComponent(gifQuery)}${more && gifNext ? '&pos=' + encodeURIComponent(gifNext) : ''}`); }
  catch (x) { gifLoading = false; if (!more) $('gifGrid').replaceChildren(el('p', 'side-empty', x.message)); return; }
  gifLoading = false;
  if (q !== gifQuery && !more) return;
  if (!d.configured) {
    $('gifGrid').replaceChildren(el('p', 'side-empty', isOwner()
      ? 'A busca de GIFs ainda não está ligada. Configure em Administração → GIFs (precisa de uma chave grátis do KLIPY). Os favoritos já funcionam.'
      : 'A busca de GIFs ainda não está ligada. Peça ao dono do Junta para configurar. Os favoritos já funcionam.'));
    $('gifFoot').textContent = ''; return;
  }
  gifProvider = d.provider || gifProvider; gifNext = d.next;
  drawGifs(d.items, more);
  $('gifFoot').textContent = `Desenvolvido por ${gifProvider}`;
}
function drawGifs(items, append) {
  const grid = $('gifGrid');
  if (!append) grid.replaceChildren();
  if (!items.length && !append) { grid.append(el('p', 'side-empty', gifTab === 'fav' ? 'Nenhum favorito ainda. Clique na ★ de um GIF (aqui ou numa mensagem) para guardar.' : 'Nada encontrado.')); return; }
  for (const g of items) {
    const cell = el('div', 'gif-cell');
    const b = el('button', 'gif-pick'); b.type = 'button'; b.title = g.title || 'Enviar este GIF'; b.setAttribute('aria-label', g.title ? `Enviar GIF: ${g.title}` : 'Enviar este GIF');
    const img = el('img'); img.src = g.preview || g.url; img.alt = ''; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer';
    if (g.w && g.h) cell.style.aspectRatio = `${g.w} / ${g.h}`;
    b.append(img); b.onclick = () => sendGif(g);
    const fav = el('button', 'icon-btn gif-fav' + (gifFavs.has(g.url) ? ' on' : ''), '★'); fav.type = 'button';
    fav.title = gifFavs.has(g.url) ? 'Tirar dos favoritos' : 'Guardar nos favoritos'; fav.setAttribute('aria-label', fav.title);
    fav.onclick = (e) => { e.stopPropagation(); toggleGifFav({ url: g.url, preview: g.preview, w: g.w, h: g.h }).then(() => fav.classList.toggle('on', gifFavs.has(g.url))); };
    cell.append(b, fav); grid.append(cell);
  }
}
async function sendGif(g) {
  const key = curKey(); if (!key) return;
  if (!canHere(P.SEND)) return toast('Você não tem permissão para enviar mensagens neste canal.');
  closeGifs();
  try { await emitP('message', { key, text: g.url, att: [], replyTo: S.replyTo?.id || null }); cancelReply(); }
  catch (x) { toast(x.message); }
}
let gifT = null;
$('gifSearch').addEventListener('input', () => { clearTimeout(gifT); gifT = setTimeout(() => searchGifs($('gifSearch').value.trim()), 350); });
$('gifGrid').addEventListener('scroll', () => {
  const g = $('gifGrid');
  if (gifTab === 'search' && gifNext && g.scrollTop + g.clientHeight > g.scrollHeight - 200) searchGifs(gifQuery, true);
}, { passive: true });
$('gifBtn').onclick = openGifs;
document.addEventListener('mousedown', (e) => { if (!$('gifPanel').hidden && !e.target.closest('#gifPanel, #gifBtn')) closeGifs(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('gifPanel').hidden) { closeGifs(); $('msgInput').focus(); } });
socket.on('connect', loadGifFavs);

// ---------- Administração → GIFs ----------
async function renderGifsTab() {
  let d; try { d = await api('GET', '/api/admin/gifs'); } catch (x) { $('gifStatus').textContent = x.message; return; }
  $('gifProvider').value = d.provider;
  $('gifStatus').textContent = d.configured ? `Busca de GIFs ligada (${d.providers.find((p) => p.id === d.provider)?.name}).` : 'Busca de GIFs desligada. Os favoritos e GIFs colados como link funcionam mesmo assim.';
  $('gifStatus').className = 'turn-status ' + (d.configured ? 'ok' : 'off');
  $('gifRemove').hidden = !d.configured;
  $('gifKey').value = '';
  $('gifKey').placeholder = d.configured ? 'para trocar, cole uma chave nova' : 'cole a chave aqui';
}
$('gifForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('gifForm').querySelector('button[type=submit]'); btn.disabled = true;
  try { await api('POST', '/api/admin/gifs', { provider: $('gifProvider').value, key: $('gifKey').value.trim() }); toast('Chave testada e salva. A busca de GIFs está ligada!'); renderGifsTab(); }
  catch (x) { toast(x.message); }
  finally { btn.disabled = false; }
});
$('gifRemove').onclick = () => api('POST', '/api/admin/gifs', { remove: true }).then(() => { toast('Busca de GIFs desligada.'); renderGifsTab(); }).catch((x) => toast(x.message));
