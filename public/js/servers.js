// Junta — configurações do servidor: nome, ícone, posição, canais, cargos e exclusão (cada parte conforme as permissões)
'use strict';

let ssId = null, ssTab = 'general';
const ssServer = () => S.servers.find((s) => s.id === ssId);
const iconUrl = (s) => (s?.icon ? `/icones/${s.icon}` : null);

// ícone do servidor na barra: imagem, ou as iniciais
function serverIcon(s, cls = 'rail-ico') {
  const url = iconUrl(s);
  if (!url) return document.createTextNode(initials(s.name));
  const im = el('img', cls); im.src = url; im.alt = ''; return im;
}

// abas que esta pessoa pode usar neste servidor
function ssTabsAllowed(id = ssId) {
  return { general: canSrv(P.MANAGE_SERVER, id), channels: canSrv(P.MANAGE_CHANNELS, id), roles: canSrv(P.MANAGE_ROLES, id), expr: canSrv(P.MANAGE_EXPRESSIONS, id) };
}
function openServerSettings(id = S.serverId) {
  const ok = ssTabsAllowed(id);
  if (!ok.general && !ok.channels && !ok.roles && !ok.expr) return;
  ssId = id; $('serverModal').hidden = false;
  showSsTab(ok[ssTab] ? ssTab : Object.keys(ok).find((k) => ok[k]));
}
function closeServerSettings() { $('serverModal').hidden = true; ssId = null; }
$('ssClose').onclick = closeServerSettings;
$('serverModal').addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('modal').hidden) closeServerSettings(); });
for (const b of document.querySelectorAll('[data-ss-tab]')) b.onclick = () => showSsTab(b.dataset.ssTab);
$('serverMenuBtn').onclick = () => openServerSettings();

function showSsTab(tab) {
  ssTab = tab;
  const ok = ssTabsAllowed();
  for (const b of document.querySelectorAll('[data-ss-tab]')) { b.hidden = !ok[b.dataset.ssTab]; b.setAttribute('aria-selected', String(b.dataset.ssTab === tab)); }
  $('ssGeneral').hidden = tab !== 'general'; $('ssChannels').hidden = tab !== 'channels'; $('ssRoles').hidden = tab !== 'roles'; $('ssExpr').hidden = tab !== 'expr';
  $('chanPerms').hidden = true; cpKey = null;
  renderServerSettings(true);
}

// redesenha com os dados atuais (chamado também quando chegam mudanças de outros)
function renderServerSettings(fresh) {
  const s = ssServer();
  if (!s) { if (!$('serverModal').hidden) { closeServerSettings(); } return; }
  $('ssTitle').textContent = `Configurações de ${s.name}`;
  const ok = ssTabsAllowed();
  if (!ok[ssTab]) { const first = Object.keys(ok).find((k) => ok[k]); if (!first) return closeServerSettings(); return showSsTab(first); }
  for (const e of document.querySelectorAll('.ss-owner-only')) e.hidden = !isOwner(); // posição e exclusão: só o dono do Junta
  if (ssTab === 'roles') renderRolesTab();
  if (ssTab === 'expr') renderExprTab();
  if (cpKey) renderChannelPerms();
  // geral
  const prev = $('ssIcon'); prev.replaceChildren(serverIcon(s, 'ss-ico-img'));
  $('ssIconRemove').hidden = !s.icon;
  if (fresh || document.activeElement !== $('ssName')) $('ssName').value = s.name;
  const i = S.servers.indexOf(s);
  $('ssUp').disabled = i <= 0; $('ssDown').disabled = i >= S.servers.length - 1;
  $('ssPos').textContent = `${i + 1}º de ${S.servers.length} na barra`;
  $('ssDelete').disabled = S.servers.length <= 1;
  $('ssDeleteHint').textContent = S.servers.length <= 1 ? 'Este é o único servidor: crie outro antes de excluir este.' : 'Apaga todos os canais, mensagens e anexos deste servidor. Não dá para desfazer.';
  // canais
  const box = $('ssChannelList'); box.replaceChildren();
  for (const [type, label] of [['text', 'Canais de texto'], ['voice', 'Voz e tela']]) {
    const list = s.channels.filter((c) => c.type === type);
    box.append(el('div', 'lbl ss-group', label));
    list.forEach((c, k) => {
      const row = el('div', 'ss-chan');
      row.append(el('span', 'glyph', type === 'text' ? '#' : '◖'));
      const inp = el('input', 'text-in'); inp.value = c.name; inp.maxLength = 40; inp.setAttribute('aria-label', `Nome do canal ${c.name}`);
      const save = () => {
        const v = inp.value.trim();
        if (!v || v === c.name) { inp.value = c.name; return; }
        emitP('channel-update', { key: keyOf(s.id, c.id), name: v }).then(() => toast('Canal renomeado.')).catch((x) => { toast(x.message); inp.value = c.name; });
      };
      inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } else if (e.key === 'Escape') { e.stopPropagation(); inp.value = c.name; inp.blur(); } };
      inp.onblur = save;
      const up = el('button', 'icon-btn', '↑'); up.type = 'button'; up.title = 'Subir'; up.setAttribute('aria-label', `Subir ${c.name}`); up.disabled = k === 0;
      up.onclick = () => emitP('channel-move', { key: keyOf(s.id, c.id), dir: -1 }).catch((x) => toast(x.message));
      const dn = el('button', 'icon-btn', '↓'); dn.type = 'button'; dn.title = 'Descer'; dn.setAttribute('aria-label', `Descer ${c.name}`); dn.disabled = k === list.length - 1;
      dn.onclick = () => emitP('channel-move', { key: keyOf(s.id, c.id), dir: 1 }).catch((x) => toast(x.message));
      const del = el('button', 'icon-btn danger', '×'); del.type = 'button'; del.title = 'Apagar canal'; del.setAttribute('aria-label', `Apagar ${c.name}`);
      del.onclick = () => deleteChannel(c, s.id);
      row.append(inp);
      if (canSrv(P.MANAGE_ROLES, s.id)) {
        const pb = el('button', 'icon-btn' + (c.private ? ' on-lock' : ''), c.private ? '🔒' : '⚙'); pb.type = 'button';
        pb.title = 'Permissões do canal'; pb.setAttribute('aria-label', `Permissões de ${c.name}`);
        pb.onclick = () => openChannelPerms(keyOf(s.id, c.id));
        row.append(pb);
      }
      row.append(up, dn, del);
      box.append(row);
    });
    const add = el('button', 'ghost-btn ss-add', type === 'text' ? '+ Canal de texto' : '+ Sala de voz'); add.type = 'button';
    add.onclick = async () => {
      const r = await ask({ title: type === 'text' ? 'Novo canal de texto' : 'Nova sala de voz', text: `Em ${s.name}`, placeholder: type === 'text' ? 'novo-canal' : 'Sala de jogos', ok: 'Criar' });
      if (r) emitP('create-channel', { serverId: s.id, name: r.value, type }).catch((x) => toast(x.message));
    };
    box.append(add);
  }
}

