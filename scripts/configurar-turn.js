// Junta — configura o TURN da Cloudflare (dados/turn.json) e, se quiser, o acompanhamento
// do consumo no painel de administração (dados/cloudflare.json). Testa cada parte na hora.
// Uso: node scripts/configurar-turn.js   (ou dois cliques no configurar-turn.bat / .command)
//      node scripts/configurar-turn.js --remover   desliga o TURN e o acompanhamento
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { cloudflareIce, configFile } = require('../lib/turn');
const { queryRange, statsFile } = require('../lib/turn-usage');

const DATA_DIR = process.env.JUNTA_DATA || path.join(__dirname, '..', 'dados');
const turnFile = configFile(DATA_DIR), cfFile = statsFile(DATA_DIR);

// perguntas no terminal (funciona também com respostas coladas de uma vez)
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const lines = []; const waiting = [];
rl.on('line', (l) => (waiting.length ? waiting.shift()(l) : lines.push(l)));
rl.on('close', () => { while (waiting.length) waiting.shift()(''); });
const ask = (q) => { process.stdout.write(q); return lines.length ? Promise.resolve(lines.shift()) : new Promise((r) => waiting.push(r)); };
const yes = async (q, def) => { const a = (await ask(`${q} ${def ? '(S/n)' : '(s/N)'} `)).trim().toLowerCase(); return a ? a.startsWith('s') : def; };
const save = (file, data) => { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 }); };

async function configureTurn() {
  console.log('\n— TURN —');
  console.log('No painel da Cloudflare: Realtime (ou Calls) → TURN Server → sua chave.\n');
  const keyId = (await ask('Turn Token ID: ')).trim();
  const token = (await ask('API Token: ')).trim();
  if (!keyId || !token) { console.log('Os dois valores são necessários. O TURN não foi alterado.'); return false; }
  process.stdout.write('Testando com a Cloudflare... ');
  try {
    const servers = await cloudflareIce({ keyId, token });
    const n = servers.flatMap((s) => [].concat(s.urls)).filter((u) => /^turns?:/.test(u)).length;
    console.log(`funcionou (${n} endereços de TURN).`);
  } catch (e) {
    console.log(`falhou (${e.message}).\nConfira se copiou os dois valores certos. O TURN não foi alterado.`);
    return false;
  }
  save(turnFile, { keyId, token });
  console.log('TURN salvo.');
  return true;
}

async function configureStats() {
  console.log('\n— Acompanhar o consumo no painel do Junta —');
  console.log('1. ID da conta: na página inicial da Cloudflare, menu da conta → "Copy account ID"');
  console.log('   (ou na lateral direita da página de qualquer domínio, em "Account ID").');
  console.log('2. Token: My Profile → API Tokens → Create Token → Create Custom Token,');
  console.log('   permissão Account → Account Analytics → Read. Copie o token gerado.\n');
  const accountId = (await ask('Account ID: ')).trim();
  const token = (await ask('Token de estatísticas: ')).trim();
  if (!accountId || !token) { console.log('Os dois valores são necessários. Nada foi alterado.'); return false; }
  process.stdout.write('Testando com a Cloudflare... ');
  try {
    const today = new Date().toISOString().slice(0, 10);
    await queryRange({ accountId, token }, today, today);
    console.log('funcionou.');
  } catch (e) {
    console.log(`falhou (${e.message}).\nNada foi alterado.`);
    return false;
  }
  save(cfFile, { accountId, token });
  console.log('Pronto! O consumo aparece em Administração → TURN (menu do seu perfil).');
  return true;
}

async function main() {
  if (process.argv.includes('--remover')) {
    let any = false;
    for (const f of [turnFile, cfFile]) { try { fs.unlinkSync(f); any = true; } catch {} }
    console.log(any ? 'TURN e acompanhamento do consumo desligados.' : 'Já estavam desligados.');
    return;
  }
  console.log('\n Configurar o TURN da Cloudflare');
  let turnOk = fs.existsSync(turnFile);
  if (turnOk) {
    console.log('\nO TURN já está configurado neste computador.');
    if (await yes('Quer trocar a chave do TURN?', false)) turnOk = (await configureTurn()) || turnOk;
  } else {
    turnOk = await configureTurn();
    if (!turnOk) { process.exitCode = 1; rl.close(); return; }
  }
  const hasStats = fs.existsSync(cfFile);
  const q = hasStats ? 'O acompanhamento do consumo já está ligado. Quer trocar o token?' : 'Quer acompanhar o consumo do TURN no painel de administração do Junta?';
  if (await yes(q, !hasStats)) { if (!(await configureStats())) process.exitCode = 1; }
  console.log('\nSe o Junta estiver aberto, as mudanças já valem, sem reiniciar.');
  rl.close();
}
main();
