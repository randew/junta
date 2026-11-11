# Junta

Chat em tempo real no estilo Discord para um grupo de amigos: servidores, canais de texto, mensagens diretas, salas de voz com câmera e **compartilhamento de tela**.

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

Abra só um deles por vez. Se a pasta tiver sido baixada com `git clone`, os atalhos baixam a versão mais nova (`git pull`) antes de iniciar.

## Usar com amigos

O navegador só libera microfone, câmera e captura de tela em **HTTPS** (ou em `localhost`). Duas opções:

1. **Túnel rápido** (sem deploy), com o servidor rodando:
   ```bash
   npx cloudflared tunnel --url http://localhost:3000
   ```
   Mande o link `https://...trycloudflare.com` que aparecer.
2. **Deploy** em Render, Railway ou Fly.io: é um app Node comum, comando de start `npm start`, porta lida de `PORT`. Veja os limites no fim.

## Contas, convites e administração

- Na primeira vez que o servidor liga, o terminal mostra um **código de convite**. Abra o Junta, clique em **Criar conta** e use esse código. **Quem criar a primeira conta vira o dono do Junta.**
- Tudo da conta fica no menu do seu nome (canto inferior esquerdo): status, **Notificações**, **Trocar senha**, **Sair da conta** e, para o dono, **Convidar amigos** e **Administração**.
- **Convidar:** copia o endereço e o código juntos. **Gerar código novo** invalida o anterior.
- **Administração** (dono):
  - **Contas:** **Redefinir senha** gera uma senha temporária para você passar à pessoa (ela sai de todos os aparelhos e depois pode trocar em "Trocar senha"). **Remover** tira o acesso na hora, mas mantém as mensagens no histórico; dá para **Restaurar**.
  - **Backups:** veja a seção abaixo.
- Só o dono cria e apaga servidores e canais e pode apagar mensagens dos outros nos canais (nunca nas mensagens diretas).
- **Configurações do servidor** (dono): a engrenagem ao lado do nome do servidor, no topo da lista de canais.
  - **Geral:** nome, ícone (o centro da imagem é recortado em quadrado), posição na barra e **excluir servidor**, que pede para digitar o nome do servidor e apaga canais, mensagens e anexos.
  - **Canais:** renomear direto no campo, mudar a ordem com as setas, criar e apagar. Renomear não mexe nas mensagens.
- **Arrastar para reordenar** (dono): arraste os servidores na barra da esquerda ou os canais na lista (cada canal fica no seu grupo, de texto ou de voz). No celular, segure um instante antes de arrastar. **Esc** cancela. As setas nas configurações fazem o mesmo pelo teclado.

## Mensagens

