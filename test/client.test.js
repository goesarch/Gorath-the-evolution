// Roda o script real de public/index.html num contexto simulado (sem WebGL/DOM) e verifica o comportamento do cliente.
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), vm = require('vm'), path = require('path');
const code = [...fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8').matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1];
function load(opt = {}) {
  const f = function () {}; const stub = new Proxy(f, { get: (t, k) => k === Symbol.toPrimitive ? () => 0 : k === 'length' ? stub : t[k] !== undefined ? t[k] : stub, set: (t, k, v) => { t[k] = v; return true; }, apply: () => stub, construct: () => stub });
  const store = Object.assign({}, opt.store), calls = { req: 0, exit: 0 }, st = { fs: undefined, now: 0 };
  const docEl = opt.noFs ? {} : { requestFullscreen() { calls.req++; st.fs = {}; return Promise.resolve(); } };
  const mkEl = () => new Proxy(function () {}, { get: (t, k) => k === Symbol.toPrimitive ? () => 0 : k === 'length' ? stub : t[k] !== undefined ? t[k] : stub, set: (t, k, v) => { t[k] = v; return true; }, apply: () => stub, construct: () => stub }), els = {};
  const doc = new Proxy(function () {}, { get: (t, k) => k === 'getElementById' ? (id => els[id] || (els[id] = mkEl())) : k === 'documentElement' ? docEl : (k === 'fullscreenElement' || k === 'webkitFullscreenElement') ? st.fs : k === 'exitFullscreen' ? () => { calls.exit++; st.fs = undefined; } : k === 'addEventListener' ? () => {} : stub, set: () => true, apply: () => stub, construct: () => stub });
  const LS = {}, H = {}, fake = { on(e, fn) { H[e] = fn; }, emit() {}, io: { on() {} } };
  const ctx = vm.createContext({ THREE: stub, document: doc, window: stub, navigator: { userAgent: 'Android' }, io: () => fake, matchMedia: () => ({ matches: false }), requestAnimationFrame() {}, addEventListener(e, f) { (LS[e] = LS[e] || []).push(f); }, performance: { now: () => st.now }, localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } }, location: { host: 'x', hostname: 'x' }, innerWidth: 800, innerHeight: 600, devicePixelRatio: 1, setTimeout, clearTimeout });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/world.js'), 'utf8'), ctx);
  vm.runInContext(code, ctx);
  return { ctx, H, store, calls, st, fire: (e, ev) => (LS[e] || []).forEach(f => f(ev)), run: c => vm.runInContext(c, ctx) };
}
const spy = run => run("var __n=0,__l=0,__s=0,__sent=[];{const g=gorAI,l=gorLerp;gorAI=function(){__n++;return g.apply(this,arguments)};gorLerp=function(){__l++;return l.apply(this,arguments)}}applySpawn=function(){__s++};send=function(m){__sent.push(m)}");

