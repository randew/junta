// Junta — cargos: aba "Cargos", permissões por canal e cargos no cartão de perfil
'use strict';

// o que cada permissão faz, em português, agrupado como no editor
const PERM_INFO = [
  ['Geral', [
    [P.VIEW, 'Ver canais', 'Ver os canais e ler as mensagens.'],
    [P.INVITE, 'Convidar pessoas', 'Ver e copiar o código de convite do Junta.'],
    [P.MANAGE_CHANNELS, 'Gerenciar canais', 'Criar, renomear, reordenar e apagar canais.'],
    [P.MANAGE_ROLES, 'Gerenciar cargos', 'Criar e editar cargos abaixo do seu e dar esses cargos às pessoas.'],
    [P.MANAGE_SERVER, 'Gerenciar servidor', 'Mudar o nome e o ícone do servidor.'],
    [P.MANAGE_EXPRESSIONS, 'Gerenciar emojis e sons', 'Enviar e apagar os emojis personalizados e os sons do soundboard.'],
  ]],
  ['Mensagens', [
    [P.SEND, 'Enviar mensagens', 'Escrever nos canais de texto.'],
    [P.ATTACH, 'Anexar arquivos', 'Enviar imagens, vídeos e arquivos.'],
    [P.REACT, 'Reagir', 'Adicionar reações novas (entrar numa que já existe sempre pode).'],
    [P.MENTION_ALL, 'Mencionar @todos', 'Avisar todo mundo que vê o canal de uma vez.'],
    [P.MANAGE_MESSAGES, 'Gerenciar mensagens', 'Apagar mensagens de outras pessoas.'],
  ]],
  ['Voz', [
    [P.CONNECT, 'Entrar nas salas de voz', ''],
    [P.SPEAK, 'Falar', 'Sem isso, a pessoa entra mas fica muda para todos.'],
    [P.STREAM, 'Transmitir tela e câmera', ''],
    [P.MUTE_MEMBERS, 'Silenciar pessoas', 'Silenciar alguém para todos na sala.'],
    [P.MOVE_MEMBERS, 'Desconectar pessoas', 'Tirar alguém da sala de voz.'],
    [P.USE_SOUNDBOARD, 'Usar o soundboard', 'Tocar sons curtos para todos na sala.'],
  ]],
  ['Avançado', [
    [P.ADMIN, 'Administrador', 'Pode tudo neste servidor e ignora as restrições dos canais. Dê com cuidado.'],
  ]],
];
const TEXT_PERMS = [P.VIEW, P.SEND, P.ATTACH, P.REACT, P.MENTION_ALL, P.MANAGE_MESSAGES];
const VOICE_PERMS = [P.VIEW, P.CONNECT, P.SPEAK, P.STREAM, P.MUTE_MEMBERS, P.MOVE_MEMBERS];
const permName = (bit) => PERM_INFO.flatMap((g) => g[1]).find((p) => p[0] === bit)?.[1] || '';
const ROLE_COLORS = ['#e5534b', '#ef8a5b', '#f0a43a', '#e5c15a', '#46c28a', '#5fcfc3', '#6cb4ee', '#b49cf0', '#e88aa8'];

// convite: dono, ou quem tem "Convidar pessoas" em algum servidor
function refreshInviteItem() {
  const ok = S.me.role === 'owner' || S.servers.some((s) => has(s.perms ?? 0, P.INVITE));
  $('inviteItem').hidden = !ok;
}

// ---------- aba "Cargos" ----------
let roleSel = null; // cargo aberto no editor
const canEditRole = (r, sid) => S.me.role === 'owner' || (canSrv(P.MANAGE_ROLES, sid) && r.pos < myTop(sid));

