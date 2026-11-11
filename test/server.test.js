// Testes do servidor: rode com  npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const { boot, person, sleep } = require('./helpers');
const previews = require('../lib/previews');

let app, andre, bia, caio;
const GERAL = 'geral/bate-papo';

test.before(async () => {
  app = await boot();
  andre = await person(app, 'andre'); // primeira conta: dono
  bia = await person(app, 'bia');
  caio = await person(app, 'caio');
});
test.after(async () => { for (const p of [andre, bia, caio]) p?.close(); await app.stop(); });

test('contas: convite, dono e login', async () => {
  assert.equal(andre.hello.user.role, 'owner');
  assert.equal(bia.hello.user.role, 'member');
  const bad = await fetch(`${app.base}/api/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'intruso', password: 'segredo123', invite: 'AAAA-BBBB' }) });
  assert.equal(bad.status, 403);
  const wrong = await fetch(`${app.base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'bia', password: 'errada' }) });
  assert.equal(wrong.status, 401);
  assert.equal((await fetch(`${app.base}/api/me`)).status, 401);
});

test('só o dono cria canais', async () => {
  assert.match((await bia.emit('create-channel', { serverId: 'geral', name: 'x', type: 'text' })).error, /permissão/);
  const r = await andre.emit('create-channel', { serverId: 'geral', name: 'Avisos', type: 'text' });
  assert.equal(r.ok, true);
});

test('mensagem, menção, não lidas e leitura', async () => {
  await bia.emit('join-text', GERAL);
  await caio.emit('join-text', 'geral/links'); // Caio está em outro canal
  const sent = await andre.emit('message', { key: GERAL, text: 'Oi @bia, tudo bem?' });
  assert.equal(sent.ok, true);
  const act = await caio.waitFor('activity', (a) => a.key === GERAL);
  assert.deepEqual(act.mentions, [bia.id]);
  const unread = await caio.emit('hello', {});
  assert.equal(unread.unread[GERAL].n, 1);
  assert.equal(unread.unread[GERAL].m, 0);
  const biaU = (await bia.emit('hello', {})).unread[GERAL];
  assert.equal(biaU.m, 1, 'a Bia foi mencionada');
  const page = await bia.emit('join-text', GERAL);
  await bia.emit('read', { key: GERAL, seq: page.messages.at(-1).seq });
  await sleep(50);
  assert.equal((await bia.emit('hello', {})).unread[GERAL], undefined);
});

test('responder, reagir e editar', async () => {
  const page = await bia.emit('join-text', GERAL);
  const orig = page.messages.at(-1);
  const r = await bia.emit('message', { key: GERAL, text: 'Tudo ótimo!', replyTo: orig.id });
  const reply = (await bia.emit('join-text', GERAL)).messages.find((m) => m.id === r.id);
  assert.equal(reply.reply.id, orig.id);
  assert.equal(reply.reply.uid, andre.id);
  // responder menciona o autor da mensagem respondida
  assert.equal((await andre.emit('hello', {})).unread[GERAL].m, 1);

  assert.equal((await caio.emit('react', { id: orig.id, emoji: '👍' })).ok, true);
  assert.equal((await bia.emit('react', { id: orig.id, emoji: '👍' })).ok, true);
  assert.match((await bia.emit('react', { id: orig.id, emoji: '<script>' })).error, /inválida/);
  let m = (await bia.emit('join-text', GERAL)).messages.find((x) => x.id === orig.id);
  assert.deepEqual(m.reactions, [{ e: '👍', users: [caio.id, bia.id] }]);
  await caio.emit('react', { id: orig.id, emoji: '👍' }); // clicar de novo tira a reação
  m = (await bia.emit('join-text', GERAL)).messages.find((x) => x.id === orig.id);
  assert.deepEqual(m.reactions[0].users, [bia.id]);

  assert.match((await bia.emit('message-edit', { id: orig.id, text: 'hackeado' })).error, /suas mensagens/);
  assert.equal((await andre.emit('message-edit', { id: orig.id, text: 'Oi @bia, tudo bem? (editado)' })).ok, true);
});