test('ONLINE: anfitrião (vaga 0) não executa gorAI; só interpola. SOLO: executa a IA local', () => {
  const { run } = load(); spy(run);
  run("room='ABC';started=true;me.slot=0;players={};loop();loop();loop()");
  assert.strictEqual(run('__n'), 0, 'gorAI não pode rodar online'); assert.strictEqual(run('__l'), 3, 'interpolação roda todo quadro');
  run("room=null;loop()"); assert.strictEqual(run('__n'), 1, 'solo usa a IA local');
});
test('ONLINE: gorAI e caught() são inertes mesmo se chamados à força (defesa em profundidade)', () => {
  const { run } = load(); spy(run);
  run("room='ABC';gorAI(.05,0,[{id:'x',x:0,z:0,run:true}]);caught({id:'x',x:0,z:0})");
  assert.strictEqual(run('gcool'), 0); assert.strictEqual(run('gs'), 'patrol'); assert.strictEqual(run('__sent.length'), 0, 'cliente não envia captura'); assert.strictEqual(run('__s'), 0);
});
test('SOLO: captura vira agarrão (câmera presa, jumpscare) e só reaparece no fim', () => {
  const { run, st } = load(); spy(run); run("room=null;started=true;caught({id:me.id,x:0,z:0})");
  assert.strictEqual(run('capLock'), true); assert.strictEqual(run('gs'), 'grab'); run('loop()'); assert.strictEqual(run('__s'), 0, 'ainda agarrado');
  run("keys.KeyW=1;loop()"); assert.strictEqual(run('meMv'), false, 'controles travados durante o agarrão');
  st.now = 3000; run('loop()'); assert.strictEqual(run('__s'), 1, 'reaparece no fim'); assert.strictEqual(run('capLock'), false); assert.strictEqual(run('gs'), 'investigate');
  run("caught({id:me.id,x:0,z:0})"); assert.strictEqual(run('capLock'), true, 'pode ser pego de novo depois');
});
test('agarrão online: cap/capend só do servidor, 1 jumpscare por evento, só o alvo é preso', () => {
  const { run } = load(); spy(run); run("var __sc=0;scareSound=function(){__sc++};room='ABC'");
  const cap = (who, seq, id = 'srv') => run(`onMsg({t:'cap',id:'${id}',who:${who},bx:5,bz:6,yaw:1,dur:2600,seq:${seq}})`);
  cap("'outro'", 1, 'evil'); assert.strictEqual(run('cap'), null, 'forjado ignorado');
  cap("'outro'", 1); assert.strictEqual(run('capLock'), false, 'outros assistem sem travar'); assert.strictEqual(run('__sc'), 1);
  cap("'outro'", 1); assert.strictEqual(run('__sc'), 1, 'duplicata ignorada'); run("onMsg({t:'capend',id:'srv',who:'outro'})"); assert.strictEqual(run('cap'), null); assert.strictEqual(run('__s'), 0);
  cap('me.id', 2); assert.strictEqual(run('capLock'), true); assert.strictEqual(run('__sc'), 2); cap('me.id', 2); assert.strictEqual(run('__sc'), 2);
  run("onMsg({t:'capend',id:'evil',who:me.id})"); assert.strictEqual(run('capLock'), true, 'fim forjado ignorado');
  run("onMsg({t:'capend',id:'srv',who:me.id})"); assert.strictEqual(run('capLock'), false); assert.strictEqual(run('__s'), 1, 'respawn');
});
test('estado do Boss: só aceita do servidor e só estados válidos', () => {
  const { run } = load(); run("room='ABC'");
  run("onMsg({t:'gor',id:'evil',x:1,z:1,y:0,s:'chase'})"); assert.strictEqual(run('gs'), 'patrol');
  run("onMsg({t:'gor',id:'srv',x:1,z:1,y:0,s:'xxx'})"); assert.strictEqual(run('gs'), 'patrol');
  run("onMsg({t:'gor',id:'srv',x:1,z:1,y:0,s:'chase'})"); assert.strictEqual(run('gs'), 'chase');
  run("onMsg({t:'start',id:'evil'})"); assert.strictEqual(run('started'), false, 'início forjado ignorado');
});
test('entrada/saída de jogadores e reconexão: Boss, anotações, porta e partida restaurados', () => {
  const { run, H } = load(); run("room='ABC'");
  run("onMsg({t:'hello',id:'zz',p:{id:'zz',name:'Zé',ci:1,slot:1,ready:false}})"); assert.deepStrictEqual(JSON.parse(run("JSON.stringify(Object.keys(players))")), ['zz']);
  run("onMsg({t:'bye',id:'zz'})"); assert.strictEqual(run('Object.keys(players).length'), 0);
  assert.strictEqual(typeof H.joined, 'function');
  H.joined({ slot: 2, started: true, notes: [true, false, true], door: true, host: 'a', me: { x: 3, z: 4 }, boss: { x: 5, z: 6, y: 1, s: 'alert' },
    players: [{ id: 'a', name: 'A', ci: 0, slot: 0, ready: true, x: 1, z: 2, fy: 0 }, { id: run('me.id'), name: 'Eu', ci: 2, slot: 2, ready: true, x: 3, z: 4, fy: 0 }] });
  assert.strictEqual(run('started'), true, 'partida retomada'); assert.strictEqual(run('me.slot'), 2); assert.strictEqual(run('found'), 2); assert.strictEqual(run('opened'), true);
  assert.strictEqual(run('gs'), 'alert'); assert.strictEqual(run('players.a.seen'), 1);
});

