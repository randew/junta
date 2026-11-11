// GIFs: busca pelo KLIPY ou GIPHY (as duas têm uma API compatível com a do antigo Tenor)
// e GIFs favoritos de cada pessoa. A chave fica no servidor; o dono configura em
// Administração → GIFs. As buscas passam pelo Junta, então a chave nunca chega ao navegador.
const { db, getSetting, setSetting } = require('./db');
const { now, clean } = require('./util');

const PROVIDERS = {
  klipy: { name: 'KLIPY', base: 'https://api.klipy.com/v2' },
  giphy: { name: 'GIPHY', base: 'https://api.giphy.com/v2' },
};
const base = (p) => process.env.JUNTA_GIF_API || PROVIDERS[p].base; // trocável só nos testes
const config = () => {
  const provider = PROVIDERS[getSetting('gif_provider')] ? getSetting('gif_provider') : 'klipy';
  return { provider, key: getSetting('gif_key') || '' };
};

// formato comum: { id, url (o GIF que vai na mensagem), preview (miniatura), w, h }
function pick(mf, names) { for (const n of names) if (mf?.[n]?.url) return mf[n]; return null; }
function normalize(data) {
  const items = (data.results || []).filter((r) => r && r.type !== 'ad').map((r) => {
    const full = pick(r.media_formats, ['gif', 'mediumgif', 'tinygif']);
    const small = pick(r.media_formats, ['tinygif', 'nanogif', 'mediumgif', 'gif']);
    if (!full) return null;
    const [w, h] = full.dims || small?.dims || [0, 0];
    return { id: String(r.id), url: full.url, preview: small?.url || full.url, w, h, title: r.content_description || r.title || '' };
  }).filter((x) => x && /^https:\/\//.test(x.url) && /^https:\/\//.test(x.preview));
  return { items, next: data.next ? String(data.next) : null };
}

async function query(path, params, cfg = config()) {
  if (!cfg.key) { const e = new Error('GIFs não configurados'); e.code = 'nokey'; throw e; }
  const u = new URL(base(cfg.provider) + path);
  for (const [k, v] of Object.entries({ key: cfg.key, client_key: 'junta', limit: 24, locale: 'pt_BR', country: 'BR', contentfilter: 'medium', rating: 'pg-13', ...params })) {
    if (v != null && v !== '') u.searchParams.set(k, v);
  }
  const r = await fetch(u, { signal: AbortSignal.timeout(8000) });
  if (r.status === 401 || r.status === 403) throw new Error('chave recusada');
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return normalize(await r.json());
}

const cache = new Map(); // buscas iguais em 10 minutos não vão de novo ao serviço
async function cached(path, params) {
  const k = path + JSON.stringify(params) + config().provider;
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.data;
  const data = await query(path, params);
  cache.set(k, { at: Date.now(), data });
  if (cache.size > 300) cache.delete(cache.keys().next().value);
  return data;
}

function routes(app) {
  const { auth, ownerOnly } = require('./accounts');
  const fail = (res, e) => res.status(e.code === 'nokey' ? 200 : 502).json(e.code === 'nokey'
    ? { configured: false, items: [], next: null }
    : { error: `O serviço de GIFs não respondeu (${e.message}). Tente de novo.` });

  app.get('/api/gifs/search', auth, async (req, res) => {
    const q = clean(req.query.q, 80);
    const pos = clean(req.query.pos, 64) || undefined;
    try {
      const d = q ? await cached('/search', { q, pos }) : await cached('/featured', { pos });
      res.json({ configured: true, provider: PROVIDERS[config().provider].name, ...d });
    } catch (e) { fail(res, e); }
  });

  // favoritos (de cada pessoa)
  app.get('/api/gifs/favorites', auth, (req, res) => {
    res.json({ items: db.prepare('SELECT url, preview, w, h FROM gif_favorites WHERE user_id = ? ORDER BY created DESC LIMIT 200').all(req.user.id) });
  });
  app.post('/api/gifs/favorites', auth, (req, res) => {
    const url = String(req.body?.url || '');
    if (!/^https:\/\/\S{1,500}$/.test(url)) return res.status(400).json({ error: 'Endereço inválido.' });
    if (req.body?.on === false) db.prepare('DELETE FROM gif_favorites WHERE user_id = ? AND url = ?').run(req.user.id, url);
    else {
      if (db.prepare('SELECT COUNT(*) n FROM gif_favorites WHERE user_id = ?').get(req.user.id).n >= 200) return res.status(400).json({ error: 'Você já tem 200 GIFs favoritos. Tire algum antes.' });
      const preview = /^https:\/\/\S{1,500}$/.test(String(req.body?.preview || '')) ? req.body.preview : url;
      db.prepare('INSERT OR IGNORE INTO gif_favorites (user_id, url, preview, w, h, created) VALUES (?, ?, ?, ?, ?, ?)')
        .run(req.user.id, url, preview, Number(req.body?.w) || null, Number(req.body?.h) || null, now());
    }
    res.json({ ok: true });
  });

  // configuração (dono)
  app.get('/api/admin/gifs', auth, ownerOnly, (req, res) => {
    const c = config();
    res.json({ provider: c.provider, configured: !!c.key, providers: Object.entries(PROVIDERS).map(([id, p]) => ({ id, name: p.name })) });
  });
  app.post('/api/admin/gifs', auth, ownerOnly, async (req, res) => {
    const provider = PROVIDERS[req.body?.provider] ? req.body.provider : 'klipy';
    if (req.body?.remove) { setSetting('gif_key', ''); cache.clear(); return res.json({ ok: true }); }
    const key = String(req.body?.key || '').trim();
    if (!/^[\w.-]{8,200}$/.test(key)) return res.status(400).json({ error: 'Cole a chave (API key) completa.' });
    try { await query('/search', { q: 'oi', limit: 1 }, { provider, key }); }
    catch (e) { return res.status(400).json({ error: `O ${PROVIDERS[provider].name} recusou a chave (${e.message}).` }); }
    setSetting('gif_provider', provider); setSetting('gif_key', key); cache.clear();
    res.json({ ok: true });
  });
}

module.exports = { routes, normalize, query, PROVIDERS };
