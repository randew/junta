// Junta — guarda a chave do TURN da Cloudflare em dados/turn.json e testa na hora.
// Uso: node scripts/configurar-turn.js   (ou dois cliques no configurar-turn.bat / .command)
//      node scripts/configurar-turn.js --remover   desliga o TURN
const fs = require('fs');
const path = require('path');
const readline = require('readline/promises');
const { cloudflareIce, configFile } = require('../lib/turn');

const DATA_DIR = process.env.JUNTA_DATA || path.join(__dirname, '..', 'dados');
const file = configFile(DATA_DIR);

async function main() {
  if (process.argv.includes('--remover')) {
    try { fs.unlinkSync(file); console.log('TURN desligado (dados/turn.json apagado).'); } catch { console.log('O TURN já estava desligado.'); }
    return;
  }
  console.log('\n Configurar o TURN da Cloudflare');
  console.log(' No painel da Cloudflare: Realtime (ou Calls) → TURN Server → sua chave.\n');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const keyId = (await rl.question('Turn Token ID: ')).trim();
  const token = (await rl.question('API Token: ')).trim();
  rl.close();
  if (!keyId || !token) { console.log('\nOs dois valores são necessários. Nada foi alterado.'); process.exitCode = 1; return; }

  process.stdout.write('\nTestando com a Cloudflare... ');
  let servers;
  try { servers = await cloudflareIce({ keyId, token }); }
  catch (e) {
    console.log(`falhou (${e.message}).`);
    console.log('Confira se copiou os dois valores certos. Nada foi alterado.');
    process.exitCode = 1; return;
  }
  const n = servers.flatMap((s) => [].concat(s.urls)).filter((u) => /^turns?:/.test(u)).length;
  console.log(`funcionou (${n} endereços de TURN).`);

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ keyId, token }, null, 2) + '\n', { mode: 0o600 });
  console.log(`\nPronto! Chave salva em ${path.relative(process.cwd(), file) || file}.`);
  console.log('Se o Junta estiver aberto, já vale para quem entrar numa sala a partir de agora.');
}
main();
