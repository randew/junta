// Junta — mensagens diretas e navegação entre servidores e conversas
'use strict';

// abre um canal de servidor ou uma conversa direta (opcionalmente numa mensagem)
function navigateTo(key, opts = {}) {
  if (!key) return;
  if (isDmKey(key)) { openDm(dmOther(key), opts); return; }
  const [sid, cid] = key.split('/');
  if (!S.servers.some((s) => s.id === sid)) return;
  S.home = false; S.serverId = sid;
  selectChannel(cid, opts);
}

// ---------- tela inicial (conversas diretas) ----------
function selectHome() {
  if (S.home && S.dmKey) return;
  const first = S.dms.find((d) => !S.users.get(d.other)?.disabled);
  if (first) { openDm(first.other); return; }
  S.home = true; S.dmKey = null;
  showDmEmpty();
}
function showDmEmpty() {
  $('topMark').textContent = '@'; $('channelTitle').textContent = 'Mensagens diretas'; $('channelSub').textContent = '';
  $('textView').hidden = true; $('voiceView').hidden = true; $('dmEmpty').hidden = false;
  renderRail(); renderChannels(); renderMembers();
}
$('homeBtn').onclick = () => { selectHome(); $('app').classList.remove('drawer'); };

function openDm(uid, opts = {}) {
  if (uid === S.me.uid || !S.users.has(uid)) return;
  S.home = true; S.dmKey = dmKeyWith(uid);
  try { localStorage.setItem('junta:last', S.dmKey); } catch {}
  const name = userName(uid);
  $('topMark').textContent = '@'; $('channelTitle').textContent = name;
  $('channelSub').textContent = S.users.get(uid)?.disabled ? 'Conta removida' : 'Conversa direta';
  $('dmEmpty').hidden = true; $('voiceView').hidden = true; $('textView').hidden = false;
  $('msgInput').placeholder = `Mensagem para @${name}`;
  $('composer').hidden = !!S.users.get(uid)?.disabled;
  renderRail(); renderChannels(); renderMembers();
  openText(S.dmKey, opts);
  $('app').classList.remove('drawer');
}

// mantém a lista de conversas em ordem da mais recente
function touchDm(key, ts = Date.now()) {
  const other = dmOther(key);
  const cur = S.dms.find((d) => d.key === key);
  if (cur) cur.last = Math.max(cur.last, ts); else S.dms.push({ key, other, last: ts });
  S.dms.sort((a, b) => b.last - a.last);
  if (S.home) renderChannels();
}

function renderDmList(box) {
  $('serverName').textContent = 'Mensagens diretas';
  const top = el('div', 'cat'); top.append(el('span', null, 'Conversas'));
  const add = el('button', null, '+'); add.title = 'Nova conversa'; add.setAttribute('aria-label', 'Nova conversa'); add.onclick = newDm;
  top.append(add); box.append(top);
  // a conversa aberta aparece mesmo antes da primeira mensagem
  const list = [...S.dms];
  if (S.dmKey && !list.some((d) => d.key === S.dmKey)) list.unshift({ key: S.dmKey, other: dmOther(S.dmKey), last: Date.now() });
  if (!list.length) { box.append(el('p', 'side-empty', 'Nenhuma conversa ainda. Clique no + ou no perfil de alguém e em "Enviar mensagem".')); return; }
  for (const d of list) {
    const u = S.users.get(d.other); if (!u) continue;
    const status = liveStatus(d.other);
    const b = el('button', 'chan dm-item' + (d.key === S.dmKey ? ' active' : '') + (S.unread[d.key] ? ' unread' : '') + (u.disabled ? ' gone' : ''));
    b.type = 'button';
    const w = el('span', 'av-wrap'); w.append(avatar(u.name, u.id), el('span', 'sdot s-' + status)); b.append(w);
    b.append(el('span', 'label', u.name + (u.disabled ? ' (removido)' : '')));
    if (S.unread[d.key]?.m) b.append(badge(S.unread[d.key].m));
    b.onclick = () => openDm(d.other);
    box.append(b);
  }
}
// status ao vivo de uma conta (o "mais ativo" entre as abas abertas)
function liveStatus(uid) {
  let best = 'offline';
  for (const o of S.online) if (o.uid === uid && (best === 'offline' || RANK[o.status] < RANK[best])) best = o.status;
  return best;
}

// escolher alguém para conversar
function newDm() {
  const list = $('dmPickList'); const q = $('dmPickSearch');
  const draw = () => {
    const t = q.value.trim().toLowerCase();
    list.replaceChildren();
    const people = [...S.users.values()].filter((u) => u.id !== S.me.uid && !u.disabled && (!t || u.name.toLowerCase().includes(t) || u.username.toLowerCase().includes(t)))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    if (!people.length) { list.append(el('p', 'side-empty', 'Ninguém encontrado.')); return; }
    for (const u of people) {
      const b = el('button', 'pick-row'); b.type = 'button';
      const w = el('span', 'av-wrap'); w.append(avatar(u.name, u.id), el('span', 'sdot s-' + liveStatus(u.id)));
      b.append(w, el('span', 'nm', u.name), el('span', 'mp-user', '@' + u.username));
      b.onclick = () => { $('dmPick').hidden = true; openDm(u.id); };
      list.append(b);
    }
  };
  q.value = ''; q.oninput = draw; draw();
  $('dmPick').hidden = false; q.focus();
}
$('dmPickClose').onclick = () => { $('dmPick').hidden = true; };
$('dmPick').addEventListener('keydown', (e) => { if (e.key === 'Escape') $('dmPick').hidden = true; });
$('dmEmptyNew').onclick = newDm;
