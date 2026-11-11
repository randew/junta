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
- **`configurar-dominio.bat`**: liga um domínio seu ao Junta deste PC (veja "Usar com amigos").
- **`iniciar.command`** e **`iniciar-com-amigos.command`**: os mesmos atalhos para Mac (ou Linux). Na primeira vez no Mac, use botão direito → **Abrir**.
- **`configurar-dominio.command`**: a versão Mac do `configurar-dominio.bat`.
- **`configurar-turn.bat`** / **`configurar-turn.command`**: liga o TURN da Cloudflare (veja "Usar com amigos").

Abra só um deles por vez. Se a pasta tiver sido baixada com `git clone`, os atalhos baixam a versão mais nova (`git pull`) antes de iniciar.

## Usar com amigos

O navegador só libera microfone, câmera e captura de tela em **HTTPS** (ou em `localhost`). Duas opções:

1. **Túnel rápido** (sem deploy), com o servidor rodando:
   ```bash
   npx cloudflared tunnel --url http://localhost:3000
   ```
   Mande o link `https://...trycloudflare.com` que aparecer.
2. **Domínio próprio** (endereço fixo, ex.: `https://juntaai.stream`), ainda rodando no seu PC:
   1. Crie uma conta grátis na [Cloudflare](https://dash.cloudflare.com), clique em **Adicionar domínio**, escolha o plano **Free** e troque os *nameservers* no site onde comprou o domínio pelos dois que a Cloudflare mostrar. Espere o domínio ficar **Active** (minutos a algumas horas).
   2. Dê dois cliques em **`configurar-dominio.bat`** (uma vez só). Ele abre o navegador para você autorizar, cria o túnel `junta`, aponta o domínio para ele e salva `tunel.yml`.
   3. Daí em diante o **`iniciar-com-amigos.bat`** usa o domínio em vez do link aleatório. Sem `tunel.yml`, ele volta ao túnel rápido.
   - Rode o túnel em **um computador só** por vez: o túnel fica ligado ao PC onde foi criado (a credencial fica em `%USERPROFILE%\.cloudflared`).
   - Ao migrar para uma VPS, troque no DNS da Cloudflare o registro do túnel por um registro **A** com o IP da VPS.
### TURN (para quem não conecta na voz)

Algumas redes (4G de certas operadoras, redes de empresa) não deixam a conexão direta da voz acontecer, e a pessoa entra na sala sem ouvir ninguém. O **TURN** é um servidor que repassa o áudio e o vídeo só dessas pessoas; o resto continua direto.

1. No painel da Cloudflare: **Realtime** (ou **Calls**) → **TURN Server** → **Create**. Guarde o **Turn Token ID** e o **API Token**.
2. Dê dois cliques em **`configurar-turn.bat`** (Mac: `configurar-turn.command`) e cole os dois valores. Ele testa na hora e salva em `dados/turn.json` (não vai para o GitHub).
3. Pronto: vale para quem entrar numa sala a partir de agora, sem reiniciar o Junta.

- Em **Voz e áudio** (engrenagem da sala), a seção **Conexão** mostra se o TURN está ativo e, para cada pessoa, se a conexão está **direta** ou **via TURN**.
- A chave fica só no servidor; o navegador recebe credenciais que valem 24 h e são renovadas sozinhas.
- Custo na Cloudflare: os primeiros 1.000 GB por mês são grátis.
- **Acompanhar o consumo:** o `configurar-turn` pergunta se você quer ver o consumo no Junta. Ele pede o **Account ID** da Cloudflare e um token com a permissão **Account Analytics: Read** (My Profile → API Tokens → Create Custom Token), testa e salva em `dados/cloudflare.json`. O consumo aparece em **Administração → TURN**: total do mês contra os 1.000 GB grátis, os últimos 7 dias e quantas conexões passam pelo TURN agora. Para trocar só esse token, rode o `configurar-turn` de novo e responda "n" sobre a chave do TURN.
- Para desligar (TURN e acompanhamento): `node scripts/configurar-turn.js --remover`. Para usar um TURN próprio (ex.: coturn numa VPS), escreva em `dados/turn.json`: `{ "iceServers": [{ "urls": ["turn:seu.servidor:3478"], "username": "...", "credential": "..." }] }`.

3. **Deploy** em Render, Railway ou Fly.io: é um app Node comum, comando de start `npm start`, porta lida de `PORT`. Veja os limites no fim.

## Layout

- **Larguras:** arraste a borda da lista de canais, da lista de membros ou do chat ao lado da sala. Duplo clique na borda volta ao padrão. Fica salvo no navegador.
- **Conversas longas:** a tela guarda no máximo 250 mensagens. Rolando para cima ou para baixo, as do outro extremo saem e são buscadas de novo quando você voltar, então o Junta não fica pesado depois de horas aberto.

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

## Cargos e permissões

Cada servidor tem os próprios cargos. Abra a engrenagem ao lado do nome do servidor → **Cargos**.

- **@todos** é o cargo base: vale para todo mundo e não pode ser apagado. Por padrão permite ver canais, enviar mensagens, anexar, reagir, mencionar @todos, entrar em salas de voz, falar e transmitir.
- **+ Novo cargo** cria um cargo. Dá para mudar nome, cor e ligar **"Mostrar separado na lista de membros"**.
- **Ordem = hierarquia:** arraste os cargos. Quem está mais acima manda em quem está abaixo; ninguém edita, dá ou tira um cargo do mesmo nível ou acima do seu, nem concede uma permissão que não tem.
- **Dar um cargo:** pela lista de membros do cargo no painel, ou clicando no nome da pessoa → cartão de perfil → **+**.
- **Permissões:** gerenciar cargos, gerenciar servidor (nome e ícone), gerenciar canais, criar convites, enviar mensagens, anexar, reagir, mencionar @todos, gerenciar mensagens (apagar as dos outros), entrar em voz, falar, transmitir tela e câmera, silenciar e desconectar pessoas, e **Administrador** (pode tudo neste servidor).
- **Permissões por canal:** em **Canais**, o botão ⚙ ao lado de cada canal. Atalhos **🔒 Privado** (só os cargos marcados veem; o canal ganha um cadeado) e **Só leitura**. Cada permissão tem três estados por cargo: ✕ negar, / herdar do cargo, ✓ permitir. Se dois cargos da pessoa discordam, o "permitir" vence.
- **@todos nas mensagens:** avisa todo mundo que vê o canal (para quem tem a permissão).
- **Moderação de voz:** com a permissão, clique no bloco de alguém na sala para **silenciar para todos** ou **desconectar**.
- **Só o dono do Junta** cria e exclui servidores, muda a posição deles na barra e gera um novo código de convite. Ele sempre tem todas as permissões.
- A voz é ponto a ponto: "falar" e "transmitir" são aplicados por quem ouve (o áudio de quem não pode falar fica mudo para os outros) e pelo servidor, que recusa começar a transmissão.

## Voz, tela e câmera

- **Câmera:** botão **Câmera** dentro da sala (720p a 30 fps). A sua imagem aparece espelhada só para você. Escolha a câmera em **Áudio**.
- **Compartilhar tela** com três predefinições:
  - **Nitidez**: até 1440p a 30 fps, até 8 Mbps, prefere AV1. Ideal para texto.
  - **Movimento**: 1080p a 60 fps, até 8 Mbps, prefere H.264. Ideal para jogos e vídeos.
  - **Equilibrado**: 1080p a 30 fps, até 5 Mbps, prefere VP9. Para internet mais fraca.
- **Áudio** (dentro da sala): microfone, **apertar para falar** (tecla padrão `V`), **supressão de ruído** por IA, **modo música** (estéreo a 128 kbps) e avisos sonoros de entrada e saída.
- **Destaque:** clique numa tela compartilhada (ou no botão ⛶ de uma câmera) para deixá-la grande, com as outras pessoas numa faixa embaixo. Clique de novo ou aperte Esc para voltar. Duplo clique: tela cheia.
- **Chat ao lado:** o botão **Chat** da sala abre um canal de texto do servidor ao lado do palco, para conversar enquanto assiste. Escolha o canal no topo do chat. Se você deixar aberto, ele volta sozinho da próxima vez que estiver na sala.
- **Janela flutuante:** o botão ▣ de uma tela ou câmera abre a transmissão numa janelinha por cima de tudo, para continuar vendo enquanto usa outro programa. No Chrome e no Edge ela tem os botões de microfone e de sair; no Safari é o picture-in-picture padrão.
- **Economia de banda:** quando você não está vendo as transmissões (outro canal aberto, aba minimizada), o Junta pede para quem transmite pausar o vídeo só para você, depois de 3 segundos. O som continua. Ao voltar, a imagem retorna em instantes. Isso alivia o upload de quem transmite.
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
lib/perms.js         cargos e cálculo das permissões
lib/roles.js         criar, editar, ordenar e dar cargos; permissões por canal
lib/previews.js      prévia de links (com bloqueio da rede interna)
lib/files.js         anexos e fotos de perfil
lib/servers.js       criar/apagar servidores e canais, perfil e apelidos
lib/voice.js         salas de voz e sinalização WebRTC
lib/realtime.js      quem está online e em cada sala
lib/admin.js         contas (dono) e backups
public/js/*.js       a interface, um arquivo por assunto (core → … → auth, nesta ordem; panels.js: larguras e chat ao lado da sala)
test/                testes automáticos
```

**Testes automáticos:** `npm test` sobe um Junta temporário (num banco à parte, apagado no fim) e confere cadastro, cargos e permissões (canais privados, só leitura, hierarquia, voz), menções, não lidas, respostas, reações, privacidade das mensagens diretas, busca, administração, backup e a proteção das prévias de links.

## Limites conhecidos

- **Rede:** sem TURN configurado, só há conexão direta. Em redes corporativas ou 4G com NAT restritivo, a voz, a câmera e a tela podem não conectar; configure o TURN (veja "Usar com amigos").
- **Tamanho da sala:** cada pessoa conecta direto com cada outra; funciona bem até umas 5–6 pessoas. Para mais gente, seria preciso um servidor de mídia (SFU).
- **Notificações** só aparecem com o Junta aberto em alguma aba (mesmo em segundo plano).
- **Render (plano grátis):** o disco é apagado a cada atualização, então mensagens e anexos se perderiam lá. Para hospedar fora do seu PC, seria preciso um banco e um armazenamento de arquivos externos.
- Compartilhar tela pelo celular não é suportado pela maioria dos navegadores; assistir funciona.
