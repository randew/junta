// Servidores, canais e mensagens diretas: quem pode ver o quê
const { db } = require('./db');
const perms = require('./perms');

// Conversa direta entre duas contas: "dm/<menor id>-<maior id>"
const isDm = (key) => /^dm\/\d+-\d+$/.test(String(key));
const dmKey = (a, b) => `dm/${Math.min(a, b)}-${Math.max(a, b)}`;
const dmPair = (key) => String(key).slice(3).split('-').map(Number);
const dmOther = (key, me) => { const [a, b] = dmPair(key); return a === me ? b : a; };

// Servidores e os canais que esta pessoa pode ver, com as permissões dela em cada um
function serverList(userId) {
  const servers = db.prepare('SELECT id, name, icon FROM servers ORDER BY pos, rowid').all();
  const chans = db.prepare('SELECT server_id, id, name, type FROM channels ORDER BY pos, rowid').all();
  return servers.map((s) => {
    const def = perms.defaultRole(s.id);
    const channels = [];
    for (const c of chans) {
      if (c.server_id !== s.id) continue;
      const p = perms.channelPerms(userId, s.id, c.id);
      if (!(p & perms.P.VIEW)) continue;
      // canal privado: o @todos não vê
      const ov = def && db.prepare('SELECT deny FROM channel_overrides WHERE server_id = ? AND channel_id = ? AND role_id = ?').get(s.id, c.id, def.id);
      channels.push({ id: c.id, name: c.name, type: c.type, perms: p, private: !!(ov && ov.deny & perms.P.VIEW) });
    }
    return { ...s, perms: perms.serverPerms(userId, s.id), channels };
  });
}

function channelRow(key) {
  const [sid, cid] = String(key).split('/');
  return db.prepare('SELECT * FROM channels WHERE server_id = ? AND id = ?').get(sid ?? '', cid ?? '');
}

// Pode ler e escrever neste canal de texto?
function canUseText(userId, key) {
  if (isDm(key)) {
    const [a, b] = dmPair(key);
    if (a === b || (userId !== a && userId !== b)) return false;
    const other = userId === a ? b : a;
    return !!db.prepare('SELECT 1 FROM users WHERE id = ?').get(other);
  }
  return channelRow(key)?.type === 'text' && perms.can(userId, key, perms.P.VIEW);
}

// Minhas conversas diretas, da mais recente para a mais antiga
function dmList(userId) {
  const rows = db.prepare(`
    SELECT chan, MAX(ts) AS last FROM messages
    WHERE chan LIKE 'dm/' || ? || '-%' OR chan LIKE 'dm/%-' || ?
    GROUP BY chan ORDER BY last DESC`).all(String(userId), String(userId)); // texto: número viraria "2.0" no padrão
  return rows.filter((r) => isDm(r.chan) && dmPair(r.chan).includes(userId))
    .map((r) => ({ key: r.chan, other: dmOther(r.chan, userId), last: r.last }));
}

module.exports = { isDm, dmKey, dmPair, dmOther, serverList, channelRow, canUseText, dmList };