// ---------- geral ----------
$('ssNameForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = $('ssName').value.trim(); const s = ssServer();
  if (!s || !v || v === s.name) return;
  emitP('server-update', { id: s.id, name: v }).then(() => toast('Nome do servidor atualizado.')).catch((x) => toast(x.message));
});
$('ssUp').onclick = () => emitP('server-move', { id: ssId, dir: -1 }).catch((x) => toast(x.message));
$('ssDown').onclick = () => emitP('server-move', { id: ssId, dir: 1 }).catch((x) => toast(x.message));

// ícone: recorta o centro em quadrado e reduz para 256×256 antes de enviar
$('ssIconPick').onclick = () => $('ssIconFile').click();
$('ssIconFile').onchange = async () => {
  const f = $('ssIconFile').files[0]; $('ssIconFile').value = '';
  if (!f) return;
  if (!/^image\//.test(f.type)) return toast('Escolha um arquivo de imagem.');
  try {
    const blob = await squareImage(f, 256);
    const fd = new FormData(); fd.append('icon', blob, 'icone.' + (blob.type.split('/')[1] || 'png'));
    const r = await fetch(`/api/servers/${encodeURIComponent(ssId)}/icon`, { method: 'POST', body: fd });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Não foi possível enviar o ícone.');
    toast('Ícone atualizado.');
  } catch (x) { toast(x.message); }
};
$('ssIconRemove').onclick = () => api('DELETE', `/api/servers/${encodeURIComponent(ssId)}/icon`).then(() => toast('Ícone removido.')).catch((x) => toast(x.message));
function squareImage(file, size) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const cv = document.createElement('canvas'); cv.width = cv.height = size;
      const g = cv.getContext('2d'); g.imageSmoothingQuality = 'high';
      g.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
      URL.revokeObjectURL(img.src);
      cv.toBlob((b) => (b ? resolve(b) : reject(new Error('Não consegui processar a imagem.'))), 'image/webp', 0.9);
    };
    img.onerror = () => reject(new Error('Não consegui abrir essa imagem.'));
    img.src = URL.createObjectURL(file);
  });
}

// excluir: pede o nome digitado
$('ssDelete').onclick = async () => {
  const s = ssServer(); if (!s) return;
  const r = await ask({
    title: `Excluir ${s.name}?`,
    text: `Todos os canais, mensagens e anexos deste servidor serão apagados para sempre. Para confirmar, digite o nome do servidor: ${s.name}`,
    placeholder: s.name, ok: 'Excluir servidor', danger: true,
  });
  if (!r) return;
  try {
    await emitP('server-delete', { id: s.id, confirm: r.value });
    closeServerSettings(); toast(`${s.name} foi excluído.`);
  } catch (x) { toast(x.message); }
};
