// Junta — não lidas, menções e notificações do sistema
'use strict';

// ---------- marcar como lido ----------
// conta como lido quando a conversa está aberta, a janela está em foco e você está no fim dela
let readSent = {};
function markRead() {
  const key = curKey();
  if (!key || !S.messages.length || !S.atLatest || !stickBottom || document.hidden || !document.hasFocus()) return;
  const seq = S.messages.at(-1).seq;
  if (S.unread[key]) { delete S.unread[key]; renderUnread(); }
  if ((readSent[key] || 0) >= seq) return;
  readSent[key] = seq;
  socket.emit('read', { key, seq });
}
window.addEventListener('focus', markRead);
document.addEventListener('visibilitychange', markRead);

// outra aba (ou este aparelho) marcou como lido
socket.on('read', ({ key, seq }) => {
  readSent[key] = Math.max(readSent[key] || 0, seq);
  if (S.unread[key]) { delete S.unread[key]; renderUnread(); }
});

// ---------- chegou mensagem em algum canal ----------
socket.on('activity', (a) => {
  if (a.uid === S.me.uid) { if (isDmKey(a.key)) touchDm(a.key, a.ts); return; }
  if (isDmKey(a.key)) touchDm(a.key, a.ts);
  const mention = a.mentions.includes(S.me.uid) || isDmKey(a.key); // conversa direta conta como menção
  const looking = a.key === curKey() && !document.hidden && document.hasFocus() && S.atLatest && stickBottom;
  if (!looking) {
    const u = (S.unread[a.key] ||= { n: 0, m: 0 });
    u.n++; if (mention) u.m++;
    renderUnread();
  }
  if (mention && (document.hidden || !document.hasFocus() || a.key !== curKey())) notify(a);
});

// ---------- contadores na tela ----------
function unreadIn(serverId) {
  let n = 0, m = 0;
  for (const [k, u] of Object.entries(S.unread)) if (!isDmKey(k) && k.startsWith(serverId + '/')) { n += u.n; m += u.m; }
  return { n, m };
}
function dmUnread() {
  let m = 0; for (const [k, u] of Object.entries(S.unread)) if (isDmKey(k)) m += u.m; return m;
}
function renderUnread() {
  renderRail(); renderChannels();
  // título da aba: (3) = menções e conversas diretas; • = algo novo
  const mentions = Object.values(S.unread).reduce((t, u) => t + u.m, 0);
  const any = Object.keys(S.unread).length > 0;
  document.title = mentions ? `(${mentions}) Junta` : any ? '• Junta' : 'Junta';
}
const badge = (n) => el('span', 'badge', n > 99 ? '99+' : String(n));

// ---------- notificações do sistema ----------
const NOTIF_KEY = 'junta:notif';
const notifOn = () => { try { return localStorage.getItem(NOTIF_KEY) === '1'; } catch { return false; } };
function notifLabel() {
  if (!('Notification' in window)) return 'Indisponível neste navegador';
  if (Notification.permission === 'denied') return 'Bloqueadas no navegador';
  return notifOn() && Notification.permission === 'granted' ? 'Ligadas' : 'Desligadas';
}
async function toggleNotifications() {
  if (!('Notification' in window)) return toast('Este navegador não mostra notificações.');
  if (notifOn()) { try { localStorage.setItem(NOTIF_KEY, '0'); } catch {} toast('Notificações desligadas.'); return refreshNotifItem(); }
  const p = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
  if (p !== 'granted') { toast('O navegador bloqueou as notificações. Libere nas configurações do site (cadeado ao lado do endereço).'); return refreshNotifItem(); }
  try { localStorage.setItem(NOTIF_KEY, '1'); } catch {}
  toast('Notificações ligadas: você será avisado de menções e mensagens diretas.');
  refreshNotifItem();
}
function refreshNotifItem() { const s = $('notifState'); if (s) s.textContent = notifLabel(); }

function notify(a) {
  if (myStatus() === 'dnd') return; // não perturbe: nada de som nem notificação
  const who = userName(a.uid, isDmKey(a.key) ? null : a.key.split('/')[0]);
  let where;
  if (isDmKey(a.key)) where = 'mensagem direta';
  else { const [sid, cid] = a.key.split('/'); const sv = S.servers.find((x) => x.id === sid); where = `#${sv?.channels.find((c) => c.id === cid)?.name || cid} · ${sv?.name || sid}`; }
  playCue('mention');
  if (!notifOn() || !('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(`${who} (${where})`, {
      body: plainPreview(a.preview, 160), tag: a.key, renotify: true,
      icon: avatarUrl(S.users.get(a.uid)) || undefined,
    });
    n.onclick = () => { window.focus(); navigateTo(a.key, { seq: a.seq }); n.close(); };
  } catch { /* alguns navegadores só notificam via service worker */ }
}