test('mensagens diretas são privadas', async () => {
  const dm = `dm/${Math.min(andre.id, bia.id)}-${Math.max(andre.id, bia.id)}`;
  const fd = new FormData(); fd.append('files', new Blob(['segredo']), 'segredo.txt');
  const up = await andre.api('POST', '/api/upload', fd);
  const sent = await andre.emit('message', { key: dm, text: 'Só entre nós', att: [up.data.files[0].id] });
  assert.equal(sent.ok, true);
  const act = await bia.waitFor('activity', (a) => a.key === dm);
  assert.equal(act.preview, 'Só entre nós');
  await sleep(100);
  assert.ok(!caio.events.some((e) => e.ev === 'activity' && e.data.key === dm), 'o Caio não fica sabendo da DM');
  assert.match((await caio.emit('join-text', dm)).error, /acesso/);
  assert.match((await caio.emit('message', { key: dm, text: 'oi' })).error, /acesso/);
  const fileUrl = `/anexos/${up.data.files[0].id}/segredo.txt`;
  assert.equal((await bia.api('GET', fileUrl)).status, 200);
  assert.equal((await caio.api('GET', fileUrl)).status, 404);
  const list = await bia.emit('dm-list', {});
  assert.equal(list[0].key, dm);
  assert.equal(list[0].other, andre.id);
  // o dono não apaga mensagens de DMs dos outros
  const biaMsg = await bia.emit('message', { key: dm, text: 'resposta' });
  assert.ok(biaMsg.ok);
  assert.match((await andre.emit('message-delete', biaMsg.id)).error, /não pode/);
});

test('busca ignora acentos e respeita o acesso', async () => {
  await bia.emit('message', { key: 'geral/links', text: 'A reunião de amanhã será às 10h' });
  const r = await caio.emit('search', { q: 'reuniao', scope: 'geral' });
  assert.equal(r.results.length, 1);
  assert.equal(r.results[0].key, 'geral/links');
  const byUser = await caio.emit('search', { q: 'de:bia', scope: 'geral' });
  assert.ok(byUser.results.length >= 2 && byUser.results.every((x) => x.msg.uid === bia.id));
  assert.equal((await caio.emit('search', { q: 'nós', scope: 'dm' })).results.length, 0, 'não acha DM dos outros');
  assert.equal((await bia.emit('search', { q: 'nós', scope: 'dm' })).results.length, 1);
  // pular até o resultado
  const j = await caio.emit('jump', { key: 'geral/links', seq: r.results[0].msg.seq });
  assert.ok(j.messages.some((m) => m.seq === r.results[0].msg.seq));
});

