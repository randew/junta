// Junta — painéis redimensionáveis e chat de texto ao lado da sala de voz
'use strict';

// ---------- larguras dos painéis ----------
// Arraste a borda para ajustar; duplo clique volta ao padrão. Fica salvo neste navegador.
const PANELS_KEY = 'junta:panels';
const PANEL_DEF = { side: 248, mem: 240, chat: 380 };
const PANEL_LIM = { side: [200, 420], mem: [180, 400], chat: [280, 720] };
const panelW = (() => { try { return { ...PANEL_DEF, ...JSON.parse(localStorage.getItem(PANELS_KEY)) }; } catch { return { ...PANEL_DEF }; } })();
function applyPanel(name) {
  const [lo, hi] = PANEL_LIM[name];
  panelW[name] = Math.round(Math.min(hi, Math.max(lo, panelW[name])));
  document.documentElement.style.setProperty(`--${name}-w`, panelW[name] + 'px');
}
const savePanels = () => { try { localStorage.setItem(PANELS_KEY, JSON.stringify(panelW)); } catch {} };
Object.keys(PANEL_DEF).forEach(applyPanel);

// dir = +1: puxar para a direita alarga (lista de canais); -1: puxar para a esquerda alarga (membros, chat)
function makeResizer(handle, name, dir) {
  let x0 = 0, w0 = 0;
  const move = (e) => { panelW[name] = w0 + dir * (e.clientX - x0); applyPanel(name); };
  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); x0 = e.clientX; w0 = panelW[name];
    handle.setPointerCapture(e.pointerId); handle.classList.add('dragging'); document.body.classList.add('resizing');
    handle.addEventListener('pointermove', move);
  });
  const end = () => {
    if (!handle.classList.contains('dragging')) return;
    handle.removeEventListener('pointermove', move); handle.classList.remove('dragging'); document.body.classList.remove('resizing');
    savePanels();
  };
  handle.addEventListener('pointerup', end); handle.addEventListener('pointercancel', end); handle.addEventListener('lostpointercapture', end);
  handle.addEventListener('dblclick', () => { panelW[name] = PANEL_DEF[name]; applyPanel(name); savePanels(); });
  handle.addEventListener('keydown', (e) => { // pelo teclado: setas ajustam de 16 em 16
    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0; if (!d) return;
    e.preventDefault(); panelW[name] += d * dir * 16; applyPanel(name); savePanels();
  });
}
makeResizer($('sideResize'), 'side', 1);
makeResizer($('memResize'), 'mem', -1);
makeResizer($('chatResize'), 'chat', -1);

// ---------- chat ao lado da sala de voz ----------
// Numa sala de voz, abre um canal de texto do mesmo servidor ao lado do palco,
// para conversar enquanto assiste a uma transmissão.
const SIDE_PREF = 'junta:sidechat';
const sidePref = () => { try { return localStorage.getItem(SIDE_PREF) === '1'; } catch { return false; } };
const setSidePref = (on) => { try { localStorage.setItem(SIDE_PREF, on ? '1' : '0'); } catch {} };
const lastTextKey = (sid) => `junta:lasttext:${sid}`;
function rememberText(sid, cid) { try { localStorage.setItem(lastTextKey(sid), cid); } catch {} }

// o canal sugerido: o último usado aqui ao lado, senão o último aberto neste servidor, senão o primeiro
function defaultSideChat() {
  const texts = (currentServer()?.channels || []).filter((c) => c.type === 'text');
  let last = null; try { last = localStorage.getItem(lastTextKey(S.serverId)); } catch {}
  return (texts.find((c) => c.id === last) || texts[0])?.id || null;
}

function openSideChat(cid = defaultSideChat()) {
  if (currentChannel()?.type !== 'voice') return;
  if (!cid) { toast('Este servidor não tem canais de texto que você possa ver.'); return; }
  S.sideChat = cid;
  rememberText(S.serverId, cid);
  $('views').classList.add('split');
  $('textView').hidden = false; $('sideHead').hidden = false; $('chatResize').hidden = false;
  $('chatBtn').setAttribute('aria-pressed', 'true');
  fillSideSelect();
  $('msgInput').placeholder = `Mensagem em #${sideChannel()?.name || ''}`;
  openText(curKey()); updateComposer();
  renderChannels();
}
function closeSideChat(keepPref) {
  if (!S.sideChat && !$('views').classList.contains('split')) return;
  S.sideChat = null;
  $('views').classList.remove('split');
  $('sideHead').hidden = true; $('chatResize').hidden = true;
  $('chatBtn').setAttribute('aria-pressed', 'false');
  if (currentChannel()?.type === 'voice') { $('textView').hidden = true; S.messages = []; }
  if (!keepPref) setSidePref(false);
  renderChannels();
}
function fillSideSelect() {
  const sel = $('sideSelect'); sel.replaceChildren();
  for (const c of (currentServer()?.channels || []).filter((x) => x.type === 'text')) {
    const o = el('option', null, c.name); o.value = c.id; sel.append(o);
  }
  sel.value = S.sideChat || '';
}
$('sideSelect').onchange = () => openSideChat($('sideSelect').value);
$('sideClose').onclick = () => closeSideChat();
$('chatBtn').onclick = () => { if (S.sideChat) closeSideChat(); else { setSidePref(true); openSideChat(); } };

// chamado ao abrir um canal: fecha o chat lateral num canal de texto; reabre numa sala de voz se você o deixou aberto
function syncSideChat() {
  const c = currentChannel();
  if (!c || c.type !== 'voice') { closeSideChat(true); return; }
  if (sidePref() && S.voiceKey === keyOf(S.serverId, c.id)) openSideChat(sideChannel()?.id || defaultSideChat());
  else closeSideChat(true);
}
// o canal ao lado foi apagado, renomeado ou ficou privado
function refreshSideChat() {
  if (!S.sideChat) return;
  if (!sideChannel()) { closeSideChat(true); toast('O canal do chat lateral foi apagado ou ficou privado.'); return; }
  fillSideSelect();
  $('msgInput').placeholder = `Mensagem em #${sideChannel().name}`;
}
