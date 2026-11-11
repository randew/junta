// Utilidades usadas por vários módulos do servidor
const crypto = require('crypto');

const now = () => Date.now();
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const clean = (s, n) => String(s ?? '').trim().slice(0, n);
const slug = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || crypto.randomBytes(3).toString('hex');
const parseCookies = (h = '') => Object.fromEntries(h.split(';').map((p) => p.trim().split('=')).filter((p) => p[0])
  .map(([k, ...v]) => { try { return [k, decodeURIComponent(v.join('='))]; } catch { return [k, '']; } }));
// responde a um evento do socket só se o cliente pediu resposta
const reply = (cb, v) => { if (typeof cb === 'function') cb(v); };
const placeholders = (arr) => arr.map(() => '?').join(',');

module.exports = { now, sha, clean, slug, parseCookies, reply, placeholders };