test('CONTROLES: remapear, conflito, salvar, restaurar e usar a tecla nova em jogo', () => {
  const { run, store } = load();
  run("listenKey='jump';bindKey('KeyQ')"); assert.strictEqual(run('KB.jump'), 'KeyQ'); assert.strictEqual(JSON.parse(store.echo_keys).jump, 'KeyQ');
  run("listenKey='run';bindKey('KeyW')"); assert.strictEqual(run('KB.run'), 'ShiftLeft', 'conflito recusado'); assert.ok(run('kbMsg').includes('frente'));
  run("listenKey='run';bindKey('Escape')"); assert.strictEqual(run('KB.run'), 'ShiftLeft', 'Esc cancela'); assert.strictEqual(run('listenKey'), null);
  run("$('menu').onclick({target:{dataset:{a:'kbreset'}}})"); assert.strictEqual(run('KB.jump'), 'Space'); assert.strictEqual(JSON.parse(store.echo_keys).jump, 'Space');
  assert.strictEqual(run('KB.interact'), 'KeyE', 'E é a interação padrão');
});
test('CONTROLES: preferências salvas são carregadas na próxima sessão', () => {
  const { run } = load({ store: { echo_keys: JSON.stringify({ fwd: 'KeyI', interact: 'KeyU', bogus: 'x' }) } });
  assert.strictEqual(run('KB.fwd'), 'KeyI'); assert.strictEqual(run('KB.interact'), 'KeyU'); assert.strictEqual(run('KB.back'), 'KeyS');
});
test('CONTROLES: a tecla remapeada move o jogador e a antiga deixa de mover', () => {
  const { run } = load(); run("clock.getDelta=()=>.016;room=null;started=true;KB.fwd='KeyI';keys.KeyW=1;loop()");
  assert.strictEqual(run('meMv'), false, 'W não move mais'); run("keys.KeyI=1;loop()"); assert.strictEqual(run('meMv'), true);
});
test('TELA CHEIA: entra/sai, salva preferência, não mexe em partida nem conexão', () => {
  const { run, calls, store, st } = load(); run("room='ABC';started=true;const b={textContent:''};globalThis.__b=b;toggleFs(b)");
  assert.strictEqual(calls.req, 1); assert.strictEqual(store.echo_fs, '1');
  run("fsSync()"); assert.strictEqual(run('started'), true); assert.strictEqual(run('room'), 'ABC');
  run("toggleFs(__b)"); assert.strictEqual(calls.exit, 1); assert.strictEqual(store.echo_fs, '0');
});
test('TELA CHEIA: navegador sem suporte mostra mensagem (iPhone orienta Tela de Início)', () => {
  const { run } = load({ noFs: true }); run("globalThis.__b={textContent:''};toggleFs(__b)"); assert.ok(run('__b.textContent').includes('não suportada'));
});
test('PAPÉIS: contorno só após o aviso (servidor) ou 20 s (solo), some ao coletar tudo', () => {
  const { run, st } = load(); run("noteMeshes.length=0;[0,1,2].forEach(()=>noteMeshes.push({visible:true,userData:{o:{visible:false,material:{opacity:0}}}}));room='ABC';found=0");
  run("hintTick(1)"); assert.strictEqual(run('noteMeshes[0].userData.o.visible'), false, 'antes dos 20 s: sem contorno');
  run("onMsg({t:'hint',id:'evil'})"); assert.strictEqual(run('hintOn'), false, 'aviso forjado ignorado');
  run("onMsg({t:'hint',id:'srv'});hintTick(1)"); assert.strictEqual(run('noteMeshes.every(m=>m.userData.o.visible)'), true);
  run("found=3;hintTick(1)"); assert.strictEqual(run('noteMeshes.some(m=>m.userData.o.visible)'), false, 'tudo coletado: sem indicação');
  run("room=null;found=0;hintOn=false;begin();"); st.now = 19000; run("hintTick(1)"); assert.strictEqual(run('hintOn'), false); st.now = 21000; run("hintTick(1)"); assert.strictEqual(run('hintOn'), true, 'solo: 20 s locais');
  run("applySnap({notes:[false,false,false],door:false,hint:true});"); assert.strictEqual(run('hintOn'), true, 'reconexão restaura o contorno');
});
test('SALA 2-4: criador define o máximo e a interface mostra as vagas', () => {
  const { run, H } = load(); H.joined({ max: 2, slot: 0, started: false, notes: [false, false, false], door: false, host: 'a', players: [{ id: 'a', name: 'A', ci: 0, slot: 0, ready: false }] });
  assert.strictEqual(run('roomMax'), 2);
});