test('administração: redefinir senha, remover e restaurar conta', async () => {
  assert.equal((await bia.api('GET', '/api/admin/users')).status, 403);
  const reset = await andre.api('POST', `/api/admin/users/${caio.id}/reset`);
  assert.equal(reset.status, 200);
  await caio.waitFor('session-ended');
  const relogin = await person(app, 'caio', { register: false, password: reset.data.password });
  assert.equal(relogin.id, caio.id);
  // trocar a própria senha
  assert.equal((await relogin.api('POST', '/api/password', { current: 'errada', next: 'novasenha1' })).status, 403);
  assert.equal((await relogin.api('POST', '/api/password', { current: reset.data.password, next: 'novasenha1' })).status, 200);
  relogin.close();

  assert.equal((await andre.api('POST', `/api/admin/users/${andre.id}/remove`)).status, 400, 'o dono não se remove');
  assert.equal((await andre.api('POST', `/api/admin/users/${caio.id}/remove`)).status, 200);
  const blocked = await fetch(`${app.base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'caio', password: 'novasenha1' }) });
  assert.equal(blocked.status, 401);
  const users = (await bia.emit('hello', {})).users;
  assert.equal(users.find((u) => u.id === caio.id).disabled, true);
  assert.equal((await andre.api('POST', `/api/admin/users/${caio.id}/restore`)).status, 200);
  caio = await person(app, 'caio', { register: false, password: 'novasenha1' });
});

test('backup automático guarda o banco e os arquivos', async () => {
  const r = await andre.api('POST', '/api/admin/backups');
  assert.equal(r.status, 200);
  const list = await andre.api('GET', '/api/admin/backups');
  assert.equal(list.data.backups[0].name, r.data.name);
  assert.ok(fs.existsSync(`${list.data.dir}/arquivos/anexos`));
});

test('prévia de links: bloqueia a rede interna e lê páginas públicas', async () => {
  // endereço interno: recusado mesmo que o link pareça normal
  await assert.rejects(previews.fetchHtml('http://127.0.0.1/'), /interno/);
  await assert.rejects(previews.fetchHtml('http://localhost:8080/'), /interno/);
  await assert.rejects(previews.fetchHtml('http://exemplo.com:22/'), /porta/);
  await assert.rejects(previews.fetchHtml('http://192.168.0.1/'), /interno/);
  await assert.rejects(previews.fetchHtml('file:///etc/passwd'), /protocolo/);
  assert.ok(previews.isPrivate('10.0.0.5') && previews.isPrivate('::1') && previews.isPrivate('::ffff:127.0.0.1') && !previews.isPrivate('8.8.8.8'));
  // uma página de teste local (liberada só para este teste)
  const page = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<html><head><meta property="og:title" content="Página &amp; Teste"><meta property="og:description" content="Descrição"><meta property="og:image" content="/img.png"></head></html>');
  }).listen(0);
  const url = `http://127.0.0.1:${page.address().port}/artigo`;
  previews.setAllowPrivate(true);
  try {
    const sent = await bia.emit('message', { key: GERAL, text: `olha isso ${url} e \`${url}/codigo\`` });
    const upd = await bia.waitFor('message-update', (u) => u.msg.id === sent.id && u.msg.embeds.length);
    assert.equal(upd.msg.embeds.length, 1, 'link dentro de `código` não gera prévia');
    assert.equal(upd.msg.embeds[0].title, 'Página & Teste');
    assert.equal(upd.msg.embeds[0].image, `http://127.0.0.1:${page.address().port}/img.png`);
  } finally { previews.setAllowPrivate(false); page.close(); }
});

test('gerenciar servidores e canais (só o dono)', async () => {
  // criar
  const made = await andre.emit('create-server', 'Jogos');
  assert.equal(made.ok, true);
  assert.match((await bia.emit('server-update', { id: made.id, name: 'x' })).error, /permissão/);
  // renomear
  assert.equal((await andre.emit('server-update', { id: made.id, name: 'Jogatina' })).ok, true);
  let list = (await bia.emit('hello', {})).servers;
  assert.equal(list.find((s) => s.id === made.id).name, 'Jogatina');
  // reordenar: o novo sobe uma posição
  const before = list.map((s) => s.id);
  await andre.emit('server-move', { id: made.id, dir: -1 });
  list = (await bia.emit('hello', {})).servers.map((s) => s.id);
  assert.equal(list.indexOf(made.id), before.indexOf(made.id) - 1);
  // canais: renomear e reordenar
  const key = `${made.id}/geral`;
  assert.equal((await andre.emit('channel-update', { key, name: 'Papo Geral' })).ok, true);
  await andre.emit('create-channel', { serverId: made.id, name: 'Clips', type: 'text' });
  await andre.emit('channel-move', { key: `${made.id}/clips`, dir: -1 });
  const chans = (await bia.emit('hello', {})).servers.find((s) => s.id === made.id).channels;
  assert.deepEqual(chans.filter((c) => c.type === 'text').map((c) => c.name), ['clips', 'papo-geral']);
  // ícone: só imagem de verdade, só o dono
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
  const fd = () => { const f = new FormData(); f.append('icon', new Blob([png]), 'i.png'); return f; };
  assert.equal((await bia.api('POST', `/api/servers/${made.id}/icon`, fd())).status, 403);
  const fake = new FormData(); fake.append('icon', new Blob(['<svg/>']), 'i.png');
  assert.equal((await andre.api('POST', `/api/servers/${made.id}/icon`, fake)).status, 400);
  const up = await andre.api('POST', `/api/servers/${made.id}/icon`, fd());
  assert.equal(up.status, 200);
  assert.equal((await bia.emit('hello', {})).servers.find((s) => s.id === made.id).icon, up.data.icon);
  // excluir: confirmação errada, depois certa; mensagens somem
  await bia.emit('message', { key, text: 'vai sumir' });
  assert.match((await andre.emit('server-delete', { id: made.id, confirm: 'Jogos' })).error, /Digite o nome/);
  assert.equal((await andre.emit('server-delete', { id: made.id, confirm: 'jogatina' })).ok, true);
  assert.ok(!(await bia.emit('hello', {})).servers.some((s) => s.id === made.id));
  assert.equal((await bia.emit('search', { q: 'sumir', scope: made.id })).results.length, 0);
  assert.match((await bia.emit('join-text', key)).error, /acesso/);
});

test('reordenar arrastando: ordem completa, só o dono, só itens válidos', async () => {
  await andre.emit('create-server', 'Extra');
  const ids = (await andre.emit('hello', {})).servers.map((s) => s.id);
  const rev = [...ids].reverse();
  assert.match((await bia.emit('server-reorder', { order: rev })).error, /dono/);
  assert.match((await andre.emit('server-reorder', { order: rev.slice(1) })).error, /mudou/, 'faltando um servidor');
  assert.match((await andre.emit('server-reorder', { order: [...rev.slice(1), 'inventado'] })).error, /mudou/);
  assert.equal((await andre.emit('server-reorder', { order: rev })).ok, true);
  assert.deepEqual((await bia.emit('hello', {})).servers.map((s) => s.id), rev);
  const text = (await bia.emit('hello', {})).servers.find((s) => s.id === 'geral').channels.filter((c) => c.type === 'text').map((c) => c.id);
  const newOrder = [...text].reverse();
  assert.equal((await andre.emit('channel-reorder', { serverId: 'geral', type: 'text', order: newOrder })).ok, true);
  const after = (await bia.emit('hello', {})).servers.find((s) => s.id === 'geral').channels;
  assert.deepEqual(after.filter((c) => c.type === 'text').map((c) => c.id), newOrder);
  assert.ok(after.findIndex((c) => c.type === 'voice') > after.findLastIndex((c) => c.type === 'text'), 'voz continua depois do texto');
  assert.match((await andre.emit('channel-reorder', { serverId: 'geral', type: 'text', order: ['sala-1', ...newOrder.slice(1)] })).error, /mudou/, 'não mistura tipos');
});

// ---------- cargos e permissões ----------
const { P } = require('../lib/perms');
async function roleIn(serverId, name, bits) {
  const r = await andre.emit('role-create', { serverId, name });
  await andre.emit('role-update', { id: r.id, perms: bits });
  return r.id;
}
const chanOf = async (p, serverId, id) => (await p.emit('hello', {})).servers.find((s) => s.id === serverId)?.channels.find((c) => c.id === id);

test('cargo dá permissão: Moderador cria canais e apaga mensagens dos outros', async () => {
  const mod = await roleIn('geral', 'Moderador', P.MANAGE_CHANNELS | P.MANAGE_MESSAGES);
  assert.match((await bia.emit('create-channel', { serverId: 'geral', name: 'mods', type: 'text' })).error, /permissão/);
  assert.equal((await andre.emit('member-role', { userId: bia.id, roleId: mod, add: true })).ok, true);
  assert.equal((await bia.emit('create-channel', { serverId: 'geral', name: 'Clips da Bia', type: 'text' })).ok, true);
  const m = await caio.emit('message', { key: 'geral/bate-papo', text: 'spam' });
  assert.equal((await bia.emit('message-delete', m.id)).ok, true);
  // o cargo vale só neste servidor
  assert.match((await bia.emit('create-channel', { serverId: 'trabalho', name: 'x', type: 'text' })).error, /permissão/);
});

test('canal privado: some da lista, da busca, dos avisos e do acesso direto', async () => {
  const time = await roleIn('geral', 'Equipe', 0);
  await andre.emit('create-channel', { serverId: 'geral', name: 'segredo', type: 'text' });
  const key = 'geral/segredo';
  const everyone = (await andre.emit('hello', {})).roles.geral.find((r) => r.isDefault).id;
  assert.equal((await andre.emit('channel-perms', { key, roleId: everyone, allow: 0, deny: P.VIEW })).ok, true);
  assert.equal((await andre.emit('channel-perms', { key, roleId: time, allow: P.VIEW, deny: 0 })).ok, true);
  await andre.emit('member-role', { userId: bia.id, roleId: time, add: true });
  assert.equal(await chanOf(caio, 'geral', 'segredo'), undefined, 'o Caio não vê o canal');
  assert.equal((await chanOf(bia, 'geral', 'segredo')).private, true, 'a Bia vê, marcado como privado');
  assert.match((await caio.emit('join-text', key)).error, /acesso/);
  const n = caio.events.length;
  await bia.emit('message', { key, text: 'plano secreto' });
  await sleep(150);
  assert.ok(!caio.events.slice(n).some((e) => e.ev === 'activity' && e.data.key === key), 'o Caio não recebe aviso');
  assert.equal((await caio.emit('search', { q: 'secreto', scope: 'geral' })).results.length, 0);
  assert.equal((await bia.emit('search', { q: 'secreto', scope: 'geral' })).results.length, 1);
  // tirar o cargo: a Bia perde o acesso na hora
  await bia.emit('join-text', key);
  await andre.emit('member-role', { userId: bia.id, roleId: time, add: false });
  await bia.waitFor('access-lost');
  assert.match((await bia.emit('join-text', key)).error, /acesso/);
});

test('canal só de leitura e @todos', async () => {
  await andre.emit('create-channel', { serverId: 'geral', name: 'avisos', type: 'text' });
  const key = 'geral/avisos';
  const everyone = (await andre.emit('hello', {})).roles.geral.find((r) => r.isDefault).id;
  await andre.emit('channel-perms', { key, roleId: everyone, allow: 0, deny: P.SEND | P.REACT });
  assert.equal((await chanOf(caio, 'geral', 'avisos')).perms & P.SEND, 0);
  assert.match((await caio.emit('message', { key, text: 'oi' })).error, /permissão/);
  const sent = await andre.emit('message', { key, text: 'Reunião hoje, @todos!' });
  const act = await caio.waitFor('activity', (a) => a.key === key);
  assert.ok(act.mentions.includes(caio.id) && act.mentions.includes(bia.id), '@todos menciona todo mundo que vê o canal');
  assert.match((await caio.emit('react', { id: sent.id, emoji: '🎉' })).error, /permissão/);
  await andre.emit('react', { id: sent.id, emoji: '🎉' });
  assert.equal((await caio.emit('react', { id: sent.id, emoji: '🎉' })).ok, true, 'entrar numa reação que já existe pode');
  // sem a permissão, @todos vira texto comum
  await andre.emit('role-update', { id: everyone, perms: (await andre.emit('hello', {})).roles.geral.find((r) => r.isDefault).perms & ~P.MENTION_ALL });
  const plain = await caio.emit('message', { key: 'geral/bate-papo', text: 'olá @todos' });
  assert.ok(plain.ok);
  await sleep(100);
  const last = bia.events.filter((e) => e.ev === 'activity' && e.data.key === 'geral/bate-papo').at(-1).data;
  assert.deepEqual(last.mentions, []);
});

test('hierarquia: ninguém mexe em quem está acima', async () => {
  // começa sem os cargos dos testes anteriores
  for (const rid of (await andre.emit('hello', {})).memberRoles.geral?.[bia.id] || []) await andre.emit('member-role', { userId: bia.id, roleId: rid, add: false });
  const chefe = await roleIn('geral', 'Chefe', P.MANAGE_ROLES | P.MANAGE_CHANNELS);
  const baixo = await roleIn('geral', 'Novato', 0); // criado depois: entra abaixo do Chefe
  const roles = (await andre.emit('hello', {})).roles.geral;
  assert.ok(roles.find((r) => r.id === chefe).pos > roles.find((r) => r.id === baixo).pos);
  await andre.emit('member-role', { userId: bia.id, roleId: chefe, add: true });
  assert.equal((await bia.emit('member-role', { userId: caio.id, roleId: baixo, add: true })).ok, true, 'cargo abaixo: pode dar');
  assert.match((await bia.emit('member-role', { userId: caio.id, roleId: chefe, add: true })).error, /permissão/, 'o próprio nível: não');
  assert.match((await bia.emit('role-update', { id: chefe, perms: P.ADMIN })).error, /permissão/);
  assert.match((await bia.emit('role-update', { id: baixo, perms: P.MANAGE_SERVER })).error, /que você mesmo tem/, 'não dá permissão que não tem');
  assert.equal((await bia.emit('role-update', { id: baixo, perms: P.MANAGE_CHANNELS, color: '#46c28a' })).ok, true);
  assert.match((await bia.emit('member-role', { userId: andre.id, roleId: baixo, add: false })).error, /permissão/, 'não mexe no dono');
  const order = (await andre.emit('hello', {})).roles.geral.filter((r) => !r.isDefault).map((r) => r.id);
  const up = [baixo, ...order.filter((x) => x !== baixo)];
  assert.match((await bia.emit('role-reorder', { serverId: 'geral', order: up })).error, /permissão/, 'não põe cargo acima do seu');
  assert.equal((await andre.emit('role-delete', { id: baixo })).ok, true);
  await andre.emit('member-role', { userId: bia.id, roleId: chefe, add: false });
});

test('voz: entrar, transmitir e moderar conforme os cargos', async () => {
  const everyone = (await andre.emit('hello', {})).roles.geral.find((r) => r.isDefault);
  await andre.emit('channel-perms', { key: 'geral/sala-2', roleId: everyone.id, allow: 0, deny: P.CONNECT });
  assert.match((await caio.emit('voice-join', 'geral/sala-2')).error, /permissão/);
  assert.ok(Array.isArray(await caio.emit('voice-join', 'geral/sala-1')));
  await andre.emit('channel-perms', { key: 'geral/sala-1', roleId: everyone.id, allow: 0, deny: P.STREAM });
  caio.socket.emit('voice-update', { sharing: true });
  const st = await caio.waitFor('voice-state', (v) => v['geral/sala-1']?.some((m) => m.uid === caio.id && m.stream === false));
  assert.equal(st['geral/sala-1'].find((m) => m.uid === caio.id).sharing, false, 'sem "Transmitir" não compartilha');
  const sid = st['geral/sala-1'].find((m) => m.uid === caio.id).id;
  assert.match((await bia.emit('voice-moderate', { sid, mute: true })).error, /permissão/);
  const mod = await roleIn('geral', 'Moderador de voz', P.MUTE_MEMBERS | P.MOVE_MEMBERS);
  await andre.emit('member-role', { userId: bia.id, roleId: mod, add: true });
  assert.equal((await bia.emit('voice-moderate', { sid, mute: true })).ok, true);
  await caio.waitFor('voice-state', (v) => v['geral/sala-1']?.some((m) => m.uid === caio.id && m.serverMuted));
  assert.equal((await bia.emit('voice-disconnect', { sid })).ok, true);
  await caio.waitFor('voice-kicked');
  // quem não vê a sala privada também não sabe quem está nela
  await andre.emit('channel-perms', { key: 'geral/sala-1', roleId: everyone.id, allow: 0, deny: P.VIEW });
  await andre.emit('voice-join', 'geral/sala-1');
  const v = await caio.waitFor('voice-state', () => true);
  assert.equal(v['geral/sala-1'], undefined);
});

test('TURN: credenciais da Cloudflare, sem a porta 53, e STUN quando não há chave', async () => {
  const os = require('os'); const path = require('path');
  const { createTurn } = require('../lib/turn');
  // sem configuração: só STUN, pela rota do Junta
  const { data: ice } = await andre.api('GET', '/api/ice');
  assert.equal(ice.turn, false);
  assert.ok(ice.iceServers[0].urls.some((u) => u.startsWith('stun:')));
  // "Cloudflare" de mentira
  let calls = 0, auth = null;
  const fake = http.createServer((req, res) => {
    calls++; auth = req.headers.authorization;
    if (!req.url.endsWith('/chave1/credentials/generate-ice-servers')) { res.writeHead(404); return res.end(); }
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ iceServers: [
      { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
      { urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:53?transport=udp', 'turns:turn.cloudflare.com:443?transport=tcp'], username: 'u', credential: 'c' },
    ] }));
  });
  await new Promise((r) => fake.listen(0, r));
  process.env.JUNTA_TURN_API = `http://127.0.0.1:${fake.address().port}/keys`;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'junta-turn-'));
  try {
    fs.writeFileSync(path.join(dir, 'turn.json'), JSON.stringify({ keyId: 'chave1', token: 'segredo' }));
    const t = createTurn(dir, () => {});
    const c = await t.get();
    assert.equal(c.turn, true);
    assert.equal(auth, 'Bearer segredo');
    const urls = c.iceServers.flatMap((s) => s.urls);
    assert.ok(urls.includes('turns:turn.cloudflare.com:443?transport=tcp'));
    assert.ok(!urls.some((u) => /:53(\?|$)/.test(u)), 'porta 53 removida');
    await t.get(); assert.equal(calls, 1, 'credenciais ficam em cache');
    // chave errada: cai para só STUN, sem quebrar
    fs.writeFileSync(path.join(dir, 'turn.json'), JSON.stringify({ keyId: 'outra', token: 'x' }));
    await sleep(20);
    const bad = await createTurn(dir, () => {}).get();
    assert.equal(bad.turn, false);
  } finally {
    delete process.env.JUNTA_TURN_API; fake.close(); fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('TURN: consumo do mês, últimos 7 dias e conexões agora', async () => {
  const { fetchUsage } = require('../lib/turn-usage');
  const now = Date.parse('2026-11-03T15:02:00Z'); // começo do mês: a semana pega 4 dias de outubro
  const queries = [];
  const fake = http.createServer((req, res) => {
    let body = ''; req.on('data', (c) => (body += c)); req.on('end', () => {
      const { variables } = JSON.parse(body); queries.push(variables);
      assert.equal(req.headers.authorization, 'Bearer tok');
      const rows = variables.from === '2026-11-01'
        ? [{ t: '2026-11-01T10:00:00Z', e: 2e9, i: 1e9, c: 2 }, { t: '2026-11-03T14:55:00Z', e: 5e8, i: 1e8, c: 3 }]
        : [{ t: '2026-10-29T20:00:00Z', e: 7e9, i: 1e9, c: 1 }];
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: { viewer: { accounts: [{ callsTurnUsageAdaptiveGroups: rows.map((r) => ({ dimensions: { datetimeFiveMinutes: r.t }, avg: { concurrentConnectionsFiveMinutes: r.c }, sum: { egressBytes: r.e, ingressBytes: r.i } })) }] } } }));
    });
  });
  await new Promise((r) => fake.listen(0, r));
  process.env.JUNTA_CF_GRAPHQL = `http://127.0.0.1:${fake.address().port}/graphql`;
  try {
    const u = await fetchUsage({ accountId: 'acc', token: 'tok' }, now);
    assert.deepEqual(queries.map((q) => [q.from, q.to]), [['2026-11-01', '2026-11-03'], ['2026-10-28', '2026-10-31']]);
    assert.equal(u.month.egress, 2.5e9, 'outubro não entra no mês');
    assert.equal(u.month.ingress, 1.1e9);
    assert.equal(u.days.length, 7);
    assert.deepEqual(u.days.map((d) => d.egress), [0, 7e9, 0, 0, 2e9, 0, 5e8]);
    assert.equal(u.current, 3, 'bloco dos últimos 15 minutos');
    assert.equal((await fetchUsage({ accountId: 'acc', token: 'tok' }, now + 3600_000)).current, 0, 'nada recente: ninguém agora');
  } finally { delete process.env.JUNTA_CF_GRAPHQL; fake.close(); }
  // rota só para o dono
  assert.equal((await bia.api('GET', '/api/admin/turn-usage')).status, 403);
  const r = await andre.api('GET', '/api/admin/turn-usage');
  assert.equal(r.data.usage.configured, false);
});

