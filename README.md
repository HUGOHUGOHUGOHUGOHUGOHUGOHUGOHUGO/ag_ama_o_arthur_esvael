# Brotato-like Multiplayer Online (protótipo)

Protótipo de jogo online multiplayer no estilo *Brotato*: arena única, ondas de
inimigos, ataque automático (pistola + espada). O servidor é **autoritativo**
(toda a lógica roda nele), os clientes só enviam input e recebem o estado do
jogo via WebSocket — assim dá pra jogar com gente em qualquer lugar do mundo,
não só na mesma rede.

## Rodando localmente

Requisito: [Node.js](https://nodejs.org) 18 ou mais recente.

```bash
npm install
npm start
```

Abra `http://localhost:3000` no navegador. Você cai numa tela de lobby: dá pra
**criar uma sala nova** (gera um código de 4 letras/números) ou **entrar numa
sala existente** digitando o código. Cada sala é um jogo isolado — várias
salas podem rodar ao mesmo tempo no mesmo servidor, tipo uma LAN house virtual.
Quem estiver na mesma sala joga junto; quem estiver em salas diferentes não se
vê.

## Colocando no GitHub

```bash
cd brotato-multiplayer
git init
git add .
git commit -m "Primeiro commit: protótipo multiplayer online"
```

Depois, no site do GitHub:
1. Clique em **New repository** (botão verde, ou "+" no canto superior direito).
2. Dê um nome (ex: `brotato-multiplayer`), deixe público ou privado, **não**
   marque "Add a README" (você já tem um).
3. Clique em **Create repository**.
4. O GitHub vai te mostrar comandos parecidos com estes — rode no terminal,
   dentro da pasta do projeto:

```bash
git remote add origin https://github.com/SEU-USUARIO/brotato-multiplayer.git
git branch -M main
git push -u origin main
```

Pronto, o código está no GitHub. O `.gitignore` já está configurado pra não
subir a pasta `node_modules` (cada pessoa que clonar roda `npm install` pra
gerar a dela).

**Importante:** isso só sobe o *código*. Pra alguém jogar com você pela
internet, alguém precisa estar com o servidor **rodando** (veja a seção
abaixo) — o GitHub não roda nada sozinho, só guarda os arquivos.

## Landing page (site de apresentação)

Tem uma página de apresentação em `docs/index.html` — separada do jogo em si,
serve pra ter um link bonito pra divulgar antes de mandar as pessoas pro
lobby. Ela é 100% estática (HTML/CSS/JS puro), então dá pra hospedar de graça
no **GitHub Pages** (o jogo em si continua precisando do Render/Railway, como
explicado acima, porque tem servidor).

**Antes de publicar**, edite `docs/index.html` e troque:
- `SEU-USUARIO` (2 lugares) pelo seu usuário do GitHub
- `SEU-JOGO.onrender.com` pela URL real do seu servidor rodando (a que o
  Render te deu)

**Publicando no GitHub Pages:**
1. Suba o projeto pro GitHub normalmente (seção acima).
2. No repositório, vá em **Settings → Pages**.
3. Em "Source", escolha **Deploy from a branch**.
4. Branch: `main`, pasta: **`/docs`** (não a raiz — é onde a landing page está).
5. Salve. Em ~1 minuto o GitHub te dá uma URL tipo
   `https://seu-usuario.github.io/brotato-multiplayer/`.

Essa URL é só a vitrine; o botão "JOGAR AGORA" nela leva pro jogo de verdade,
hospedado no Render.



O GitHub guarda o **código**, mas não deixa o servidor rodando 24/7 (GitHub
Pages só serve arquivos estáticos, sem WebSocket/Node). Duas opções simples:

**Opção rápida (teste pontual, sem deploy):**
1. Rode `npm start` na sua máquina.
2. Instale o [ngrok](https://ngrok.com/) e rode `ngrok http 3000`.
3. Mande o link `https://xxxx.ngrok-free.app` gerado pro seu amigo.

**Opção definitiva (servidor sempre online):**
Suba o repositório pro GitHub e conecte num host gratuito com suporte a
Node/WebSocket, por exemplo [Render](https://render.com) ou
[Railway](https://railway.app):
1. Crie o repo no GitHub e dê `git push`.
2. No Render/Railway: "New Web Service" → conecte o repo.
3. Build command: `npm install` — Start command: `npm start`.
4. Ele te dá uma URL pública (`https://seu-jogo.onrender.com`) — é só abrir
   essa URL, criar uma sala, mandar o código pros seus amigos e eles entram
   pela mesma URL.

*(GitHub Pages **não** serve pra isso porque não roda backend — só HTML/CSS/JS
estático. Você ainda pode manter o repositório no GitHub normalmente, só o
"rodar o servidor" que precisa ser em outro lugar.)*

## Controles

- Mover: `WASD` ou setas
- Ataque: automático (pistola dispara no inimigo mais próximo, espada bate em
  área ao redor do personagem)

## O que já tem (protótipo)

- Multiplayer real via WebSocket, servidor autoritativo
- Tela de lobby: criar sala (gera código) ou entrar com código de 4 caracteres
- Várias salas simultâneas e isoladas no mesmo servidor
- Ondas de inimigos crescentes, spawnando nas bordas do mapa
- 2 armas automáticas (pistola + espada em área)
- Vida, respawn após 3s ao morrer
- Sincronização de todos os jogadores da mesma sala

## Ideias pra evoluir depois

- Loja entre ondas (comprar armas/upgrades, como no Brotato original)
- Mais tipos de arma e itens passivos
- XP e level up
- Diferentes personagens/classes
- Salas (várias partidas simultâneas) em vez de uma arena global
- Interpolação de movimento no cliente para deixar mais suave em conexões
  ruins