- **Formatação:** `**negrito**`, `*itálico*`, `__sublinhado__`, `~~riscado~~`, `||spoiler||`, `` `código` ``, blocos com ` ``` ` e citações começando a linha com `> `.
- **Menções:** digite `@` e escolha a pessoa (setas + Enter). Quem é mencionado vê a mensagem destacada e recebe aviso.
- **Responder:** passe o mouse sobre a mensagem → seta de resposta. A citação é clicável e leva até a original. Responder também menciona o autor.
- **Reagir:** passe o mouse → carinha, ou clique numa reação existente para entrar nela (clicar de novo tira).
- **Editar e apagar:** pelos botões da mensagem, ou **↑** com a caixa vazia para editar a última.
- **Prévia de links:** links viram um cartão com título, descrição e imagem. Para não gerar prévia, escreva o link entre `<` e `>`. O servidor nunca acessa endereços da sua rede interna ao buscar prévias.
- **Anexos:** clipe, arrastar para a conversa ou colar uma imagem (Ctrl+V). Até 10 arquivos de 25 MB por mensagem.
- **Emojis:** botão de carinha na caixa de mensagem.

## Não lidas e notificações

- Canais com mensagens novas ficam em destaque; o número vermelho conta **menções**. Os servidores na barra da esquerda mostram o mesmo, e o título da aba fica `(3) Junta`.
- Ao abrir uma conversa, aparece uma linha **"Novas mensagens"** onde você parou.
- **Notificações do sistema:** ligue em menu do seu nome → **Notificações**. Avisam de menções e mensagens diretas quando a aba está em segundo plano. No modo **Não perturbe**, nada de som nem notificação.

## Mensagens diretas

- O **J** no topo da barra da esquerda é o início: lá ficam as suas conversas particulares.
- Para começar: clique em alguém (nas mensagens ou na lista de membros) → **Enviar mensagem**, ou o **+** na lista de conversas.
- Só as duas pessoas veem as mensagens e os anexos, nem o dono.

## Busca

- Campo **Buscar** no topo (ou **Ctrl+K**). Procura no servidor aberto, ou nas suas conversas diretas quando você está no início.
- Ignora acentos e maiúsculas: `reuniao` acha "Reunião". Use `de:usuario` para filtrar por pessoa.
- Clique num resultado para ir até a mensagem; a barra **"Ir para as mais recentes"** volta ao fim.

## Perfil

O lápis ao lado do seu nome abre o editor de perfil, com prévia ao vivo: **foto** (arraste e dê zoom para enquadrar), **nome de exibição**, **apelido** neste servidor, **pronomes**, **status personalizado**, **sobre mim** e **cor do perfil**. Clique na foto ou no nome de alguém para ver o cartão de perfil.

## Voz, tela e câmera

- **Câmera:** botão **Câmera** dentro da sala (720p a 30 fps). A sua imagem aparece espelhada só para você. Escolha a câmera em **Áudio**.
- **Compartilhar tela** com três predefinições:
  - **Nitidez**: até 1440p a 30 fps, até 8 Mbps, prefere AV1. Ideal para texto.
  - **Movimento**: 1080p a 60 fps, até 8 Mbps, prefere H.264. Ideal para jogos e vídeos.
  - **Equilibrado**: 1080p a 30 fps, até 5 Mbps, prefere VP9. Para internet mais fraca.
- **Áudio** (dentro da sala): microfone, **apertar para falar** (tecla padrão `V`), **supressão de ruído** por IA, **modo música** (estéreo a 128 kbps) e avisos sonoros de entrada e saída.
- **Volume por pessoa:** clique no bloco de alguém na sala; cada transmissão de tela tem o próprio controle.
- A banda de cada espectador sai da internet de **quem transmite**: com várias pessoas assistindo, o upload é dividido entre elas.

## Dados e backup

- Tudo fica na pasta **`dados/`**: o banco `junta.db`, os anexos em `anexos/` e as fotos em `avatares/`. Atualizar o código não apaga nada.
- **Backup automático:** uma vez por dia o Junta salva uma cópia do banco em `dados/backups/` e mantém as **7 mais recentes**. Anexos e fotos são copiados para `dados/backups/arquivos/`. O dono também pode fazer um backup na hora em **Administração → Backups**.
- Para guardar os backups em outro disco ou numa pasta sincronizada (OneDrive, Google Drive), defina a variável `JUNTA_BACKUP_DIR` com o caminho.
- **Restaurar:** feche o Junta, copie o arquivo `junta-…db` escolhido para `dados/junta.db` (substituindo) e copie o conteúdo de `backups/arquivos/` para `dados/`.

## Para quem for mexer no código

```
server.js            liga tudo e sobe o servidor
lib/db.js            banco SQLite (tabelas e atualizações automáticas)
lib/accounts.js      senhas, sessões, cadastro, login, troca de senha
lib/messages.js      histórico, envio, respostas, reações, menções, não lidas, busca
lib/channels.js      servidores, canais, mensagens diretas e quem pode ver o quê
lib/previews.js      prévia de links (com bloqueio da rede interna)
lib/files.js         anexos e fotos de perfil
lib/servers.js       criar/apagar servidores e canais, perfil e apelidos
lib/voice.js         salas de voz e sinalização WebRTC
lib/realtime.js      quem está online e em cada sala
lib/admin.js         contas (dono) e backups
public/js/*.js       a interface, um arquivo por assunto (core → … → auth, nesta ordem)
test/                testes automáticos
```

**Testes automáticos:** `npm test` sobe um Junta temporário (num banco à parte, apagado no fim) e confere cadastro, permissões, menções, não lidas, respostas, reações, privacidade das mensagens diretas, busca, administração, backup e a proteção das prévias de links.

## Limites conhecidos

- **Rede:** só usa STUN do Google. Em redes corporativas ou 4G com NAT restritivo a voz, a câmera e a tela podem não conectar; nesse caso adicione um servidor TURN (ex.: Metered) em `ICE`, no topo de `public/js/core.js`.
- **Tamanho da sala:** cada pessoa conecta direto com cada outra; funciona bem até umas 5–6 pessoas. Para mais gente, seria preciso um servidor de mídia (SFU).
- **Notificações** só aparecem com o Junta aberto em alguma aba (mesmo em segundo plano).
- **Render (plano grátis):** o disco é apagado a cada atualização, então mensagens e anexos se perderiam lá. Para hospedar fora do seu PC, seria preciso um banco e um armazenamento de arquivos externos.
- Compartilhar tela pelo celular não é suportado pela maioria dos navegadores; assistir funciona.
