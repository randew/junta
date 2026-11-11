// Cargos e permissões (por servidor), com ajustes por canal
//
// Permissão efetiva de alguém num canal:
//   1. junta as permissões do cargo @todos + cargos da pessoa naquele servidor
//   2. "Administrador" libera tudo
//   3. aplica os ajustes do canal: primeiro os do @todos, depois os dos cargos da pessoa (negar → permitir)
//   4. sem "Ver canal", não pode nada nele
// O dono do Junta sempre pode tudo.
const { db, getSetting, setSetting } = require('./db');
const { now } = require('./util');

const P = {
  VIEW: 1 << 0,            // ver canais
  SEND: 1 << 1,            // enviar mensagens
  ATTACH: 1 << 2,          // anexar arquivos
  REACT: 1 << 3,           // reagir
  MENTION_ALL: 1 << 4,     // mencionar @todos
  MANAGE_MESSAGES: 1 << 5, // apagar mensagens dos outros
  CONNECT: 1 << 6,         // entrar nas salas de voz
  SPEAK: 1 << 7,           // falar
  STREAM: 1 << 8,          // transmitir tela e câmera
  MUTE_MEMBERS: 1 << 9,    // silenciar pessoas na voz
  MOVE_MEMBERS: 1 << 10,   // desconectar pessoas da voz
  MANAGE_CHANNELS: 1 << 11,
  MANAGE_ROLES: 1 << 12,
  MANAGE_SERVER: 1 << 13,  // nome e ícone do servidor
  INVITE: 1 << 14,         // ver o código de convite
  ADMIN: 1 << 15,          // administrador: tudo neste servidor
  MANAGE_EXPRESSIONS: 1 << 16, // enviar e apagar emojis e sons do servidor
  USE_SOUNDBOARD: 1 << 17,     // tocar sons na sala de voz
};
const ALL = Object.values(P).reduce((a, b) => a | b, 0);
// o que qualquer pessoa pode fazer num servidor novo (como era antes dos cargos)
const DEFAULT_PERMS = P.VIEW | P.SEND | P.ATTACH | P.REACT | P.MENTION_ALL | P.CONNECT | P.SPEAK | P.STREAM | P.USE_SOUNDBOARD;
// o que faz sentido ajustar por canal
const CHANNEL_PERMS = P.VIEW | P.SEND | P.ATTACH | P.REACT | P.MENTION_ALL | P.MANAGE_MESSAGES | P.CONNECT | P.SPEAK | P.STREAM | P.MUTE_MEMBERS | P.MOVE_MEMBERS | P.USE_SOUNDBOARD;

db.exec(`
  CREATE TABLE IF NOT EXISTS roles (
    id         INTEGER PRIMARY KEY,
    server_id  TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    color      TEXT,
    pos        INTEGER NOT NULL,           -- maior = mais importante; @todos é 0
    perms      INTEGER NOT NULL,
    hoist      INTEGER NOT NULL DEFAULT 0, -- aparece separado na lista de membros
    is_default INTEGER NOT NULL DEFAULT 0, -- o cargo @todos
    created    INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS roles_server ON roles(server_id);
  CREATE TABLE IF NOT EXISTS member_roles (
    role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS channel_overrides (
    server_id  TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    role_id    INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    allow      INTEGER NOT NULL DEFAULT 0,
    deny       INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (server_id, channel_id, role_id)
  );
`);

// todo servidor tem o cargo @todos
function ensureDefaultRole(serverId) {
  if (!db.prepare('SELECT 1 FROM roles WHERE server_id = ? AND is_default = 1').get(serverId)) {
    db.prepare('INSERT INTO roles (server_id, name, color, pos, perms, hoist, is_default, created) VALUES (?, ?, NULL, 0, ?, 0, 1, ?)')
      .run(serverId, '@todos', DEFAULT_PERMS, now());
  }
}
for (const s of db.prepare('SELECT id FROM servers').all()) ensureDefaultRole(s.id);
// servidores de antes do soundboard: @todos passa a poder tocar sons (como num servidor novo)
if ((Number(getSetting('perms_version')) || 1) < 2) {
  db.prepare('UPDATE roles SET perms = perms | ? WHERE is_default = 1').run(P.USE_SOUNDBOARD);
  setSetting('perms_version', '2');
}

