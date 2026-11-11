// Prévia de links: título, descrição e imagem das páginas citadas nas mensagens.
// O servidor visita o link, então há proteções para ele nunca acessar a rede interna
// (roteador, o próprio PC etc.), mesmo que o site redirecione para lá.
const http = require('http');
const https = require('https');
const dns = require('dns');
const net = require('net');
const { db } = require('./db');
const { now } = require('./util');

const MAX_BYTES = 512 * 1024;
const TIMEOUT_MS = 6000;
const MAX_REDIRECTS = 3;
const CACHE_OK_MS = 7 * 864e5;   // prévia boa vale 7 dias
const CACHE_FAIL_MS = 6 * 36e5;  // falha: tenta de novo depois de 6 h
let allowPrivate = process.env.JUNTA_PREVIEW_ALLOW_PRIVATE === '1'; // só para os testes automáticos

// ---------- endereços proibidos ----------
function privateV4(ip) {
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0)
    || (a === 198 && (b === 18 || b === 19)) || a >= 224;
}
function isPrivate(ip) {
  if (net.isIPv4(ip)) return privateV4(ip);
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return privateV4(v.slice(7));
  return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9')
    || v.startsWith('fea') || v.startsWith('feb') || v.startsWith('ff') || v.startsWith('64:ff9b');
}
// resolve o nome e recusa endereços internos; a conexão usa exatamente o IP conferido
function safeLookup(hostname, opts, cb) {
  dns.lookup(hostname, { all: true }, (err, addrs) => {
    if (err) return cb(err);
    const ok = addrs.filter((a) => allowPrivate || !isPrivate(a.address));
    if (!ok.length) return cb(new Error('endereço interno bloqueado'));
    if (opts?.all) return cb(null, ok);
    cb(null, ok[0].address, ok[0].family);
  });
}

function fetchHtml(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(url); } catch { return reject(new Error('url inválida')); }
    if (!/^https?:$/.test(u.protocol) || (u.port && !['80', '443', '8080', '8443'].includes(u.port) && !allowPrivate)) return reject(new Error('protocolo ou porta não permitidos'));
    if (net.isIP(u.hostname.replace(/^\[|\]$/g, '')) && !allowPrivate && isPrivate(u.hostname.replace(/^\[|\]$/g, ''))) return reject(new Error('endereço interno bloqueado'));
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.get(u, {
      lookup: safeLookup,
      timeout: TIMEOUT_MS,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; JuntaPreview/1.0)', Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8' },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (redirects >= MAX_REDIRECTS) return reject(new Error('redirecionamentos demais'));
        return resolve(fetchHtml(new URL(res.headers.location, u).href, redirects + 1));
      }
      if (res.statusCode !== 200 || !/text\/html|application\/xhtml/i.test(res.headers['content-type'] || '')) { res.resume(); return reject(new Error('não é uma página')); }
      let size = 0; const chunks = [];
      res.on('data', (c) => { size += c.length; if (size > MAX_BYTES) { res.destroy(); } else chunks.push(c); });
      res.on('close', () => resolve({ html: Buffer.concat(chunks).toString('utf8'), finalUrl: u.href }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('tempo esgotado')));
    req.on('error', reject);
  });
}

// ---------- leitura das meta tags ----------
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) => s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m; }
  return ENT[e.toLowerCase()] ?? m;
}).replace(/\s+/g, ' ').trim();
function parseMeta(html, pageUrl) {
  const head = html.slice(0, 200000);
  const meta = {};
  for (const tag of head.match(/<meta\b[^>]*>/gi) || []) {
    const key = (tag.match(/\b(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i) || [])[1]?.toLowerCase();
    const val = (tag.match(/\bcontent\s*=\s*"([^"]*)"/i) || tag.match(/\bcontent\s*=\s*'([^']*)'/i) || [])[1];
    if (key && val != null && !(key in meta)) meta[key] = decode(val);
  }
  const title = meta['og:title'] || meta['twitter:title'] || decode((head.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '');
  if (!title) return null;
  let image = meta['og:image:secure_url'] || meta['og:image'] || meta['twitter:image'] || meta['twitter:image:src'] || null;
  if (image) { try { image = new URL(image, pageUrl).href; if (!/^https?:/.test(image)) image = null; } catch { image = null; } }
  const site = meta['og:site_name'] || new URL(pageUrl).hostname.replace(/^www\./, '');
  const color = /^#[0-9a-f]{6}$/i.test(meta['theme-color'] || '') ? meta['theme-color'] : null;
  return {
    title: title.slice(0, 200),
    description: (meta['og:description'] || meta['twitter:description'] || meta.description || '').slice(0, 300),
    image, site: site.slice(0, 80), color,
  };
}

// ---------- cache e uso nas mensagens ----------
// links da mensagem (até 3), ignorando os que estão dentro de `código`
function extractUrls(text) {
  const plain = String(text || '').replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ').replace(/<https?:\/\/[^>\s]+>/g, ' '); // <link> = sem prévia
  const out = [];
  for (const m of plain.matchAll(/https?:\/\/[^\s<>"')\]]+[^\s<>"')\].,;:!?]/g)) if (!out.includes(m[0])) out.push(m[0]);
  return out.slice(0, 3);
}
function cached(url) {
  const r = db.prepare('SELECT data, fetched FROM link_previews WHERE url = ?').get(url);
  if (!r) return undefined;
  const age = now() - r.fetched;
  if (r.data ? age > CACHE_OK_MS : age > CACHE_FAIL_MS) return undefined;
  return r.data ? JSON.parse(r.data) : null;
}
// prévias já conhecidas para o texto (as que faltam são buscadas por ensure)
function embedsFor(text) {
  return extractUrls(text).map((url) => { const d = cached(url); return d ? { url, ...d } : null; }).filter(Boolean);
}
const inflight = new Map();
async function fetchPreview(url) {
  if (cached(url) !== undefined) return;
  if (inflight.has(url)) return inflight.get(url);
  const p = (async () => {
    let data = null;
    try { const { html, finalUrl } = await fetchHtml(url); data = parseMeta(html, finalUrl); } catch { data = null; }
    db.prepare('INSERT INTO link_previews (url, data, fetched) VALUES (?, ?, ?) ON CONFLICT(url) DO UPDATE SET data = excluded.data, fetched = excluded.fetched')
      .run(url, data ? JSON.stringify(data) : null, now());
  })().finally(() => inflight.delete(url));
  inflight.set(url, p);
  return p;
}
// busca as prévias que faltam e avisa (onReady) se alguma nova ficou pronta
async function ensure(text, onReady) {
  const missing = extractUrls(text).filter((u) => cached(u) === undefined);
  if (!missing.length) return;
  await Promise.all(missing.map(fetchPreview));
  if (missing.some((u) => cached(u))) onReady();
}

module.exports = { embedsFor, ensure, extractUrls, isPrivate, fetchHtml, parseMeta, setAllowPrivate: (v) => { allowPrivate = v; } };
