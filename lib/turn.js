// Servidores de conexão da voz (ICE): STUN sempre, e TURN quando configurado.
//
// TURN é o plano B para quem não consegue conexão direta (4G, rede de empresa): um servidor
// repassa o áudio e o vídeo dessa pessoa. O navegador tenta direto primeiro e só usa o TURN
// se precisar.
//
// Configuração em dados/turn.json (criado pelo configurar-turn), ou por variáveis de ambiente:
//   Cloudflare:  { "keyId": "...", "token": "..." }            ou JUNTA_TURN_KEY_ID / JUNTA_TURN_TOKEN
//   Próprio (ex.: coturn numa VPS):
//                { "iceServers": [{ "urls": [...], "username": "...", "credential": "..." }] }
// As chaves ficam só no servidor: o navegador recebe credenciais temporárias.
const fs = require('fs');
const path = require('path');

const STUN_ONLY = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
const cfApi = () => process.env.JUNTA_TURN_API || 'https://rtc.live.cloudflare.com/v1/turn/keys'; // trocável só nos testes
const TTL = 86400;                 // credenciais valem 24 h
const REFRESH_MS = 12 * 3600_000;  // e são renovadas na metade do prazo
const RETRY_MS = 5 * 60_000;       // falhou? tenta de novo daqui a 5 min (enquanto isso, só STUN)

const configFile = (dataDir) => path.join(dataDir, 'turn.json');

function readConfig(dataDir) {
  if (process.env.JUNTA_TURN_KEY_ID && process.env.JUNTA_TURN_TOKEN) {
    return { keyId: process.env.JUNTA_TURN_KEY_ID, token: process.env.JUNTA_TURN_TOKEN };
  }
  try { return JSON.parse(fs.readFileSync(configFile(dataDir), 'utf8')); } catch { return null; }
}

// pede credenciais temporárias à Cloudflare
async function cloudflareIce({ keyId, token }) {
  const r = await fetch(`${cfApi()}/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttl: TTL }),
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) {
    const why = r.status === 401 || r.status === 403 ? 'chave ou token recusados' : r.status === 404 ? 'chave não encontrada' : `HTTP ${r.status}`;
    throw new Error(why);
  }
  const d = await r.json();
  if (!Array.isArray(d.iceServers)) throw new Error('resposta inesperada');
  // a porta 53 é bloqueada pelos navegadores e só faria a conexão demorar
  return d.iceServers.map((s) => {
    const urls = (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => !/:53(\?|$)/.test(u));
    return { ...s, urls };
  }).filter((s) => s.urls.length);
}

const hasTurn = (servers) => servers.some((s) => [].concat(s.urls).some((u) => /^turns?:/.test(u)));

function createTurn(dataDir, log = console.log) {
  let cache = null;   // { iceServers, turn, until }
  let pending = null;
  let lastError = null;
  let mtime = 0;

  async function load() {
    const cfg = readConfig(dataDir);
    let st = 0; try { st = fs.statSync(configFile(dataDir)).mtimeMs; } catch {}
    mtime = st;
    if (!cfg) { lastError = null; return { iceServers: STUN_ONLY, turn: false, until: Date.now() + 60_000 }; }
    try {
      let servers;
      if (cfg.keyId && cfg.token) servers = await cloudflareIce(cfg);
      else if (Array.isArray(cfg.iceServers)) servers = cfg.iceServers;
      else throw new Error('turn.json sem keyId/token nem iceServers');
      if (lastError) log('TURN de volta ao normal.');
      lastError = null;
      return { iceServers: servers, turn: hasTurn(servers), until: Date.now() + REFRESH_MS };
    } catch (e) {
      if (lastError !== e.message) log(`TURN indisponível (${e.message}). A voz segue só com conexão direta; nova tentativa em 5 min.`);
      lastError = e.message;
      return { iceServers: STUN_ONLY, turn: false, until: Date.now() + RETRY_MS };
    }
  }

  // servidores atuais; renova quando vence ou quando o turn.json muda
  async function get() {
    let st = 0; try { st = fs.statSync(configFile(dataDir)).mtimeMs; } catch {}
    if (cache && Date.now() < cache.until && st === mtime) return cache;
    pending ||= load().then((c) => { cache = c; return c; }).finally(() => { pending = null; });
    return pending;
  }

  return { get, status: () => ({ configured: !!readConfig(dataDir), error: lastError }) };
}

module.exports = { createTurn, cloudflareIce, configFile, STUN_ONLY };