function renderRolesTab() {
  const sid = ssId; const roles = rolesIn(sid);
  const list = $('roleList'); list.replaceChildren();
  const others = roles.filter((r) => !r.isDefault);
  const everyone = roles.find((r) => r.isDefault);
  if (!roles.some((r) => r.id === roleSel)) roleSel = others[0]?.id ?? everyone?.id ?? null;
  // lista arrastável (do mais importante para o menos); o @todos fica sempre embaixo
  const group = el('div', 'role-group');
  for (const r of others) {
    const b = el('button', 'role-item' + (r.id === roleSel ? ' on' : '') + (canEditRole(r, sid) ? '' : ' locked')); b.type = 'button'; b.dataset.id = String(r.id);
    const dot = el('span', 'role-dot'); dot.style.background = r.color || 'var(--fg-dim)';
    const count = Object.values(S.memberRoles[sid] || {}).filter((ids) => ids.includes(r.id)).length;
    b.append(dot, el('span', 'role-name', r.name), el('span', 'role-count', String(count)));
    if (!canEditRole(r, sid)) { b.title = 'Este cargo está no seu nível ou acima: você não pode mudá-lo'; }
    b.onclick = () => { roleSel = r.id; renderRolesTab(); };
    group.append(b);
  }
  list.append(group);
  makeSortable(group, {
    selector: '.role-item', enabled: () => canSrv(P.MANAGE_ROLES, sid),
    onDrop(order) { emitP('role-reorder', { serverId: sid, order: order.map(Number) }).catch((x) => { toast(x.message); renderRolesTab(); }); },
  });
  if (everyone) {
    const b = el('button', 'role-item everyone' + (everyone.id === roleSel ? ' on' : '')); b.type = 'button';
    b.append(el('span', 'role-dot'), el('span', 'role-name', '@todos'), el('span', 'role-count', 'base'));
    b.onclick = () => { roleSel = everyone.id; renderRolesTab(); };
    list.append(b);
  }
  $('roleNew').hidden = !canSrv(P.MANAGE_ROLES, sid);
  renderRoleEditor(roles.find((r) => r.id === roleSel), sid);
}
$('roleNew').onclick = async () => {
  try { const { id } = await emitP('role-create', { serverId: ssId, name: 'novo cargo' }); roleSel = id; setTimeout(() => $('roleName')?.select(), 300); }
  catch (x) { toast(x.message); }
};

function renderRoleEditor(r, sid) {
  const box = $('roleEditor'); box.replaceChildren();
  if (!r) { box.append(el('p', 'side-empty', 'Nenhum cargo ainda. Crie um com "+ Novo cargo".')); return; }
  const editable = canEditRole(r, sid);
  const mine = S.me.role === 'owner' ? -1 : (has(S.servers.find((s) => s.id === sid)?.perms ?? 0, P.ADMIN) ? -1 : S.servers.find((s) => s.id === sid)?.perms ?? 0);
  if (!editable) box.append(el('p', 'role-warn', 'Este cargo está no seu nível ou acima, então você só pode ver.'));
  if (r.isDefault) box.append(el('p', 'help', 'O @todos vale para todo mundo do servidor. É a base: os outros cargos somam permissões em cima dele.'));
  else {
    // nome e cor
    const nameRow = el('label', 'field'); nameRow.htmlFor = 'roleName';
    const nm = el('input', 'text-in'); nm.id = 'roleName'; nm.value = r.name; nm.maxLength = 32; nm.disabled = !editable;
    nm.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); nm.blur(); } };
    nm.onblur = () => { const v = nm.value.trim(); if (v && v !== r.name) emitP('role-update', { id: r.id, name: v }).catch((x) => toast(x.message)); else nm.value = r.name; };
    nameRow.append(el('span', 'lbl', 'Nome do cargo'), nm); box.append(nameRow);
    const colorRow = el('div', 'field'); colorRow.append(el('span', 'lbl', 'Cor'));
    const sw = el('div', 'swatches');
    const setColor = (c) => emitP('role-update', { id: r.id, color: c }).catch((x) => toast(x.message));
    const none = el('button', 'swatch auto' + (!r.color ? ' on' : ''), 'Sem cor'); none.type = 'button'; none.disabled = !editable; none.onclick = () => setColor(null); sw.append(none);
    for (const c of ROLE_COLORS) { const b = el('button', 'swatch' + (r.color === c ? ' on' : '')); b.type = 'button'; b.style.background = c; b.disabled = !editable; b.setAttribute('aria-label', `Cor ${c}`); b.onclick = () => setColor(c); sw.append(b); }
    colorRow.append(sw); box.append(colorRow);
    const hoist = el('label', 'switch'); const hc = el('input'); hc.type = 'checkbox'; hc.checked = r.hoist; hc.disabled = !editable;
    hc.onchange = () => emitP('role-update', { id: r.id, hoist: hc.checked }).catch((x) => toast(x.message));
    const ht = el('span'); ht.append(el('strong', null, 'Mostrar separado na lista de membros'), el('small', null, 'Quem tem este cargo aparece num grupo próprio, como no Discord.'));
    hoist.append(hc, ht); box.append(hoist);
  }
  // permissões
  for (const [group, items] of PERM_INFO) {
    if (r.isDefault && group === 'Avançado') continue;
    box.append(el('div', 'lbl perm-group', group));
    for (const [bit, label, desc] of items) {
      const row = el('label', 'perm-row');
      const cb = el('input'); cb.type = 'checkbox'; cb.checked = has(r.perms, bit);
      // só dá para mexer nas permissões que você mesmo tem
      cb.disabled = !editable || (mine !== -1 && !has(mine, bit));
      cb.onchange = () => emitP('role-update', { id: r.id, perms: cb.checked ? r.perms | bit : r.perms & ~bit }).catch((x) => { toast(x.message); cb.checked = !cb.checked; });
      const t = el('span'); t.append(el('strong', null, label)); if (desc) t.append(el('small', null, desc));
      row.append(t, cb); if (bit === P.ADMIN) row.classList.add('danger-perm');
      box.append(row);
    }
  }
  if (r.isDefault) return;
  // quem tem o cargo
  box.append(el('div', 'lbl perm-group', 'Pessoas com este cargo'));
  const ids = Object.entries(S.memberRoles[sid] || {}).filter(([, list]) => list.includes(r.id)).map(([uid]) => Number(uid));
  const people = el('div', 'role-people');
  for (const uid of ids) {
    const u = S.users.get(uid); if (!u) continue;
    const chip = el('span', 'role-person'); chip.append(avatar(userName(uid, sid), uid), el('span', null, userName(uid, sid)));
    if (editable && (uid === S.me.uid || topOf(uid, sid) < myTop(sid))) {
      const x = el('button', 'icon-btn', '×'); x.type = 'button'; x.setAttribute('aria-label', `Tirar o cargo de ${userName(uid, sid)}`);
      x.onclick = () => emitP('member-role', { userId: uid, roleId: r.id, add: false }).catch((e) => toast(e.message));
      chip.append(x);
    }
    people.append(chip);
  }
  if (!ids.length) people.append(el('span', 'help', 'Ninguém ainda.'));
  box.append(people);
  if (editable) {
    const sel = el('select'); sel.id = 'roleAddMember'; sel.setAttribute('aria-label', 'Dar este cargo a alguém');
    const o0 = el('option', null, '+ Dar este cargo a…'); o0.value = ''; sel.append(o0);
    for (const u of [...S.users.values()].filter((u) => !u.disabled && !ids.includes(u.id) && (u.id === S.me.uid || topOf(u.id, sid) < myTop(sid))).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))) {
      const o = el('option', null, `${userName(u.id, sid)} (@${u.username})`); o.value = u.id; sel.append(o);
    }
    sel.onchange = () => { if (sel.value) emitP('member-role', { userId: Number(sel.value), roleId: r.id, add: true }).catch((e) => toast(e.message)); };
    const wrap = el('div', 'field'); wrap.append(sel); box.append(wrap);
    const del = el('button', 'danger-btn role-del', 'Apagar cargo'); del.type = 'button';
    del.onclick = async () => {
      const ok = await ask({ title: `Apagar o cargo ${r.name}?`, text: 'Quem tem o cargo perde as permissões dele. Isso não apaga mensagens.', ok: 'Apagar cargo', noInput: true, danger: true });
      if (ok) emitP('role-delete', { id: r.id }).then(() => { roleSel = null; }).catch((x) => toast(x.message));
    };
    box.append(del);
  }
}

