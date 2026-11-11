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
  assert.match((await bia.emit('create-channel', { serverId: 'geral', name: 'x', type: 'text' })).error, /dono/);
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
  assert.match((await bia.emit('server-update', { id: made.id, name: 'x' })).error, /dono/);
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
