// Junta — formatação das mensagens e seletor de emojis
// O texto é montado nó a nó (nunca como HTML), então nada que alguém digite vira código na página.
'use strict';

// ---------- formatação ----------
// **negrito**  *itálico*  _itálico_  __sublinhado__  ~~riscado~~  ||spoiler||  `código`  ```bloco```  > citação
// links viram clicáveis (<link> não gera prévia) e @usuario vira menção
const INLINE = new RegExp([
  '(?<code>`+)(?<codeText>[\\s\\S]+?)\\k<code>',
  '\\|\\|(?<spoiler>[\\s\\S]+?)\\|\\|',
  '\\*\\*(?<bold>[\\s\\S]+?)\\*\\*',
  '__(?<under>[\\s\\S]+?)__',
  '~~(?<strike>[\\s\\S]+?)~~',
  '\\*(?<ital>[^*\\s](?:[^*]*[^*\\s])?)\\*',
  '(?<![\\w])_(?<ital2>[^_\\s](?:[^_]*[^_\\s])?)_(?![\\w])',
  '<(?<angle>https?://[^\\s>]+)>',
  '(?<url>https?://[^\\s<]+[^\\s<.,;:!?)\\]"\'])',
  '(?<![\\w@])@(?<mention>[a-zA-Z0-9_.-]{3,24})',
  ':(?<cemo>[a-z0-9_]{2,32}):',
].join('|'), 'g');

const userByUsername = (name) => { const n = name.toLowerCase(); for (const u of S.users.values()) if (u.username.toLowerCase() === n) return u; return null; };

function link(href, text) {
  const a = el('a', null, text); a.href = href; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a;
}
function inline(text, parent, depth = 0) {
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) parent.append(text.slice(last, m.index));
    const g = m.groups;
    const nest = (tag, cls, inner) => { const e = el(tag, cls); if (depth < 4) inline(inner, e, depth + 1); else e.append(inner); parent.append(e); };
    if (g.code) parent.append(el('code', null, g.codeText));
    else if (g.spoiler) {
      const sp = el('span', 'spoiler'); sp.tabIndex = 0; sp.setAttribute('role', 'button'); sp.setAttribute('aria-label', 'Spoiler: clique para revelar');
      if (depth < 4) inline(g.spoiler, sp, depth + 1); else sp.append(g.spoiler);
      const reveal = () => { sp.classList.add('shown'); sp.removeAttribute('role'); sp.removeAttribute('aria-label'); };
      sp.onclick = reveal; sp.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); reveal(); } };
      parent.append(sp);
    }
    else if (g.bold) nest('strong', null, g.bold);
    else if (g.under) nest('u', null, g.under);
    else if (g.strike) nest('s', null, g.strike);
    else if (g.ital || g.ital2) nest('em', null, g.ital || g.ital2);
    else if (g.angle) parent.append(link(g.angle, g.angle));
    else if (g.url) parent.append(link(g.url, g.url));
    else if (g.cemo) {
      const em = customEmoji(g.cemo);
      if (em) parent.append(customEmojiImg(em)); else parent.append(m[0]);
    }
    else if (g.mention && /^(todos|everyone)$/i.test(g.mention)) {
      parent.append(el('span', 'mention all', '@todos'));
    }
    else if (g.mention) {
      const u = userByUsername(g.mention);
      if (!u) parent.append(m[0]);
      else {
        const b = el('button', 'mention' + (u.id === S.me.uid ? ' to-me' : ''), '@' + userName(u.id)); b.type = 'button';
        b.onclick = () => openCard(u.id, b); parent.append(b);
      }
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) parent.append(text.slice(last));
}

