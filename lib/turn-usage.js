// Consumo do TURN da Cloudflare, para o painel de administração.
// A Cloudflare só mostra esses números pela API de estatísticas (GraphQL), com um token
// próprio (permissão "Account Analytics: Read") e o ID da conta, guardados em
// dados/cloudflare.json pelo configurar-turn.
const fs = require('fs');
const path = require('path');

const GQL = () => process.env.JUNTA_CF_GRAPHQL || 'https://api.cloudflare.com/client/v4/graphql'; // trocável só nos testes
const FREE_GB = 1000;          // por mês, grátis na Cloudflare
const CACHE_MS = 5 * 60_000;   // a Cloudflare atualiza em blocos de 5 minutos

const statsFile = (dataDir) => path.join(dataDir, 'cloudflare.json');
function readStatsConfig(dataDir) {
  try { const c = JSON.parse(fs.readFileSync(statsFile(dataDir), 'utf8')); return c.accountId && c.token ? c : null; } catch { return null; }
}

const QUERY = `query turnUsage($account: string!, $from: Date!, $to: Date!) {
  viewer {
    accounts(filter: { accountTag: $account }) {
      callsTurnUsageAdaptiveGroups(limit: 10000, filter: { date_geq: $from, date_leq: $to }) {
        dimensions { datetimeFiveMinutes }
        avg { concurrentConnectionsFiveMinutes }
        sum { egressBytes ingressBytes }
      }
    }
  }
}`;

async function queryRange({ accountId, token }, from, to) {
  const r = await fetch(GQL(), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: QUERY, variables: { account: accountId, from, to } }),
    signal: AbortSignal.timeout(10000),
  });
  if (r.status === 401 || r.status === 403) throw new Error('token recusado (precisa da permissão Account Analytics: Read)');
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const d = await r.json();
  if (d.errors?.length) {
    const msg = d.errors.map((e) => e.message).join('; ');
    throw new Error(/auth|permission|not authorized/i.test(msg) ? 'token sem permissão para esta conta (Account Analytics: Read)' : msg);
  }
  const acc = d.data?.viewer?.accounts;
  if (!acc?.length) throw new Error('conta não encontrada (confira o Account ID)');
  return acc[0].callsTurnUsageAdaptiveGroups || [];
}

const day = (d) => d.toISOString().slice(0, 10);

// mês atual (UTC, como a cobrança) + últimos 7 dias + quantas conexões agora
async function fetchUsage(cfg, nowMs = Date.now()) {
  const now = new Date(nowMs);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const weekStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 6));
  // até 31 dias de blocos de 5 min cabem no limite de 10.000 linhas; a parte da semana anterior ao mês vai separada
  let rows = await queryRange(cfg, day(monthStart), day(now));
  if (weekStart < monthStart) rows = rows.concat(await queryRange(cfg, day(weekStart), day(new Date(monthStart - 864e5))));

  const month = { egress: 0, ingress: 0 };
  const days = new Map();
  for (let i = 0; i < 7; i++) days.set(day(new Date(weekStart.getTime() + i * 864e5)), 0);
  let lastT = 0, lastConn = 0;
  for (const r of rows) {
    const t = Date.parse(r.dimensions.datetimeFiveMinutes);
    const eg = Number(r.sum?.egressBytes) || 0, ing = Number(r.sum?.ingressBytes) || 0;
    if (t >= monthStart.getTime()) { month.egress += eg; month.ingress += ing; }
    const k = day(new Date(t));
    if (days.has(k)) days.set(k, days.get(k) + eg);
    if (t > lastT) { lastT = t; lastConn = Number(r.avg?.concurrentConnectionsFiveMinutes) || 0; }
  }
  // "agora": o bloco mais recente, se for dos últimos 15 minutos
  const current = nowMs - lastT <= 15 * 60_000 ? Math.round(lastConn * 10) / 10 : 0;
  return {
    month: { ...month, freeBytes: FREE_GB * 1e9, label: now.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' }) },
    days: [...days].map(([date, egress]) => ({ date, egress })),
    current,
    updated: nowMs,
  };
}

function createTurnUsage(dataDir) {
  let cache = null, pending = null;
  async function get(force) {
    const cfg = readStatsConfig(dataDir);
    if (!cfg) return { configured: false };
    if (!force && cache && Date.now() - cache.at < CACHE_MS && cache.key === cfg.accountId + cfg.token) return cache.value;
    pending ||= fetchUsage(cfg)
      .then((u) => ({ configured: true, ...u }))
      .catch((e) => ({ configured: true, error: e.message }))
      .then((value) => { cache = { at: Date.now(), key: cfg.accountId + cfg.token, value }; return value; })
      .finally(() => { pending = null; });
    return pending;
  }
  return { get };
}

module.exports = { createTurnUsage, fetchUsage, queryRange, statsFile, FREE_GB };