// ====== v0.7/v0.8 ======
test('MISSÃO (cliente solo): papéis -> casa -> 3 pistas -> painel -> conclusão -> jogar de novo / menu', () => {
  const { run } = load(); run("room=null;started=true;found=0;fy=0;pos.x=0;pos.z=10;hintTick(1)"); assert.ok(run('missionText()').includes('anotações'));
  run("found=3;hintTick(1)"); assert.strictEqual(run('mission.phase'), 'house'); assert.ok(run('missionText()').includes('cabana'));
  run("pos.x=0;pos.z=-13;hintTick(1)"); assert.strictEqual(run('mission.phase'), 'clues');
  const MO = JSON.parse(run('JSON.stringify(WORLD.MOBJ)'));
  MO.forEach((o, i) => { run(`nearest=function(){return '${o.id}'};pos.x=${o.x};pos.z=${o.z};noteOpen=0;interact()`); assert.strictEqual(run(`mission.clues[${i}]`), true, 'pista ' + i); });
  assert.strictEqual(run('mission.phase'), 'panel'); run("nearest=function(){return 'panel'};pos.x=0;pos.z=-15;noteOpen=0;interact()");
  assert.strictEqual(run('mission.phase'), 'done'); assert.strictEqual(run('endShown'), true); assert.ok(run('missionText()').includes('concluída'));
  run("$('endAgain').onclick()"); assert.deepStrictEqual([run('mission.phase'), run('endShown'), run('found'), run('started')], ['notes', false, 0, true]);
  run("mission.phase='done';endShown=true;$('endMenu').onclick()"); assert.strictEqual(run('started'), false);
});
test('MISSÃO (cliente online): estado vem do servidor, reconexão após conclusão mostra a tela, reset volta ao lobby', () => {
  const { run, H } = load(); run("room='ABC'");
  run("onMsg({t:'mis',id:'evil',phase:'done',clues:[true,true,true],seq:9})"); assert.strictEqual(run('mission.phase'), 'notes');
  run("onMsg({t:'mis',id:'srv',phase:'clues',clues:[true,false,false],seq:3})"); assert.ok(run('missionText()').includes('(1/3)'));
  run("onMsg({t:'mis',id:'srv',phase:'house',clues:[false,false,false],seq:2})"); assert.strictEqual(run('mission.phase'), 'clues', 'mensagem antiga ignorada');
  H.joined({ max: 2, slot: 0, started: true, notes: [true, true, true], door: true, mission: { phase: 'done', clues: [true, true, true], seq: 7 }, host: 'a', me: { x: 0, z: 0 }, boss: { x: 1, z: 1, y: 0, s: 'patrol' }, players: [{ id: run('me.id'), name: 'E', ci: 0, slot: 0, ready: true, x: 0, z: 0, fy: 0 }] });
  assert.strictEqual(run('endShown'), true); assert.strictEqual(run('found'), 3);
  run("onMsg({t:'reset',id:'srv'})"); assert.deepStrictEqual([run('mission.phase'), run('endShown'), run('started'), run('found'), run('opened')], ['notes', false, false, 0, false]);
});
test('PORTA (cliente): segue o servidor, snapshot restaura, forjado ignorado; colisões da casa', () => {
  const { run } = load(); run("room='ABC'");
  run("onMsg({t:'door',id:'evil',open:true})"); assert.strictEqual(run('opened'), false); run("onMsg({t:'door',id:'srv',open:true})"); assert.strictEqual(run('opened'), true); run("onMsg({t:'door',id:'srv',open:false})"); assert.strictEqual(run('opened'), false);
  run("applySnap({notes:[false,false,false],door:true})"); assert.strictEqual(run('opened'), true);
  run("fy=0;opened=false;pos.x=0;pos.z=-9"); assert.strictEqual(run('boxBlocked(0,-11.6)'), true, 'porta fechada bloqueia'); run("opened=true"); assert.strictEqual(run('boxBlocked(0,-11.6)'), false, 'porta aberta passa');
  run("pos.x=-5;pos.z=-14"); assert.strictEqual(run('boxBlocked(-3.4,-14)'), true, 'parede externa bloqueia'); run("fy=3.5"); assert.strictEqual(run('boxBlocked(-3.4,-14)'), false, 'no telhado passa');
  run("fy=0;opened=false;pos.x=0;pos.z=-11.6"); assert.strictEqual(run('boxBlocked(0,-11.65)'), false, 'quem já está na margem da porta nunca fica preso');
});
test('ESCADA (cliente solo): pegar, carregar, posicionar, subir, descer; sem duplicar nem posicionar em lugar inválido', () => {
  const { run } = load(); run("room=null;started=true;fy=0;pos.x=3;pos.z=-3.5;nearest=function(){return 'lad'};interact()");
  assert.deepStrictEqual([run('lad.st'), run('lad.holder')], ['carried', run('me.id')]); const seq = run('lad.seq'); run("ladAct('pick')"); assert.strictEqual(run('lad.seq'), seq, 'não duplica');
  assert.strictEqual(run("climbStep(0,-1,.05)"), false, 'sem escada posicionada não sobe');
  run("pos.x=10;pos.z=-10;nearest=function(){return 'place'};interact()"); assert.strictEqual(run('lad.st'), 'carried', 'posição inválida');
  run("pos.x=0;pos.z=-17.4;nearest=function(){return 'place'};interact()"); assert.deepStrictEqual([run('lad.st'), run('lad.spot')], ['placed', 0]);
  run("nearest=function(){return null};fy=0;pos.x=0;pos.z=-17.4"); for (let i = 0; i < 200 && run('fy') < 3.5; i++) run('climbStep(0,-1,.05)');
  assert.strictEqual(run('fy'), 3.5); assert.strictEqual(run('climb'), null, 'saiu no topo'); assert.ok(Math.abs(run('pos.z') + 15.6) < 1e-6, 'pousou no telhado'); assert.strictEqual(run('groundAt(pos.x,pos.z)'), 3.5);
  for (let i = 0; i < 200 && run('fy') > 0; i++) run('climbStep(0,1,.05)'); assert.strictEqual(run('fy'), 0, 'desceu');
  run("pos.x=0;pos.z=-17.4;nearest=function(){return 'lad'};interact()"); assert.strictEqual(run('lad.st'), 'carried', 'pode recolher'); run("nearest=function(){return 'drop'};interact()"); assert.strictEqual(run('lad.st'), 'ground');
});
test('ESCADA (cliente online): estado só do servidor, versão antiga ignorada, carregador remoto', () => {
  const { run } = load(); run("room='ABC';started=true");
  run("onMsg({t:'lad',id:'evil',st:'carried',holder:'x',x:0,z:0,spot:-1,seq:5})"); assert.strictEqual(run('lad.st'), 'ground');
  run("onMsg({t:'lad',id:'srv',st:'carried',holder:'zz',x:0,z:0,spot:-1,seq:5})"); assert.strictEqual(run('lad.holder'), 'zz'); run("onMsg({t:'lad',id:'srv',st:'ground',holder:null,x:1,z:1,spot:-1,seq:3})"); assert.strictEqual(run('lad.holder'), 'zz', 'seq antigo ignorado');
  run("clock.getDelta=()=>.016;loop()"); run("onMsg({t:'lad',id:'srv',st:'placed',holder:null,x:0,z:0,spot:3,seq:6})"); run('loop()'); assert.strictEqual(run('lad.spot'), 3);
});
test('AGACHAR, atalho F11 e botões de celular', () => {
  const { run, fire, calls } = load(); run("room=null;started=true;clock.getDelta=()=>.016");
  run("keys.KeyC=1;keys.ShiftLeft=1;keys.KeyW=1;loop()"); assert.strictEqual(run('crouching'), true); assert.strictEqual(run('meRun'), false, 'agachado não corre');
  run("keys.Space=1;loop()"); assert.strictEqual(run('vy'), 0, 'agachado não pula');
  run("keys.KeyC=0;keys.ShiftLeft=0;keys.KeyW=0;loop()"); assert.ok(run('vy') > 0, 'em pé pula');
  run("keys.Space=0;fy=0;vy=0;grounded=true;crouchBtn=false;$('bC').ontouchstart({preventDefault(){}});loop()"); assert.strictEqual(run('crouching'), true, 'botão de agachar (celular)');
  let pd = 0; fire('keydown', { code: 'F11', preventDefault() { pd++; } }); assert.strictEqual(calls.req, 1); assert.strictEqual(pd, 1, 'F11 não aciona a tela cheia do navegador por cima');
  run("started=false"); fire('keydown', { code: 'F11', preventDefault() {} }); assert.strictEqual(calls.exit, 1, 'F11 também funciona nos menus (alterna)');
  run("KB.fs='KeyP'"); fire('keydown', { code: 'F11', preventDefault() {} }); assert.strictEqual(calls.req, 1, 'F11 deixa de valer após remapear'); fire('keydown', { code: 'KeyP', preventDefault() {} }); assert.strictEqual(calls.req, 2);
  run("started=true;crouchBtn=false;noteOpen=0;nearest=function(){return 'lad'};loop()"); assert.strictEqual(run("$('bE').textContent"), 'PEGAR', 'botão contextual muda');
  run("nearest=function(){return 'place'};loop()"); assert.strictEqual(run("$('bE').textContent"), 'POSIC.'); run("nearest=function(){return null};loop()"); assert.strictEqual(run("$('bE').textContent"), 'E');
});
test('PERSISTÊNCIA: tecla de agachar/tela cheia remapeadas são salvas e carregadas', () => {
  const a = load(); a.run("listenKey='crouch';bindKey('KeyZ');listenKey='fs';bindKey('KeyP')"); const b = load({ store: a.store });
  assert.strictEqual(b.run('KB.crouch'), 'KeyZ'); assert.strictEqual(b.run('KB.fs'), 'KeyP'); assert.strictEqual(load().run('KB.fs'), 'F11'); assert.strictEqual(load().run('KB.crouch'), 'KeyC');
});
