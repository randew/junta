// Cargos: criar, editar, ordenar, apagar, dar/tirar de pessoas e ajustar permissões por canal
const { db } = require('./db');
const { now, clean, reply } = require('./util');
const { channelRow } = require('./channels');
const perms = require('./perms');
const { P } = perms;

function register(socket, ctx) {
  const { rt } = ctx;
  const me = () => socket.data.user;
  const owner = () => perms.isJuntaOwner(me().id);
  const roleRow = (id) => db.prepare('SELECT * FROM roles WHERE id = ?').get(Number(id));
  const NO = (what) => ({ error: `Você não tem permissão para ${what}.` });
  const done = (cb, extra = {}) => { rt.permsChanged(); reply(cb, { ok: true, ...extra }); };
  // só dá para ligar ou desligar permissões que você mesmo tem (o dono e administradores podem todas)
  const onlyGrantable = (serverId, oldBits, newBits) => {
    const mine = perms.grantable(me().id, serverId);
    return ((oldBits ^ newBits) & ~mine) === 0;
  };

  socket.on('role-create', ({ serverId, name } = {}, cb) => {
    serverId = String(serverId);
    if (!db.prepare('SELECT 1 FROM servers WHERE id = ?').get(serverId)) return reply(cb, { error: 'Servidor não encontrado.' });
    if (!perms.canServer(me().id, serverId, P.MANAGE_ROLES)) return reply(cb, NO('gerenciar cargos'));
    // o novo cargo entra logo acima do @todos (o mais baixo); os outros sobem uma posição
    db.prepare('UPDATE roles SET pos = pos + 1 WHERE server_id = ? AND is_default = 0').run(serverId);
    const r = db.prepare('INSERT INTO roles (server_id, name, color, pos, perms, hoist, is_default, created) VALUES (?, ?, NULL, 1, 0, 0, 0, ?)')
      .run(serverId, clean(name, 32) || 'novo cargo', now());
    done(cb, { id: Number(r.lastInsertRowid) });
  });

  socket.on('role-update', ({ id, name, color, hoist, perms: bits } = {}, cb) => {
    const r = roleRow(id);
    if (!r) return reply(cb, { error: 'Cargo não encontrado.' });
    if (!perms.canTouchRole(me().id, r)) return reply(cb, NO('mudar este cargo (ele está acima do seu)'));
    const upd = {};
    if (name !== undefined && !r.is_default) { const n = clean(name, 32); if (!n) return reply(cb, { error: 'O cargo precisa de um nome.' }); upd.name = n; }
    if (color !== undefined && !r.is_default) upd.color = /^#[0-9a-f]{6}$/i.test(color || '') ? color.toLowerCase() : null;
    if (hoist !== undefined && !r.is_default) upd.hoist = hoist ? 1 : 0;
    if (bits !== undefined) {
      const b = Number(bits) & perms.ALL;
      if (!onlyGrantable(r.server_id, r.perms, b)) return reply(cb, { error: 'Você só pode ligar ou desligar permissões que você mesmo tem.' });
      upd.perms = b;
    }
    const cols = Object.keys(upd);
    if (cols.length) db.prepare(`UPDATE roles SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...cols.map((c) => upd[c]), r.id);
    done(cb);
  });

  socket.on('role-delete', ({ id } = {}, cb) => {
    const r = roleRow(id);
    if (!r) return reply(cb, { error: 'Cargo não encontrado.' });
    if (r.is_default) return reply(cb, { error: 'O cargo @todos não pode ser apagado.' });
    if (!perms.canTouchRole(me().id, r)) return reply(cb, NO('apagar este cargo (ele está acima do seu)'));
    db.prepare('DELETE FROM roles WHERE id = ?').run(r.id); // pessoas e ajustes de canal saem junto
    done(cb);
  });

  // nova ordem dos cargos (do mais importante para o menos), sem o @todos
  socket.on('role-reorder', ({ serverId, order } = {}, cb) => {
    serverId = String(serverId);
    if (!perms.canServer(me().id, serverId, P.MANAGE_ROLES)) return reply(cb, NO('gerenciar cargos'));
    const cur = db.prepare('SELECT id, pos FROM roles WHERE server_id = ? AND is_default = 0 ORDER BY pos DESC, id').all(serverId);
    const ids = cur.map((r) => r.id);
    const want = Array.isArray(order) ? order.map(Number) : [];
    if (want.length !== ids.length || !ids.every((x) => want.includes(x))) return reply(cb, { error: 'A lista de cargos mudou. Tente de novo.' });
    if (!owner()) {
      // quem não é dono não mexe nos cargos do seu nível para cima: eles ficam onde estão, no topo
      const top = perms.topPos(me().id, serverId);
      const locked = cur.filter((r) => r.pos >= top).length;
      if (want.slice(0, locked).join() !== ids.slice(0, locked).join()) return reply(cb, NO('mover cargos acima do seu'));
    }
    const upd = db.prepare('UPDATE roles SET pos = ? WHERE id = ?');
    want.forEach((rid, k) => upd.run(want.length - k, rid));
    done(cb);
  });

  // dar ou tirar um cargo de alguém
  socket.on('member-role', ({ userId, roleId, add } = {}, cb) => {
    const r = roleRow(roleId); const uid = Number(userId);
    if (!r || r.is_default) return reply(cb, { error: 'Cargo não encontrado.' });
    if (!db.prepare('SELECT 1 FROM users WHERE id = ? AND disabled = 0').get(uid)) return reply(cb, { error: 'Conta não encontrada.' });
    if (!perms.canTouchRole(me().id, r)) return reply(cb, NO('dar este cargo (ele está acima do seu)'));
    if (uid !== me().id && !owner() && !perms.outranks(me().id, uid, r.server_id)) return reply(cb, NO('mudar os cargos dessa pessoa'));
    if (add) db.prepare('INSERT OR IGNORE INTO member_roles (role_id, user_id) VALUES (?, ?)').run(r.id, uid);
    else db.prepare('DELETE FROM member_roles WHERE role_id = ? AND user_id = ?').run(r.id, uid);
    done(cb);
  });

  // ---------- permissões por canal ----------
  const canEditChannel = (ch) => perms.canServer(me().id, ch.server_id, P.MANAGE_CHANNELS) && perms.canServer(me().id, ch.server_id, P.MANAGE_ROLES);
  socket.on('channel-perms-get', ({ key } = {}, cb) => {
    const ch = channelRow(key);
    if (!ch) return reply(cb, { error: 'Canal não encontrado.' });
    if (!canEditChannel(ch)) return reply(cb, NO('ver as permissões deste canal'));
    reply(cb, { overrides: perms.overridesFor(ch.server_id, ch.id) });
  });
  socket.on('channel-perms', ({ key, roleId, allow, deny } = {}, cb) => {
    const ch = channelRow(key); const r = roleRow(roleId);
    if (!ch || !r || r.server_id !== ch.server_id) return reply(cb, { error: 'Canal ou cargo não encontrado.' });
    if (!canEditChannel(ch)) return reply(cb, NO('mudar as permissões deste canal'));
    if (!r.is_default && !perms.canTouchRole(me().id, r)) return reply(cb, NO('mudar as permissões deste cargo (ele está acima do seu)'));
    const a = Number(allow) & perms.CHANNEL_PERMS, d = Number(deny) & perms.CHANNEL_PERMS & ~a;
    const old = db.prepare('SELECT allow, deny FROM channel_overrides WHERE server_id = ? AND channel_id = ? AND role_id = ?').get(ch.server_id, ch.id, r.id) || { allow: 0, deny: 0 };
    const changedBits = (old.allow ^ a) | (old.deny ^ d);
    if (changedBits & ~perms.grantable(me().id, ch.server_id)) return reply(cb, { error: 'Você só pode ajustar permissões que você mesmo tem.' });
    if (!a && !d) db.prepare('DELETE FROM channel_overrides WHERE server_id = ? AND channel_id = ? AND role_id = ?').run(ch.server_id, ch.id, r.id);
    else db.prepare('INSERT INTO channel_overrides (server_id, channel_id, role_id, allow, deny) VALUES (?, ?, ?, ?, ?) ON CONFLICT(server_id, channel_id, role_id) DO UPDATE SET allow = excluded.allow, deny = excluded.deny')
      .run(ch.server_id, ch.id, r.id, a, d);
    done(cb);
  });
}

module.exports = { register };
