// Junta — login, convite e início
'use strict';

// ---------- login ----------
let authMode = 'login';
function setAuthMode(mode) {
  authMode = mode;
  $('tabLogin').setAttribute('aria-selected', String(mode === 'login'));
  $('tabSignup').setAttribute('aria-selected', String(mode === 'signup'));
  $('inviteField').hidden = mode !== 'signup';
  $('authInvite').required = mode === 'signup';
  $('authPass').autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
  $('authSubmit').textContent = mode === 'signup' ? 'Criar conta' : 'Entrar';
  $('authHint').textContent = mode === 'signup'
    ? 'Usuário: 3 a 24 letras, números, ponto, hífen ou sublinhado. Senha: pelo menos 6 caracteres.'
    : 'Ainda não tem conta? Clique em "Criar conta" e use o código de convite de quem administra o Junta.';
  $('authError').hidden = true;
}
$('tabLogin').onclick = () => setAuthMode('login');
$('tabSignup').onclick = () => setAuthMode('signup');
function showAuth(msg) {
  $('auth').hidden = false; setAuthMode('login'); // quem volta para esta tela já tem conta
  if (msg) { $('authError').textContent = msg; $('authError').hidden = false; }
  setTimeout(() => $('authUser').focus(), 30);
}
$('authForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('authSubmit').disabled = true; $('authError').hidden = true;
  try {
    const body = { username: $('authUser').value.trim(), password: $('authPass').value, invite: $('authInvite').value };
    const r = await fetch(authMode === 'signup' ? '/api/register' : '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'Não foi possível entrar.');
    $('authPass').value = '';
    if (booted) { location.reload(); return; } // entrou de novo depois de a sessão cair: começa do zero
    await boot();
  } catch (err) {
    $('authError').textContent = err.message; $('authError').hidden = false;
  } finally { $('authSubmit').disabled = false; }
});

async function logout() {
  if (S.voiceKey) leaveVoice();
  try { await fetch('/api/logout', { method: 'POST' }); } catch {}
  location.reload();
}

// ---------- convite (dono) ----------
async function openInvite() {
  try {
    const r = await fetch('/api/invite'); const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    $('inviteCode').textContent = d.code; $('inviteModal').hidden = false; $('inviteCopy').focus();
  } catch (err) { toast(err.message || 'Não foi possível abrir o convite.'); }
}
$('inviteCopy').onclick = async () => {
  const text = `Entre no Junta: ${location.origin}\nCódigo de convite: ${$('inviteCode').textContent}`;
  try { await navigator.clipboard.writeText(text); toast('Convite copiado. Agora é só colar para o amigo.'); }
  catch { const rg = document.createRange(); rg.selectNodeContents($('inviteCode')); getSelection().removeAllRanges(); getSelection().addRange(rg); toast('Selecionei o código: aperte Ctrl+C para copiar.'); }
};
$('inviteNew').onclick = async () => {
  const r = await fetch('/api/invite/new', { method: 'POST' }); const d = await r.json();
  if (r.ok) { $('inviteCode').textContent = d.code; toast('Código novo gerado. O anterior não funciona mais.'); } else toast(d.error);
};
$('inviteClose').onclick = () => { $('inviteModal').hidden = true; };
$('inviteModal').addEventListener('keydown', (e) => { if (e.key === 'Escape') $('inviteModal').hidden = true; });

async function boot() {
  try {
    const r = await fetch('/api/me');
    if (r.ok) {
      const d = await r.json();
      S.me.uid = d.user.id; S.me.name = d.user.name; S.me.role = d.user.role;
      S.limits = { maxFileMb: d.maxFileMb, maxFiles: d.maxFiles };
      $('auth').hidden = true;
      $('ownerItems').hidden = !isOwner();
      renderMe();
      socket.connect();
      return;
    }
  } catch {}
  showAuth();
}
boot();

socket.on('disconnect', () => toast('Conexão perdida. Tentando reconectar…'));
window.addEventListener('beforeunload', () => { if (S.voiceKey) socket.emit('voice-leave'); });
