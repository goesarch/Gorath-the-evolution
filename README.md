# ECHOES: THE EVOLUTION — v0.8

Jogo 3D de terror cooperativo (2 a 4 jogadores) no navegador. Servidor: Node.js + Express + Socket.IO. Funciona no PC e no celular.

## Estrutura
```
echoes-server/
├─ server.js          rede (Express + Socket.IO), salas, tick do Gorath a 20 Hz
├─ game.js            regras autoritativas: salas, missão, porta, escada, Gorath, agarrão
├─ public/
│  ├─ index.html      o jogo (cliente)
│  └─ world.js        mundo compartilhado cliente+servidor (casa, porta, escada, missão)
├─ test/              testes automáticos (npm test)
├─ render.yaml        configuração para publicar no Render (gratuito)
└─ package.json
```

## Instalar e iniciar (PC)
1. Instale o Node.js 18+ (https://nodejs.org).
2. Na pasta do projeto: `npm install` e depois `npm start`.
3. Abra `http://localhost:3000`. O terminal também mostra o endereço da rede (ex.: `http://192.168.0.15:3000`).
4. Testes: `npm test` (54 testes, não precisam de internet nem de `npm install`).

## Testar no celular (mesma Wi-Fi)
1. PC e celular na mesma rede Wi-Fi (não use Wi-Fi de visitantes: costuma isolar aparelhos).
2. No celular, abra o endereço "Mesma Wi-Fi" mostrado no terminal. Se não abrir, libere a porta 3000 no firewall do PC.
3. Um jogador usa CRIAR SALA (escolhe 2, 3 ou 4 jogadores) e passa o código; os outros usam ENTRAR EM SALA. Todos marcam PRONTO; o anfitrião (★) inicia.

## Publicar de graça na internet (Render) — passo a passo
Exige contas suas; ninguém consegue fazer isso por você.
1. Crie conta no GitHub e um repositório vazio. Envie TODO o conteúdo da pasta `echoes-server` (sem `node_modules`).
2. Crie conta em https://render.com entrando com o GitHub.
3. No Render: **New +** > **Blueprint** > escolha o repositório > **Apply** (o `render.yaml` preenche tudo). Manual: **Web Service**, Runtime Node, Build `npm install`, Start `npm start`, Instance **Free**, Health Check `/health`.
4. Quando terminar, o endereço `https://nome.onrender.com` aparece no topo. Envie aos amigos.
Plano gratuito: o serviço "dorme" após ~15 min parado (primeiro acesso demora ~1 min). A porta vem de `PORT`; não há chaves nem segredos.

## Como é a missão
1. **Papéis:** achem as 3 anotações na floresta (contorno verde pulsante após 20 s). Todos veem o progresso.
2. **Casa:** com os 3 papéis, o objetivo muda para entrar na cabana. A porta abre/fecha com E (o servidor sincroniza e há 0,7 s entre trocas).
3. **Investigação:** dentro da casa (sala principal + laboratório) examinem o mural, o caderno e o gravador.
4. **Painel:** com as 3 pistas, ativem o painel de contenção no fundo do laboratório.
5. **Conclusão:** tela "MISSÃO CONCLUÍDA" para todos, com som. O anfitrião pode JOGAR NOVAMENTE (volta ao lobby da mesma sala); qualquer um pode VOLTAR AO MENU. O Gorath para ao concluir.

## Mecânicas
- **Esconderijo:** o servidor calcula a visão do Gorath com as paredes e a porta. Dentro da casa ninguém é visto nem ouvido; com a porta aberta só fica exposto quem está a menos de 2,5 m dela. O Gorath nunca entra na casa. Perdeu de vista: procura em volta da última posição e volta à patrulha; viu de novo: persegue.
- **Agachar:** (C / botão ⤓) em silêncio e mais lento; o Gorath só vê de perto (9 m em vez de 16 m).
- **Escada portátil:** pegue (E), carregue (todos veem), leve até a casa (3 pontos) ou à árvore alta (mirante) e aperte E sobre a marca verde. Ande para frente para subir, para trás para descer. Só uma escada, um carregador por vez; se quem carrega cair ou for agarrado, ela fica no chão.
- **Agarrão do Gorath:** o servidor decide a captura e dura 2,6 s: Gorath fecha os braços, a vítima é erguida (todos veem), a câmera dela vai ao rosto do Gorath com susto visual e sonoro; depois ela volta ao ponto de partida.
- **Controles (Configurações > CONTROLES):** frente, trás, esquerda, direita, pular, correr, agachar, interagir (E), lanterna, tela cheia (F11). Conflitos recusados; restaurar padrão; salvo no aparelho. Celular: joystick, arrastar para olhar e botões (E contextual: PEGAR/SOLTAR/POSIC./PORTA/EXAMINAR/ATIVAR, correr, lanterna, pular, agachar, tela cheia).
- **Tela cheia:** botão nas Configurações (ATIVADA/DESATIVADA), atalho F11 (também nos menus) e botão ⛶ no celular. Não reinicia a partida nem desconecta. Se o navegador não suporta (ex.: iPhone Safari), aparece uma mensagem.

## Testes executados (`npm test`, 54 testes, todos passando neste ambiente)
Lógica do servidor, o servidor com express/socket.io SIMULADOS e o script real do cliente num navegador SIMULADO. Cobrem: papéis, fases da missão, pistas, painel, conclusão e reinício; porta (alternar, intervalo, sincronização, snapshot); colisões da casa (entrada, passagem entre salas, paredes externas, telhado); esconderijo (visão, porta aberta/fechada, barulho, agachado, investigar e desistir, retomar perseguição, Boss nunca dentro da casa); escada (pegar, carregar, soltar, posicionar, subir/descer, sem duplicar, solta ao cair/ser agarrado); agarrão (um por vez, vítima congelada, fim no spawn, duplicata ignorada, mensagens forjadas ignoradas); salas de 2, 3 e 4; reconexão; controles, F11, tela cheia, persistência.

## O que NÃO foi verificado (limitações reais)
- Nada foi rodado em navegador/aparelho real por mim: não vi a casa, a escada, a animação do agarrão, o jumpscare, a iluminação nem o desempenho em Android. Os testes usam navegador simulado (sem WebGL).
- `npm install` e `npm start` não puderam rodar onde o código foi escrito (sem internet); `/health`, a página inicial e o Socket.IO real não foram exercitados. Rode no seu computador.
- Teste real com 2–4 aparelhos, reconexão com internet real e publicação no Render dependem de você.
- Ajustes de sensação prováveis: escalada, tamanho dos cômodos (2,2 m de profundidade cada), brilho da luz interna, intensidade do susto.
- O telhado cônico virou telhado plano caminhável (mesma posição, tamanho e cor) para a escada funcionar.
- Se alguém recolhe a escada enquanto outro sobe, quem subia cai. Fechar a porta sobre alguém não o prende (ele consegue sair).
- A IA do Gorath usa deslocamento simples; pode ficar rodeando uma parede por alguns segundos antes de desistir.
- Agachar e escada ainda não têm animação própria completa no corpo dos jogadores remotos (só pose simples).
- O mapa e o texto da história são curtos (uma missão); o jogo não tem as fases/mapas/evolução do Boss do plano original.