test('tema de fim de ano: só o dono liga, e todos recebem na hora', async () => {
  assert.equal((await (await fetch(`${app.base}/api/theme`)).json()).theme, null);
  assert.equal((await bia.api('POST', '/api/admin/theme', { theme: 'noite' })).status, 403);
  assert.equal((await andre.api('POST', '/api/admin/theme', { theme: 'xyz' })).status, 400);
  const got = bia.waitFor('theme', (d) => d.theme === 'noite');
  assert.equal((await andre.api('POST', '/api/admin/theme', { theme: 'noite' })).status, 200);
  await got;
  assert.equal((await bia.emit('hello', {})).theme, 'noite');
  assert.equal((await (await fetch(`${app.base}/api/theme`)).json()).theme, 'noite');
  const off = caio.waitFor('theme', (d) => d.theme === null);
  await andre.api('POST', '/api/admin/theme', { theme: null });
  await off;
});

test('threads: respostas ficam fora do canal, contam no contador e avisam quem começou', async () => {
  await andre.emit('join-text', GERAL); await bia.emit('join-text', GERAL);
  const root = await bia.emit('message', { key: GERAL, text: 'quem topa jogar hoje?' });
  const upd = bia.waitFor('message-update', (d) => d.msg.id === root.id && d.msg.thread?.n === 1);
  const act = bia.waitFor('activity', (a) => a.thread === root.id);
  const r = await andre.emit('message', { key: GERAL, text: 'eu topo', thread: root.id });
  assert.equal(r.ok, true);
  assert.equal((await upd).msg.thread.lastUid, andre.id);
  assert.deepEqual((await act).mentions, [bia.id], 'quem começou a thread é avisado');
  const page = await bia.emit('join-text', GERAL);
  assert.ok(!page.messages.some((m) => m.id === r.id), 'resposta não aparece no canal');
  assert.equal(page.messages.find((m) => m.id === root.id).thread.n, 1);
  const th = await caio.emit('thread', { id: root.id });
  assert.equal(th.root.id, root.id); assert.equal(th.messages[0].text, 'eu topo'); assert.equal(th.messages[0].threadRoot, root.id);
  // sem thread dentro de thread
  assert.match((await caio.emit('message', { key: GERAL, text: 'x', thread: r.id })).error, /não existe/);
  // resposta não conta como não lida para quem não foi mencionado
  const before = (await caio.emit('hello', {})).unread[GERAL]?.n || 0;
  await andre.emit('message', { key: GERAL, text: 'mais uma', thread: root.id });
  await sleep(50);
  assert.equal((await caio.emit('hello', {})).unread[GERAL]?.n || 0, before);
  // busca acha a resposta e diz de que thread ela é
  const found = (await caio.emit('search', { q: 'topo', scope: 'geral' })).results.find((x) => x.msg.id === r.id);
  assert.equal(found.msg.threadRoot, root.id); assert.equal(found.rootSeq, page.messages.find((m) => m.id === root.id).seq);
  // apagar a mensagem de origem apaga a thread
  await bia.emit('message-delete', root.id);
  assert.match((await caio.emit('thread', { id: root.id })).error, /não encontrada/);
  assert.equal((await caio.emit('search', { q: 'topo', scope: 'geral' })).results.filter((x) => x.msg.id === r.id).length, 0);
});

