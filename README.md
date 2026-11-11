# Junta

Chat em tempo real no estilo Discord: servidores, canais de texto, salas de voz e **compartilhamento de tela**.

## Rodar no seu computador

Precisa do Node.js **22.13 ou mais novo** (a versão LTS atual do nodejs.org serve). Confira com `node -v`.

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

## Contas e convites

- Na primeira vez que o servidor liga, o terminal mostra um **código de convite**. Abra o Junta, clique em **Criar conta** e use esse código. **A primeira conta criada vira a dona do Junta.**
- Para chamar amigos: clique no seu nome (canto inferior esquerdo) → **Convidar amigos** → **Copiar convite**. O código é pedido só na criação da conta. **Gerar código novo** invalida o anterior, útil se ele vazou.
- Só a dona cria e apaga servidores e canais, e pode apagar qualquer mensagem. Cada pessoa edita e apaga as próprias mensagens (passe o mouse sobre a mensagem, ou aperte **↑** com a caixa de texto vazia para editar a última).
- O login fica salvo por 60 dias. **Sair da conta** fica no mesmo menu do seu nome.
- O lápis ao lado do seu nome troca o **nome de exibição**; o usuário de login não muda.

## Mensagens e anexos

- Tudo fica salvo na pasta **`dados/`** (banco `junta.db` e arquivos em `anexos/`). Reiniciar o servidor ou atualizar o código não apaga nada.
- **Backup:** feche o Junta e copie a pasta `dados` para outro lugar. Para restaurar, coloque-a de volta.
- Anexe pelo clipe, arrastando arquivos para a conversa ou colando uma imagem (Ctrl+V). Até 10 arquivos de 25 MB por mensagem. Imagens, vídeos e áudios aparecem na conversa; o resto vira um cartão para baixar.
- Os anexos só abrem para quem está logado. Arquivos de página (HTML, SVG etc.) sempre são baixados, nunca abertos no navegador.
- Role a conversa para cima para carregar mensagens antigas.

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

- `server.js`: Express + Socket.IO. Contas (senha com hash scrypt, sessão em cookie HttpOnly), mensagens, anexos e a sinalização WebRTC entre quem está na mesma sala de voz.
- `db.js`: banco SQLite embutido no Node, em `dados/junta.db`. A pasta pode ser trocada com a variável `JUNTA_DATA`.
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
- **Esqueceu a senha:** ainda não há recuperação por e-mail. A dona pode apagar a conta direto no banco, e a pessoa cria outra.
- **Render (plano grátis):** o disco é apagado a cada atualização, então mensagens e anexos se perderiam lá. Para hospedar fora do seu PC, seria preciso um banco e um armazenamento de arquivos externos.
- Compartilhar tela pelo celular não é suportado pela maioria dos navegadores; assistir funciona.