// ---------- permissões de um canal ----------
let cpKey = null, cpRole = null, cpOverrides = [];
async function openChannelPerms(key) {
  cpKey = key; cpRole = null;
  $('ssChannels').hidden = true; $('chanPerms').hidden = false;
  await loadChannelPerms();
}
async function loadChannelPerms() {
  try { cpOverrides = (await emitP('channel-perms-get', { key: cpKey })).overrides; } catch (x) { toast(x.message); return closeChannelPerms(); }
  renderChannelPerms();
}
function closeChannelPerms() { cpKey = null; $('chanPerms').hidden = true; $('ssChannels').hidden = ssTab !== 'channels'; }
$('cpBack').onclick = closeChannelPerms;

function renderChannelPerms() {
  const [sid, cid] = cpKey.split('/');
  const s = S.servers.find((x) => x.id === sid); const c = s?.channels.find((x) => x.id === cid);
  if (!c) return closeChannelPerms();
  const roles = rolesIn(sid); const everyone = roles.find((r) => r.isDefault);
  cpRole ??= everyone?.id;
  $('cpTitle').textContent = `Permissões de ${c.type === 'text' ? '#' : ''}${c.name}`;
  const ov = (rid) => cpOverrides.find((o) => o.roleId === rid) || { allow: 0, deny: 0 };
  const save = (rid, allow, deny) => emitP('channel-perms', { key: cpKey, roleId: rid, allow, deny }).then(loadChannelPerms).catch((x) => toast(x.message));
  // atalhos
  const presets = $('cpPresets'); presets.replaceChildren();
  const e = ov(everyone.id);
  const isPrivate = has(e.deny, P.VIEW), readOnly = c.type === 'text' && has(e.deny, P.SEND);
  const mk = (label, on, fn, title) => { const b = el('button', 'ghost-btn' + (on ? ' on' : ''), label); b.type = 'button'; b.title = title; b.setAttribute('aria-pressed', String(on)); b.onclick = fn; presets.append(b); };
  mk(isPrivate ? '🔒 Privado' : '🔓 Público', isPrivate, () => save(everyone.id, e.allow & ~P.VIEW, isPrivate ? e.deny & ~P.VIEW : e.deny | P.VIEW),
    isPrivate ? 'Tornar público: todo mundo volta a ver' : 'Tornar privado: só os cargos liberados abaixo veem');
  if (c.type === 'text') mk(readOnly ? 'Só leitura: ligado' : 'Só leitura', readOnly, () => {
    const bits = P.SEND | P.REACT | P.ATTACH;
    save(everyone.id, e.allow & ~bits, readOnly ? e.deny & ~bits : e.deny | bits);
  }, 'Ninguém escreve aqui, a não ser os cargos liberados abaixo');
  $('cpHint').textContent = isPrivate ? 'Privado: escolha abaixo os cargos que podem ver (ligue "Ver canais" como Permitir).' : '';
  // escolher o cargo
  const pick = $('cpRoles'); pick.replaceChildren();
  for (const r of [...roles.filter((x) => !x.isDefault), everyone]) {
    const o = ov(r.id); const changed = o.allow || o.deny;
    const b = el('button', 'cp-role' + (r.id === cpRole ? ' on' : '')); b.type = 'button';
    const dot = el('span', 'role-dot'); dot.style.background = r.color || 'var(--fg-dim)';
    b.append(dot, el('span', null, r.isDefault ? '@todos' : r.name)); if (changed) b.append(el('span', 'cp-mark', '•'));
    b.onclick = () => { cpRole = r.id; renderChannelPerms(); };
    pick.append(b);
  }
  // três estados por permissão
  const box = $('cpList'); box.replaceChildren();
  const role = roles.find((r) => r.id === cpRole); const o = ov(cpRole);
  const editable = role && (role.isDefault || canEditRole(role, sid));
  for (const bit of c.type === 'text' ? TEXT_PERMS : VOICE_PERMS) {
    const state = has(o.allow, bit) ? 'allow' : has(o.deny, bit) ? 'deny' : 'inherit';
    const row = el('div', 'cp-row'); row.append(el('span', 'cp-name', permName(bit)));
    const seg = el('div', 'tri'); seg.setAttribute('role', 'radiogroup'); seg.setAttribute('aria-label', permName(bit));
    for (const [st, label, title] of [['deny', '✕', 'Negar'], ['inherit', '/', 'Herdar do cargo'], ['allow', '✓', 'Permitir']]) {
      const b = el('button', 'tri-' + st + (state === st ? ' on' : ''), label); b.type = 'button'; b.title = title; b.setAttribute('role', 'radio'); b.setAttribute('aria-checked', String(state === st)); b.disabled = !editable;
      b.onclick = () => save(cpRole, st === 'allow' ? o.allow | bit : o.allow & ~bit, st === 'deny' ? o.deny | bit : o.deny & ~bit);
      seg.append(b);
    }
    row.append(seg); box.append(row);
  }
}