test('mensagens fixadas: quem gerencia mensagens fixa; nas DMs, os dois', async () => {
  const m = await caio.emit('message', { key: GERAL, text: 'regras do servidor' });
  assert.match((await caio.emit('pin', { id: m.id, on: true })).error, /permissão/);
  await caio.emit('join-text', GERAL);
  const ev = caio.waitFor('pins-changed', (d) => d.id === m.id && d.on);
  assert.equal((await andre.emit('pin', { id: m.id, on: true })).ok, true);
  await ev;
  const list = await caio.emit('pins', GERAL);
  assert.equal(list.messages[0].id, m.id); assert.equal(list.messages[0].pinned, true); assert.equal(list.canPin, false);
  await andre.emit('pin', { id: m.id, on: false });
  assert.equal((await caio.emit('pins', GERAL)).messages.length, 0);
  // conversa direta
  const dm = `dm/${Math.min(bia.id, caio.id)}-${Math.max(bia.id, caio.id)}`;
  const d = await caio.emit('message', { key: dm, text: 'endereço da festa' });
  assert.equal((await bia.emit('pin', { id: d.id, on: true })).ok, true);
  assert.equal((await andre.emit('pins', dm)).messages.length, 0, 'quem não está na conversa não vê');
});

test('emojis personalizados e soundboard: envio com permissão, uso e reprodução na sala', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const up = (who, path, buf, fields, type) => { const fd = new FormData(); for (const [k, v] of Object.entries(fields)) fd.append(k, v); fd.append('file', new Blob([buf], { type }), 'f'); return who.api('POST', path, fd); };
  assert.equal((await up(caio, '/api/servers/geral/emojis', png, { name: 'festa' }, 'image/png')).status, 403);
  assert.equal((await up(andre, '/api/servers/geral/emojis', png, { name: 'Com Espaço' }, 'image/png')).status, 400);
  const ok = await up(andre, '/api/servers/geral/emojis', png, { name: 'festa' }, 'image/png');
  assert.equal(ok.status, 200);
  assert.equal((await up(andre, '/api/servers/geral/emojis', png, { name: 'festa' }, 'image/png')).status, 400, 'nome repetido');
  const srv = (await caio.emit('hello', {})).servers.find((s) => s.id === 'geral');
  assert.equal(srv.emojis[0].name, 'festa');
  assert.equal((await fetch(`${app.base}/emojis/${srv.emojis[0].file}`)).status, 401, 'arquivo só com login');
  // reação com emoji do servidor
  const m = await caio.emit('message', { key: GERAL, text: 'bora :festa:' });
  const rr = await bia.emit('react', { id: m.id, emoji: ':festa:' }); assert.equal(rr.ok, true, JSON.stringify(rr));
  assert.match((await bia.emit('react', { id: m.id, emoji: ':naoexiste:' })).error, /inválida/);
  // som: precisa ser áudio de verdade
  const wav = Buffer.concat([Buffer.from('RIFF\x24\x00\x00\x00WAVEfmt ', 'latin1'), Buffer.alloc(32)]);
  assert.equal((await up(andre, '/api/servers/geral/sounds', png, { name: 'x' }, 'audio/wav')).status, 400);
  assert.equal((await up(andre, '/api/servers/geral/sounds', wav, { name: 'Risada', emoji: '😂' }, 'audio/wav')).status, 200);
  const sound = (await bia.emit('hello', {})).servers.find((s) => s.id === 'geral').sounds[0];
  assert.equal(sound.name, 'Risada');
  assert.match((await bia.emit('sound-play', sound.id)).error, /sala de voz/);
  // (testes anteriores tiraram "Entrar na voz" do @todos; o dono entra e ouve o próprio som)
  await andre.emit('voice-join', 'geral/sala-2');
  const heard = andre.waitFor('sound', (s) => s.id === sound.id);
  const sp = await andre.emit('sound-play', sound.id); assert.equal(sp.ok, true, JSON.stringify(sp));
  assert.equal((await heard).by, andre.id);
  assert.match((await andre.emit('sound-play', sound.id)).error, /Calma/);
  andre.socket.emit('voice-leave');
});

