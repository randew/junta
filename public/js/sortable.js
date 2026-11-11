// Junta — reordenar arrastando (mouse e toque), usado na barra de servidores e na lista de canais
'use strict';

// Enquanto alguém arrasta, a barra e a lista não são redesenhadas (senão o item "sumiria" da mão)
let dragLock = false;

// container: elemento cujos filhos diretos (selector) podem ser arrastados
// onDrop(novaOrdem, ordemAntiga): ids na nova ordem; enabled(): pode arrastar agora?
function makeSortable(container, { selector, onDrop, enabled = () => true }) {
  const items = () => [...container.children].filter((c) => c.matches(selector));
  const ids = () => items().map((c) => c.dataset.id);
  const scroller = () => { let n = container; while (n && n !== document.body) { const o = getComputedStyle(n).overflowY; if (o === 'auto' || o === 'scroll') return n; n = n.parentElement; } return null; };
  let st = null;

  container.addEventListener('pointerdown', (e) => {
    if (!enabled() || (e.pointerType === 'mouse' && e.button !== 0) || dragLock) return;
    const item = e.target.closest(selector);
    if (!item || item.parentElement !== container || e.target.closest('input, textarea, .chan-del')) return;
    st = { item, x: e.clientX, y: e.clientY, pid: e.pointerId, active: false, touch: e.pointerType !== 'mouse', before: ids() };
    // no toque: segurar um instante para começar (senão a lista não rola)
    if (st.touch) st.timer = setTimeout(() => { if (st && !st.active) begin(); }, 300);
  });

  function begin() {
    st.active = true; dragLock = true;
    const r = st.item.getBoundingClientRect();
    st.dx = st.x - r.left; st.dy = st.y - r.top;
    const g = st.item.cloneNode(true);
    g.classList.add('drag-ghost'); g.style.width = r.width + 'px'; g.style.height = r.height + 'px';
    g.style.transform = `translate(${r.left}px, ${r.top}px)`;
    document.body.append(g); st.ghost = g;
    st.item.classList.add('dragging'); container.classList.add('sorting');
    try { container.setPointerCapture(st.pid); } catch {}
    navigator.vibrate?.(15);
  }

  function move(e) {
    if (!st || e.pointerId !== st.pid) return;
    if (!st.active) {
      const far = Math.hypot(e.clientX - st.x, e.clientY - st.y) > 6;
      if (far && st.touch) { clearTimeout(st.timer); st = null; return; } // no toque, mexeu antes da hora: é rolagem
      if (far) begin(); else return;
    }
    st.ghost.style.transform = `translate(${e.clientX - st.dx}px, ${e.clientY - st.dy}px)`;
    // coloca o item antes do primeiro vizinho cujo meio está abaixo do ponteiro
    const others = items().filter((c) => c !== st.item);
    const next = others.find((c) => { const r = c.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
    if (next) { if (st.item.nextElementSibling !== next) container.insertBefore(st.item, next); }
    else if (others.length && others.at(-1).nextElementSibling !== st.item) others.at(-1).after(st.item);
    // rola sozinho perto das bordas
    const sc = scroller();
    if (sc) { const r = sc.getBoundingClientRect(); if (e.clientY < r.top + 32) sc.scrollTop -= 10; else if (e.clientY > r.bottom - 32) sc.scrollTop += 10; }
  }

  function finish(cancel) {
    if (!st) return;
    clearTimeout(st.timer);
    const was = st; st = null;
    if (!was.active) return;
    was.ghost.remove(); was.item.classList.remove('dragging'); container.classList.remove('sorting');
    dragLock = false;
    const after = ids();
    if (cancel || after.join() === was.before.join()) {
      // volta como estava
      const byId = Object.fromEntries(items().map((c) => [c.dataset.id, c]));
      was.before.forEach((id) => byId[id] && container.append(byId[id]));
    } else onDrop(after, was.before);
    // o clique que vem logo depois de soltar não deve abrir o servidor/canal
    const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
    window.addEventListener('click', swallow, { capture: true, once: true });
    setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 80);
    setTimeout(() => window.dispatchEvent(new Event('junta:dragend')), 0);
  }

  container.addEventListener('pointermove', move);
  container.addEventListener('pointerup', () => finish(false));
  container.addEventListener('pointercancel', () => finish(true));
  container.addEventListener('lostpointercapture', () => { if (st?.active) finish(false); });
  // durante o arraste no toque, impede a página de rolar
  container.addEventListener('touchmove', (e) => { if (st?.active) e.preventDefault(); }, { passive: false });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && st?.active) finish(true); });
}
// depois de soltar, redesenha o que ficou pendente
window.addEventListener('junta:dragend', () => { renderRail(); renderChannels(); });
