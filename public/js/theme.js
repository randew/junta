// Junta — tema de fim de ano ("Noite Feliz"): cores de noite, neve caindo, gorro no ícone
// e contagem para o Natal e o Ano Novo. O dono liga e desliga em Administração → Tema.
'use strict';

let curTheme = null;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

function applyTheme(theme) {
  theme = theme === 'noite' ? 'noite' : null;
  if (theme === curTheme) return;
  curTheme = theme;
  document.documentElement.classList.toggle('theme-noite', theme === 'noite');
  if (theme) startSnow(); else stopSnow();
  updateSeasonPill();
  if (typeof renderThemeTab === 'function') renderThemeTab();
}

// ---------- contagem: Natal, depois Ano Novo ----------
function seasonText(now = new Date()) {
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  const today = new Date(y, m, d);
  const daysTo = (date) => Math.round((date - today) / 864e5);
  if (m === 0 && d === 1) return 'Feliz Ano Novo! 🎆';
  if (m === 11 && (d === 24 || d === 25)) return 'Feliz Natal! 🎄';
  if (m === 11 && d > 25) { const n = daysTo(new Date(y + 1, 0, 1)); return n === 1 ? 'Amanhã é Ano Novo! ✨' : `✨ Faltam ${n} dias para o Ano Novo`; }
  const n = daysTo(new Date(y, 11, 25));
  return n === 1 ? 'Amanhã é Natal! ❄' : `❄ Faltam ${n} dias para o Natal`;
}
function updateSeasonPill() {
  const p = $('seasonPill'); if (!p) return;
  p.hidden = !curTheme;
  if (curTheme) p.textContent = seasonText();
}
setInterval(updateSeasonPill, 10 * 60_000); // vira o dia sozinho

// ---------- neve ----------
// Um canvas por cima da página que não recebe cliques. Pausa com a aba escondida, some enquanto
// uma transmissão está aberta (para não atrapalhar quem assiste) e respeita "reduzir movimento".
let snow = null;
function startSnow() {
  if (snow || reduceMotion.matches) return;
  const cv = el('canvas', 'snow'); cv.setAttribute('aria-hidden', 'true');
  document.body.append(cv);
  const g = cv.getContext('2d');
  let W = 0, H = 0, flakes = [];
  const size = () => {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    W = innerWidth; H = innerHeight;
    cv.width = W * dpr; cv.height = H * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const want = Math.round(Math.min(160, (W * H) / 9000));
    while (flakes.length < want) flakes.push(flake(true));
    flakes.length = want;
  };
  const flake = (anywhere) => ({
    x: Math.random() * W, y: anywhere ? Math.random() * H : -6,
    r: Math.random() * 2 + 0.6, s: Math.random() * 0.5 + 0.25, w: Math.random() * Math.PI * 2, a: Math.random() * 0.5 + 0.35,
  });
  size(); addEventListener('resize', size);
  let last = 0, raf = 0;
  const frame = (t) => {
    raf = requestAnimationFrame(frame);
    if (t - last < 33) return; // ~30 quadros por segundo bastam
    const dt = Math.min((t - last) / 16.7, 4); last = t;
    const watching = !!document.querySelector('#voiceView:not([hidden]) .stage.has-screen');
    cv.hidden = watching; if (watching) return;
    g.clearRect(0, 0, W, H);
    for (const f of flakes) {
      f.y += f.s * dt; f.w += 0.01 * dt; f.x += Math.sin(f.w) * 0.35 * dt;
      if (f.y > H + 6) Object.assign(f, flake(false));
      if (f.x > W + 6) f.x = -6; else if (f.x < -6) f.x = W + 6;
      g.globalAlpha = f.a; g.beginPath(); g.arc(f.x, f.y, f.r, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill();
    }
  };
  const vis = () => { cancelAnimationFrame(raf); if (!document.hidden) { last = performance.now(); raf = requestAnimationFrame(frame); } };
  document.addEventListener('visibilitychange', vis); vis();
  snow = { stop() { cancelAnimationFrame(raf); removeEventListener('resize', size); document.removeEventListener('visibilitychange', vis); cv.remove(); } };
}
function stopSnow() { snow?.stop(); snow = null; }
reduceMotion.addEventListener?.('change', () => { if (reduceMotion.matches) stopSnow(); else if (curTheme) startSnow(); });

// antes do login também (tela de entrada), e ao vivo quando o dono muda
fetch('/api/theme').then((r) => r.json()).then((d) => applyTheme(d.theme)).catch(() => {});
socket.on('theme', (d) => {
  const was = curTheme;
  applyTheme(d?.theme);
  if (curTheme && !was) toast('O tema de fim de ano chegou ao Junta! ❄');
});