// ---------- leitura ----------
const isJuntaOwner = (uid) => db.prepare("SELECT 1 FROM users WHERE id = ? AND role = 'owner'").get(uid);
const rolesOf = (serverId) => db.prepare('SELECT * FROM roles WHERE server_id = ? ORDER BY pos DESC, id').all(serverId);
const defaultRole = (serverId) => db.prepare('SELECT * FROM roles WHERE server_id = ? AND is_default = 1').get(serverId);
const memberRoles = (uid, serverId) => db.prepare('SELECT r.* FROM roles r JOIN member_roles m ON m.role_id = r.id WHERE m.user_id = ? AND r.server_id = ?').all(uid, serverId);

function serverPerms(uid, serverId) {
  if (isJuntaOwner(uid)) return ALL;
  let p = defaultRole(serverId)?.perms ?? 0;
  for (const r of memberRoles(uid, serverId)) p |= r.perms;
  return p & P.ADMIN ? ALL : p;
}
function channelPerms(uid, serverId, channelId) {
  const base = serverPerms(uid, serverId);
  if (base & P.ADMIN) return ALL;
  let p = base;
  const ov = db.prepare('SELECT role_id, allow, deny FROM channel_overrides WHERE server_id = ? AND channel_id = ?').all(serverId, channelId);
  if (ov.length) {
    const def = defaultRole(serverId);
    const d = ov.find((o) => o.role_id === def?.id);
    if (d) p = (p & ~d.deny) | d.allow;
    const mine = new Set(memberRoles(uid, serverId).map((r) => r.id));
    let allow = 0, deny = 0;
    for (const o of ov) if (mine.has(o.role_id)) { allow |= o.allow; deny |= o.deny; }
    p = (p & ~deny) | allow;
  }
  return p & P.VIEW ? p : 0;
}
const keyPerms = (uid, key) => { const [sid, cid] = String(key).split('/'); return channelPerms(uid, sid, cid); };
const can = (uid, key, bit) => (keyPerms(uid, key) & bit) === bit;
const canServer = (uid, serverId, bit) => (serverPerms(uid, serverId) & bit) === bit;

// hierarquia: posição do cargo mais alto (dono do Junta acima de todos)
function topPos(uid, serverId) {
  if (isJuntaOwner(uid)) return Infinity;
  return Math.max(0, ...memberRoles(uid, serverId).map((r) => r.pos));
}
// pode mexer neste cargo? (só em cargos abaixo do seu mais alto)
const canTouchRole = (uid, role) => isJuntaOwner(uid) || (canServer(uid, role.server_id, P.MANAGE_ROLES) && role.pos < topPos(uid, role.server_id));
// pode mexer nesta pessoa? (o cargo mais alto dela precisa estar abaixo do seu)
const outranks = (uid, target, serverId) => uid !== target && !isJuntaOwner(target) && topPos(uid, serverId) > topPos(target, serverId);
// alguém com "Gerenciar cargos" só pode dar permissões que ele mesmo tem
const grantable = (uid, serverId) => serverPerms(uid, serverId);

// ---------- para o navegador ----------
const publicRole = (r) => ({ id: r.id, name: r.name, color: r.color, pos: r.pos, perms: r.perms, hoist: !!r.hoist, isDefault: !!r.is_default });
function rolesPayload() {
  const roles = {}, members = {};
  for (const r of db.prepare('SELECT * FROM roles ORDER BY pos DESC, id').all()) (roles[r.server_id] ||= []).push(publicRole(r));
  for (const m of db.prepare('SELECT r.server_id, m.user_id, m.role_id FROM member_roles m JOIN roles r ON r.id = m.role_id').all()) {
    ((members[m.server_id] ||= {})[m.user_id] ||= []).push(m.role_id);
  }
  return { roles, memberRoles: members };
}
function overridesFor(serverId, channelId) {
  return db.prepare('SELECT role_id, allow, deny FROM channel_overrides WHERE server_id = ? AND channel_id = ?').all(serverId, channelId)
    .map((o) => ({ roleId: o.role_id, allow: o.allow, deny: o.deny }));
}

module.exports = {
  P, ALL, DEFAULT_PERMS, CHANNEL_PERMS, ensureDefaultRole, isJuntaOwner, rolesOf, defaultRole, memberRoles,
  serverPerms, channelPerms, keyPerms, can, canServer, topPos, canTouchRole, outranks, grantable,
  publicRole, rolesPayload, overridesFor,
};