// ---------- cargos no cartão de perfil ----------
function cardRoles(uid, body) {
  if (S.home || !S.serverId) return;
  const sid = S.serverId; const mine = rolesOfUser(uid, sid);
  const assignable = rolesIn(sid).filter((r) => !r.isDefault && canEditRole(r, sid) && (uid === S.me.uid || topOf(uid, sid) < myTop(sid)));
  if (!mine.length && !assignable.length) return;
  const box = el('div', 'card-roles'); box.append(el('div', 'lbl', 'Cargos'));
  const list = el('div', 'card-role-list');
  for (const r of mine) {
    const chip = el('span', 'card-role'); const dot = el('span', 'role-dot'); dot.style.background = r.color || 'var(--fg-dim)';
    chip.append(dot, el('span', null, r.name));
    if (assignable.some((a) => a.id === r.id)) {
      const x = el('button', 'icon-btn', '×'); x.type = 'button'; x.title = 'Tirar cargo'; x.setAttribute('aria-label', `Tirar o cargo ${r.name}`);
      x.onclick = () => emitP('member-role', { userId: uid, roleId: r.id, add: false }).catch((e) => toast(e.message));
      chip.append(x);
    }
    list.append(chip);
  }
  const missing = assignable.filter((r) => !mine.some((m) => m.id === r.id));
  if (missing.length) {
    const sel = el('select', 'card-role-add'); sel.setAttribute('aria-label', 'Dar cargo');
    const o0 = el('option', null, '+ Cargo'); o0.value = ''; sel.append(o0);
    for (const r of missing) { const o = el('option', null, r.name); o.value = r.id; sel.append(o); }
    sel.onchange = () => { if (sel.value) emitP('member-role', { userId: uid, roleId: Number(sel.value), add: true }).catch((e) => toast(e.message)); };
    list.append(sel);
  }
  box.append(list); body.append(box);
}
