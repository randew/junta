// Junta — administração (dono) e troca de senha (todos)
'use strict';

// ---------- trocar a própria senha ----------
function openPassword() {
  for (const id of ['pwCurrent', 'pwNext', 'pwRepeat']) $(id).value = '';
  $('pwError').hidden = true; $('pwModal').hidden = false; $('pwCurrent').focus();
}
$('pwCancel').onclick = () => { $('pwModal').hidden = true; };
$('pwModal').addEventListener('keydown', (e) => { if (e.key === 'Escape') $('pwModal').hidden = true; });
$('pwForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = (m) => { $('pwError').textContent = m; $('pwError').hidden = false; };
  if ($('pwNext').value.length < 6) return err('A nova senha precisa ter pelo menos 6 caracteres.');
  if ($('pwNext').value !== $('pwRepeat').value) return err('A confirmação não bate com a nova senha.');
  $('pwSave').disabled = true;
  try {
    await api('POST', '/api/password', { current: $('pwCurrent').value, next: $('pwNext').value });
    $('pwModal').hidden = true; toast('Senha trocada. Os outros aparelhos conectados precisam entrar de novo.');
  } catch (x) { err(x.message); } finally { $('pwSave').disabled = false; }
});

// ---------- administração ----------
let adminTab = 'users';
function openAdmin() { $('adminModal').hidden = false; showAdminTab(adminTab); }
$('adminClose').onclick = () => { $('adminModal').hidden = true; };
$('adminModal').addEventListener('keydown', (e) => { if (e.key === 'Escape') $('adminModal').hidden = true; });
for (const b of document.querySelectorAll('[data-admin-tab]')) b.onclick = () => showAdminTab(b.dataset.adminTab);

function showAdminTab(tab) {
  adminTab = tab;
  for (const b of document.querySelectorAll('[data-admin-tab]')) b.setAttribute('aria-selected', String(b.dataset.adminTab === tab));
  $('adminUsers').hidden = tab !== 'users'; $('adminBackups').hidden = tab !== 'backups';
  if (tab === 'users') loadAdminUsers(); else loadBackups();
}

const ago = (ts) => {
  if (!ts) return 'nunca entrou';
  const d = Math.round((Date.now() - ts) / 864e5);
  return d < 1 ? 'hoje' : d === 1 ? 'ontem' : `há ${d} dias`;
};

async function loadAdminUsers() {
  const box = $('adminUserList'); box.replaceChildren(el('p', 'side-empty', 'Carregando…'));
  let users;
  try { users = (await api('GET', '/api/admin/users')).users; } catch (x) { box.replaceChildren(el('p', 'side-empty', x.message)); return; }
  box.replaceChildren();
  for (const u of users) {
    const row = el('div', 'arow' + (u.disabled ? ' gone' : ''));
    const who = el('div', 'arow-who');
    const w = el('span', 'av-wrap'); w.append(avatar(u.display, u.id), el('span', 'sdot s-' + (u.disabled ? 'offline' : u.online ? 'online' : 'offline')));
    const names = el('div', 'arow-names');
    const top = el('span', 'nm', u.display); if (u.role === 'owner') top.append(el('span', 'crown', '★'));
    names.append(top, el('span', 'mp-user', `@${u.username} · ${u.disabled ? 'removida' : u.online ? 'online agora' : 'último acesso ' + ago(u.seen)} · ${u.messages} mensagens`));
    who.append(w, names); row.append(who);
    const acts = el('div', 'arow-acts');
    if (u.role !== 'owner') {
      if (!u.disabled) {
        const reset = el('button', 'ghost-btn', 'Redefinir senha'); reset.type = 'button';
        reset.onclick = () => resetPassword(u);
        const rm = el('button', 'ghost-btn danger-text', 'Remover'); rm.type = 'button';
        rm.onclick = () => removeUser(u);
        acts.append(reset, rm);
      } else {
        const back = el('button', 'ghost-btn', 'Restaurar'); back.type = 'button';
        back.onclick = async () => { try { await api('POST', `/api/admin/users/${u.id}/restore`); toast(`${u.display} pode entrar de novo.`); loadAdminUsers(); } catch (x) { toast(x.message); } };
        acts.append(back);
      }
    } else acts.append(el('span', 'mp-user', 'Dono'));
    row.append(acts); box.append(row);
  }
}

async function resetPassword(u) {
  const ok = await ask({ title: `Redefinir a senha de ${u.display}?`, text: 'Vai ser gerada uma senha temporária para você passar para a pessoa. Ela sai de todos os aparelhos e entra com a senha nova; depois pode trocar em "Trocar senha".', ok: 'Gerar senha', noInput: true });
  if (!ok) return;
  try {
    const { password } = await api('POST', `/api/admin/users/${u.id}/reset`);
    $('tempUser').textContent = `@${u.username}`; $('tempPass').textContent = password;
    $('tempModal').hidden = false; $('tempCopy').focus();
  } catch (x) { toast(x.message); }
}
$('tempCopy').onclick = async () => {
  const text = `Usuário: ${$('tempUser').textContent.slice(1)}\nSenha temporária: ${$('tempPass').textContent}`;
  try { await navigator.clipboard.writeText(text); toast('Copiado.'); }
  catch { const r = document.createRange(); r.selectNodeContents($('tempPass')); getSelection().removeAllRanges(); getSelection().addRange(r); toast('Selecionei a senha: aperte Ctrl+C.'); }
};
$('tempClose').onclick = () => { $('tempModal').hidden = true; };

async function removeUser(u) {
  const ok = await ask({ title: `Remover ${u.display}?`, text: 'A pessoa sai na hora e não consegue mais entrar. As mensagens dela continuam no histórico. Dá para restaurar depois.', ok: 'Remover conta', noInput: true, danger: true });
  if (!ok) return;
  try { await api('POST', `/api/admin/users/${u.id}/remove`); toast(`${u.display} foi removido.`); loadAdminUsers(); } catch (x) { toast(x.message); }
}

async function loadBackups() {
  const box = $('backupList'); box.replaceChildren(el('p', 'side-empty', 'Carregando…'));
  let d;
  try { d = await api('GET', '/api/admin/backups'); } catch (x) { box.replaceChildren(el('p', 'side-empty', x.message)); return; }
  $('backupDir').textContent = d.dir;
  box.replaceChildren();
  if (!d.backups.length) { box.append(el('p', 'side-empty', 'Nenhum backup ainda.')); return; }
  for (const b of d.backups) {
    const row = el('div', 'brow');
    row.append(el('span', 'bname', b.name), el('span', 'mp-user', `${new Date(b.created).toLocaleString('pt-BR')} · ${fmtSize(b.size)}`));
    box.append(row);
  }
}
$('backupNow').onclick = async () => {
  $('backupNow').disabled = true;
  try { const r = await api('POST', '/api/admin/backups'); toast(`Backup feito: ${r.name}`); loadBackups(); }
  catch (x) { toast(x.message); } finally { $('backupNow').disabled = false; }
};