// blocos: ```código```, citações com "> " e o resto em linhas
function renderRich(text, parent) {
  const parts = String(text).split(/```(?:[a-zA-Z0-9+#-]*\n)?([\s\S]*?)```/g);
  parts.forEach((chunk, i) => {
    if (i % 2 === 1) { const pre = el('pre'); pre.append(el('code', null, chunk.replace(/\n$/, ''))); parent.append(pre); return; }
    if (!chunk) return;
    const lines = chunk.split('\n');
    let quote = null;
    lines.forEach((line, j) => {
      const q = line.match(/^>\s?(.*)$/);
      if (q) {
        if (!quote) { quote = el('blockquote'); parent.append(quote); } else quote.append(el('br'));
        inline(q[1], quote);
      } else {
        quote = null;
        inline(line, parent);
        if (j < lines.length - 1) parent.append('\n');
      }
    });
  });
}
// o texto menciona esta conta?
const mentionsMe = (text) => {
  const me = S.users.get(S.me.uid)?.username?.toLowerCase();
  return !!me && [...String(text).matchAll(/(?<![\w@])@([a-zA-Z0-9_.-]{3,24})/g)].some((m) => m[1].toLowerCase() === me);
};
// texto curto, sem marcações, para citações e notificações
const plainPreview = (text, n = 120) => String(text).replace(/```[\s\S]*?```/g, '[código]').replace(/\|\|[\s\S]+?\|\|/g, '[spoiler]')
  .replace(/[*_~`>]/g, '').replace(/\s+/g, ' ').trim().slice(0, n);

// ---------- emojis ----------
const EMOJIS = {
  'Rostos': '😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 😉 😌 😍 🥰 😘 😋 😛 😜 🤪 😎 🤩 🥳 😏 😒 😞 😔 😟 😕 🙁 😣 😖 😫 😩 🥺 😢 😭 😤 😠 😡 🤬 🤯 😳 🥵 🥶 😱 😨 😰 😥 🤗 🤔 🤭 🤫 🤥 😶 😐 😑 😬 🙄 😯 😦 😧 😮 😲 🥱 😴 🤤 😪 😵 🤐 🥴 🤢 🤮 🤧 😷 🤒 🤕 🤑 🤠 😈 👻 💀 🤡 💩 🤖 👽',
  'Gestos': '👍 👎 👌 🤌 ✌️ 🤞 🤟 🤘 🤙 👈 👉 👆 👇 ☝️ ✋ 🤚 🖐️ 🖖 👋 👏 🙌 👐 🤲 🙏 💪 🫡 🫶 🤝 ✍️ 👀 🧠',
  'Corações': '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❣️ 💕 💞 💓 💗 💖 💘 💝',
  'Coisas': '🔥 ✨ 🎉 🎊 🎈 🎁 🏆 🥇 ⭐ 🌟 💯 ✅ ❌ ⚠️ ❓ ❗ 💡 📌 📎 🔗 💻 🖥️ 🎮 🕹️ 🎧 🎤 📷 📺 📱 ⏰ 💤 💬 🚀 🍕 🍔 🍟 🍺 🍻 ☕ 🎂 🐶 🐱 🦆 🐸 🌈 ☀️ 🌧️ ⚡',
};
const RECENT_KEY = 'junta:emojis';
const recentEmojis = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch { return []; } };
function rememberEmoji(e) {
  const list = [e, ...recentEmojis().filter((x) => x !== e)].slice(0, 16);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch {}
}

let pickerDone = null, pickerAnchor = null;
// abre o seletor perto do elemento; chama onPick(emoji)
function openEmojiPicker(anchor, onPick) {
  const pk = $('emojiPicker');
  if (!pk.hidden && pickerAnchor === anchor) { closeEmojiPicker(); return; }
  pickerDone = onPick; pickerAnchor = anchor;
  pk.replaceChildren();
  const recent = recentEmojis().filter((e) => !/^:/.test(e) || customEmoji(e.slice(1, -1)));
  const groups = { ...(recent.length ? { 'Usados recentemente': recent.join(' ') } : {}), ...customEmojiGroups(), ...EMOJIS };
  for (const [label, list] of Object.entries(groups)) {
    pk.append(el('div', 'ep-label', label));
    const grid = el('div', 'ep-grid');
    for (const e of list.split(' ')) {
      const b = el('button', 'ep-btn'); b.append(emojiNode(e)); b.type = 'button'; b.setAttribute('aria-label', e); b.title = /^:/.test(e) ? e : '';
      b.onclick = () => { rememberEmoji(e); const f = pickerDone; closeEmojiPicker(); f?.(e); };
      grid.append(b);
    }
    pk.append(grid);
  }
  pk.hidden = false;
  const r = anchor.getBoundingClientRect(), W = pk.offsetWidth, H = pk.offsetHeight, m = 8;
  let left = Math.min(Math.max(m, r.right - W), innerWidth - W - m);
  let top = r.top - H - m; if (top < m) top = Math.min(r.bottom + m, innerHeight - H - m);
  pk.style.left = left + 'px'; pk.style.top = top + 'px';
  pk.querySelector('button')?.focus({ preventScroll: true });
}
function closeEmojiPicker() { $('emojiPicker').hidden = true; pickerDone = null; pickerAnchor = null; }
document.addEventListener('mousedown', (e) => {
  const pk = $('emojiPicker');
  if (!pk.hidden && !pk.contains(e.target) && !pickerAnchor?.contains(e.target)) closeEmojiPicker();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('emojiPicker').hidden) { const a = pickerAnchor; closeEmojiPicker(); a?.focus?.(); } });

// ---------- emojis personalizados (por servidor) ----------
// :nome: usa o emoji do servidor aberto; numa conversa direta, o de qualquer servidor
function customEmoji(name) {
  const here = !S.home && S.servers.find((s) => s.id === S.serverId);
  const pickIn = (s) => s?.emojis?.find((e) => e.name === name);
  return pickIn(here) || (S.home ? S.servers.map(pickIn).find(Boolean) : null) || null;
}
function customEmojiImg(em) {
  const img = el('img', 'cemoji'); img.src = '/emojis/' + em.file; img.alt = `:${em.name}:`; img.title = `:${em.name}:`; img.loading = 'lazy';
  img.draggable = false; return img;
}
// um emoji comum (texto) ou personalizado (:nome:) pronto para pôr na tela
function emojiNode(e) {
  const m = /^:([a-z0-9_]{2,32}):$/.exec(e);
  const em = m && customEmoji(m[1]);
  return em ? customEmojiImg(em) : document.createTextNode(e);
}
// grupos do seletor: os do servidor aberto (ou de todos, nas conversas diretas)
function customEmojiGroups() {
  const out = {};
  const list = S.home ? S.servers : S.servers.filter((s) => s.id === S.serverId);
  for (const s of list) if (s.emojis?.length) out[s.name] = s.emojis.map((e) => `:${e.name}:`).join(' ');
  return out;
}

// ---------- GIFs nas mensagens ----------
// uma mensagem que é só o endereço de um GIF aparece como imagem
const GIF_HOSTS = /(^|\.)(klipy\.com|giphy\.com|tenor\.com)$/i;
function isGifUrl(text) {
  const t = String(text).trim();
  if (!/^https:\/\/\S+$/.test(t)) return false;
  try { const u = new URL(t); return GIF_HOSTS.test(u.hostname) || /\.(gif|webp)$/i.test(u.pathname); } catch { return false; }
}
function gifNode(url) {
  const box = el('div', 'gif-msg');
  const img = el('img'); img.src = url.trim(); img.alt = 'GIF'; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer';
  img.onload = () => typeof keepBottom === 'function' && keepBottom();
  img.onerror = () => { box.replaceChildren(link(url, url)); };
  const fav = el('button', 'icon-btn gif-fav', '★'); fav.type = 'button';
  const sync = () => { const on = gifFavs.has(url.trim()); fav.classList.toggle('on', on); fav.title = on ? 'Tirar dos favoritos' : 'Guardar nos favoritos'; fav.setAttribute('aria-label', fav.title); };
  sync();
  fav.onclick = (e) => { e.stopPropagation(); toggleGifFav({ url: url.trim(), preview: url.trim() }).then(sync); };
  box.append(img, fav);
  return box;
}