test('GIFs: resultados no formato do Tenor, sem anúncios, e favoritos por pessoa', async () => {
  const { normalize } = require('../lib/gifs');
  const d = normalize({ next: 'abc', results: [
    { id: 1, content_description: 'gato', media_formats: { gif: { url: 'https://static.klipy.com/a.gif', dims: [200, 100] }, tinygif: { url: 'https://static.klipy.com/a-t.gif', dims: [100, 50] } } },
    { id: 2, type: 'ad', media_formats: { gif: { url: 'https://ads.example/x.gif' } } },
    { id: 3, media_formats: { gif: { url: 'http://inseguro/x.gif' } } },
  ] });
  assert.deepEqual(d.items.map((x) => x.id), ['1']);
  assert.equal(d.items[0].preview, 'https://static.klipy.com/a-t.gif'); assert.equal(d.items[0].w, 200); assert.equal(d.next, 'abc');
  const none = await bia.api('GET', '/api/gifs/search?q=gato');
  assert.equal(none.data.configured, false);
  assert.equal((await bia.api('POST', '/api/gifs/favorites', { url: 'https://static.klipy.com/a.gif' })).status, 200);
  assert.equal((await bia.api('GET', '/api/gifs/favorites')).data.items[0].url, 'https://static.klipy.com/a.gif');
  assert.equal((await caio.api('GET', '/api/gifs/favorites')).data.items.length, 0);
  assert.equal((await bia.api('POST', '/api/admin/gifs', { key: 'x'.repeat(20) })).status, 403);
});
