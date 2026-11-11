// Junta — cartão e editor de perfil
'use strict';

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
  cardRoles(uid, pc.querySelector('.card-body'));
  const rc = S.home ? null : roleColor(uid); if (rc) pc.querySelector('.card-name').style.color = rc;
  if (uid === S.me.uid) {
    const b = el('button', 'primary card-edit', 'Editar perfil'); b.type = 'button';
    b.onclick = () => { closeCard(); openProfileEditor(); };
    pc.querySelector('.card-body').append(b);
  } else if (!u.disabled) {
    const b = el('button', 'primary card-edit', 'Enviar mensagem'); b.type = 'button';
    b.onclick = () => { closeCard(); openDm(uid); setTimeout(() => $('msgInput').focus(), 50); };
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
