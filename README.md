# Junta

Chat em tempo real no estilo Discord: servidores, canais de texto, salas de voz e **compartilhamento de tela**.

## Rodar no seu computador

Precisa do Node.js 18 ou mais novo.

```bash
npm install
npm start
```

Abra http://localhost:3000. Para testar sozinho, abra uma segunda aba (ou outro navegador), entre na mesma sala de voz e clique em **Compartilhar tela**.

## Atalhos (Windows: dois cliques)

- **`iniciar.bat`**: instala o que faltar, liga o servidor e abre http://localhost:3000.
- **`iniciar-com-amigos.bat`**: o mesmo, e abre uma segunda janela com o link público para mandar aos amigos.
- **`iniciar.command`**: atalho para Mac ou Linux (`./iniciar.command amigos` para também criar o link).

Se a pasta tiver sido baixada com `git clone`, os atalhos baixam a versão mais nova (`git pull`) antes de iniciar.

## Usar com amigos

O navegador só libera microfone e captura de tela em **HTTPS** (ou em `localhost`). Duas opções:

1. **Túnel rápido** (sem deploy), com o servidor rodando:
   ```bash
   npx cloudflared tunnel --url http://localhost:3000
   ```
   Mande o link `https://...trycloudflare.com` que aparecer.
2. **Deploy** em Render, Railway ou Fly.io: é um app Node comum, comando de start `npm start`, porta lida de `PORT`.

## Áudio

No botão **Áudio**, dentro de uma sala de voz:

- **Microfone:** escolhe qual usar.
- **Modo de entrada:** detecção de voz ou **apertar para falar**, com a tecla que você quiser (padrão `V`). Também há um botão na tela para segurar, útil no celular. A tecla só funciona com a aba do Junta em foco.
- **Supressão de ruído:** IA (RNNoise, roda no próprio navegador), filtro do navegador ou desligada.
- **Modo música:** desliga filtros e ganho automático e envia em estéreo a 128 kbps.

A voz sai em Opus a 64 kbps com correção de perda de pacotes e prioridade sobre a transmissão de tela. O áudio da tela sai em estéreo a 128 kbps.

**Avisos da sala:** quando alguém entra, sai ou começa a transmitir na sua sala de voz, toca um som curto e aparece um aviso com o nome da pessoa. Dá para desligar ou ajustar o volume em **Áudio**; no modo Não perturbe os sons ficam desligados.

**Volume por pessoa:** clique no bloco de alguém na sala. O áudio de cada transmissão de tela tem um controle próprio, no canto do vídeo. Os ajustes ficam salvos no seu navegador.

## Membros

O painel à direita mostra quem está com o Junta aberto, separado entre Online e Ausente, e a sala de voz em que cada pessoa está (em vermelho quando está transmitindo a tela). O botão de pessoas no canto superior direito mostra e esconde o painel.

Clique no seu nome, no canto inferior esquerdo, para escolher Online, Ausente ou Não perturbe. Com a aba em segundo plano por 5 minutos, o status vira Ausente sozinho e volta ao abrir a aba.

## Como funciona

- `server.js`: Express + Socket.IO. Guarda servidores, canais e as últimas 300 mensagens de cada canal **em memória** (somem ao reiniciar) e repassa a sinalização WebRTC entre quem está na mesma sala de voz.
- `public/app.js`: interface e WebRTC em malha (cada pessoa conecta direto com cada outra). Áudio e tela vão ponta a ponta, sem passar pelo servidor.
- Tela compartilhada com três predefinições, escolhidas ao clicar em **Compartilhar tela**:
  - **Nitidez**: até 1440p a 30 fps, até 8 Mbps, prefere AV1. Ideal para texto.
  - **Movimento**: 1080p a 60 fps, até 8 Mbps, prefere H.264 (codificação por hardware). Ideal para jogos e vídeos.
  - **Equilibrado**: 1080p a 30 fps, até 5 Mbps, prefere VP9. Para internet mais fraca.
  A transmissão já começa com banda alta, sem o borrão dos primeiros segundos. Cada tela mostra no canto a resolução e os fps que estão chegando. O áudio da aba ou do sistema vai junto quando o navegador permite (Chrome/Edge).
- A banda de cada espectador sai da internet de **quem transmite**. Com várias pessoas assistindo, o upload é dividido entre elas.

## Limites conhecidos

- **Rede:** só usa STUN do Google. Em redes corporativas ou 4G com NAT restritivo a conexão de voz/tela pode falhar; nesse caso adicione um servidor TURN (ex.: coturn ou Metered) em `ICE` no topo de `public/app.js`.
- **Tamanho da sala:** a malha funciona bem até umas 5–6 pessoas. Para mais gente, troque por um SFU (LiveKit, mediasoup).
- **Sem contas nem permissões:** qualquer pessoa com o link entra e cria canais. Para uso público, adicione login.
- **Persistência:** para guardar mensagens, troque os objetos em memória por SQLite ou Postgres.
- Compartilhar tela pelo celular não é suportado pela maioria dos navegadores; assistir funciona.
