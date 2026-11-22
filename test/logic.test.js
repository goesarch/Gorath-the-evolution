// Testes da lógica (sem rede). Rodar: npm test
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), vm = require('vm'), path = require('path');
const { Room, Boss, buildSolids, SPAWNS, NOTES, DOOR, GRAB_MS, WORLD } = require('../game');
const SOLIDS = buildSolids();
const mk = () => new Room('ABC', SOLIDS);
const join = (r, id, o = {}) => r.join({ id, name: id, ci: 0, ...o }).p;
const ready4 = r => { const ps = ['a', 'b', 'c', 'd'].map(i => join(r, i)); ps.forEach(p => r.setReady(p, true)); return ps; };

test('obstáculos do servidor == obstáculos do cliente (mesma semente e ordem)', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1];
  const mkStub = () => { const f = function () {}; return new Proxy(f, { get: (t, k) => k === Symbol.toPrimitive ? () => 0 : t[k] !== undefined ? t[k] : stub, set: (t, k, v) => { t[k] = v; return true; }, apply: () => stub, construct: () => stub }); };
  const stub = mkStub();
  const ctx = vm.createContext({ THREE: stub, document: stub, window: stub, matchMedia: () => ({ matches: false }), requestAnimationFrame() {}, addEventListener() {}, performance: { now: () => 0 }, localStorage: { getItem() { return null; }, setItem() {} }, location: { host: 'x', hostname: 'x' }, innerWidth: 800, innerHeight: 600, devicePixelRatio: 1, setTimeout, clearTimeout });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/world.js'), 'utf8'), ctx);
  try { vm.runInContext(code, ctx); } catch (e) { /* o loop de render usa stubs; os obstáculos já foram criados */ }
  const cl = Array.from(vm.runInContext('solids.map(o=>[o.x,o.z,o.r])', ctx)).map(a => a.map(v => +v.toFixed(6)).join()).sort();
  const sv = SOLIDS.map(o => [o.x, o.z, o.r].map(v => +v.toFixed(6)).join()).sort();
  assert.ok(cl.length > 250, 'cliente gerou obstáculos: ' + cl.length);
  assert.deepStrictEqual(sv, cl);
});

test('salas: vagas, sala cheia, início só pelo anfitrião com todos prontos', () => {
  const r = mk(); const [a, b, c, d] = ready4(r);
  assert.deepStrictEqual([a, b, c, d].map(p => p.slot), [0, 1, 2, 3]);
  assert.ok(r.join({ id: 'e' }).err);
  assert.strictEqual(r.start(b), false); assert.strictEqual(r.start(a), true);
  assert.ok(r.join({ id: 'f' }).err, 'não entra após iniciar');
});
test('início bloqueado se alguém não está pronto', () => {
  const r = mk(); const a = join(r, 'a'), b = join(r, 'b'); r.setReady(a, true);
  assert.strictEqual(r.start(a), false); r.setReady(b, true); assert.strictEqual(r.start(a), true);
});
test('saída do anfitrião passa o comando para a menor vaga', () => {
  const r = mk(); const a = join(r, 'a'), b = join(r, 'b'); r.drop(a); assert.strictEqual(r.hostId(), 'b');
  r.setReady(b, true); assert.strictEqual(r.start(b), true);
});
test('nickname é sanitizado no servidor', () => {
  const r = mk(); assert.strictEqual(join(r, 'a', { name: '<b>Ana</b>!!!' }).name, 'bAnab');
  assert.strictEqual(join(r, 'b', { name: '   ' }).name, 'Jogador');
  assert.strictEqual(join(r, 'c', { name: 'x'.repeat(40) }).name.length, 14);
});
test('anotações e porta (alterna): perto, sem duplicar, intervalo da animação, outro jogador fecha', () => {
  const r = mk(); const [a, b] = ready4(r); r.start(a, 1000);
  assert.strictEqual(r.note(a, 0), false, 'longe');
  a.x = NOTES[0][0]; a.z = NOTES[0][1]; assert.strictEqual(r.note(a, 0), true); assert.strictEqual(r.note(a, 0), false);
  a.x = 0; a.z = -5; assert.strictEqual(r.openDoor(a, 5000), false, 'longe da porta');
  a.x = DOOR[0]; a.z = DOOR[1] + 1; assert.strictEqual(r.openDoor(a, 5000), true); assert.strictEqual(r.door, true);
  b.x = a.x; b.z = a.z; assert.strictEqual(r.openDoor(b, 5100), false, 'sem estados conflitantes'); assert.strictEqual(r.openDoor(b, 5800), true); assert.strictEqual(r.door, false);
});
test('reconexão mantém vaga, posição, anotações e porta', () => {
  const r = mk(); const [a, b] = ready4(r); r.start(a);
  b.x = NOTES[1][0]; b.z = NOTES[1][1]; r.note(b, 1); b.off = true;
  const res = r.join({ id: 'b' }); assert.ok(res.rejoin); const s = r.snapshot(res.p);
  assert.strictEqual(s.slot, 1); assert.deepStrictEqual(s.notes, [false, true, false]); assert.strictEqual(s.started, true);
  assert.ok(Math.abs(s.me.x - NOTES[1][0]) < 1e-9);
});
test('posição: limites, NaN e teletransporte são recusados; ressincroniza após 5 recusas', () => {
  const r = mk(); const [a] = ready4(r); r.start(a); let t = 1000;
  assert.ok(r.pos(a, { x: 3, z: 10, fy: 0 }, t)); assert.strictEqual(r.pos(a, { x: NaN, z: 0, fy: 0 }, t += 100), null);
  assert.strictEqual(r.pos(a, { x: 90, z: 90, fy: 0 }, t += 100), null);
  let ok = null; for (let i = 0; i < 5; i++) ok = r.pos(a, { x: 90, z: 90, fy: 9 }, t += 100); assert.ok(ok); assert.strictEqual(ok.fy, 4);
  assert.strictEqual(r.pos(a, { x: 500, z: 90, fy: 0 }, t += 5000).x, 95);
});

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
test('Boss: patrulha sem entrar em obstáculos e sem exceder a velocidade', () => {
  const b = new Boss(SOLIDS); let prev = { x: b.x, z: b.z }, maxStep = 0;
  for (let i = 0; i < 20 * 600; i++) { b.tick(.05, []); maxStep = Math.max(maxStep, dist(b, prev)); prev = { x: b.x, z: b.z };
    for (const o of SOLIDS) assert.ok(Math.hypot(b.x - o.x, b.z - o.z) > o.r + .3, 'dentro de obstáculo'); }
  assert.ok(maxStep <= 1.5 * .05 + 1e-6 + .9, 'passo máximo ' + maxStep); assert.strictEqual(b.state, 'patrol');
});
test('Boss: vê → alerta → persegue (velocidade limitada) → pega → recuperação', () => {
  const b = new Boss([]); b.x = 0; b.z = 0; b.yaw = 0; const p = { id: 'p', x: 0, z: 10, run: false };
  b.tick(.05, [p]); assert.strictEqual(b.state, 'alert');
  for (let i = 0; i < 30 && b.state === 'alert'; i++) b.tick(.05, [p]); assert.strictEqual(b.state, 'chase');
  let hit = null, maxStep = 0, prev = { x: b.x, z: b.z };
  for (let i = 0; i < 400 && !hit; i++) { hit = b.tick(.05, [p]); maxStep = Math.max(maxStep, dist(b, prev)); prev = { x: b.x, z: b.z }; }
  assert.strictEqual(hit, 'p'); assert.ok(maxStep <= 4.3 * .05 + 1e-6, 'passo ' + maxStep); assert.ok(b.cool > 3);
  for (let i = 0; i < 60; i++) assert.strictEqual(b.tick(.05, [p]), null, 'sem captura em sequência');
});
test('Boss: ouve corrida, ignora jogador parado fora da visão e perde alvo', () => {
  const b = new Boss([]); b.x = 0; b.z = 0; b.yaw = Math.PI;                        // olhando para -z
  b.tick(.05, [{ id: 'p', x: 0, z: 12, run: false }]); assert.strictEqual(b.state, 'patrol');
  b.tick(.05, [{ id: 'p', x: 0, z: 12, run: true }]); assert.strictEqual(b.state, 'investigate');
  const c = new Boss([]); c.state = 'chase'; c.x = 0; c.z = 0; c.yaw = 0;
  for (let i = 0; i < 200; i++) c.tick(.05, [{ id: 'p', x: 0, z: -60, run: false }]); assert.notStrictEqual(c.state, 'chase');
});
test('Sala: Boss ignora jogadores desconectados', () => {
  const r = mk(); const [a, b] = ready4(r); r.start(a, 1000); r.boss.x = 0; r.boss.z = 30; r.boss.yaw = 0; r.boss.state = 'chase'; a.x = 0; a.z = 30.5; b.x = 40; b.z = 40; a.off = true;
  assert.ok(!r.tick(.05, 2000).some(e => e.t === 'cap'), 'desconectado não é pego'); a.off = false; assert.ok(r.tick(.05, 2100).some(e => e.t === 'cap' && e.who === 'a'));
});
test('agarrão: Boss parado, vítima ignorada, só 1 por vez, fim devolve ao spawn com trava', () => {
  const r = mk(); const [a, b] = ready4(r); r.start(a, 1000); r.boss.x = 0; r.boss.z = 30; r.boss.yaw = 0; r.boss.state = 'chase'; a.x = 0; a.z = 30.5; b.x = 0; b.z = 31; a.lastPos = 1;
  const cap = r.tick(.05, 2000).find(e => e.t === 'cap'); assert.ok(cap && cap.who === 'a' && cap.dur === GRAB_MS && cap.seq === 1); assert.strictEqual(r.boss.state, 'grab');
  for (let i = 1; i < 20; i++) { const ev = r.tick(.05, 2000 + i * 100); assert.ok(!ev.some(e => e.t === 'cap'), 'sem segundo agarrão'); assert.strictEqual(r.boss.x, 0); }
  assert.strictEqual(r.pos(a, { x: 0, z: 30.5, fy: 0 }, 2500), null, 'vítima não move durante o agarrão'); const g = r.snapshot(a, 2500).grab; assert.ok(g.who === 'a' && g.elapsed === 500 && g.seq === 1);
  const end = r.tick(.05, 2000 + GRAB_MS); assert.ok(end.some(e => e.t === 'capend' && e.who === 'a')); assert.deepStrictEqual([a.x, a.z], SPAWNS[0]); assert.strictEqual(r.capSeq, 1);
  assert.strictEqual(r.pos(a, { x: 0, z: 30.5, fy: 0 }, 5000), null, 'posição antiga recusada'); assert.ok(r.pos(a, { x: SPAWNS[0][0], z: SPAWNS[0][1], fy: 0 }, 5100)); assert.ok(r.pos(a, { x: SPAWNS[0][0] + 1, z: SPAWNS[0][1], fy: 0 }, 5200));
});
test('agarrão: sem resposta do cliente a trava expira em 3 s; escada é solta ao ser agarrado', () => {
  const r = mk(); const [a] = ready4(r); r.start(a, 1000); a.x = WORLD.LAD0[0]; a.z = WORLD.LAD0[1]; assert.ok(r.lad(a, 'pick'));
  r.boss.x = a.x; r.boss.z = a.z + .5; r.boss.yaw = Math.PI; r.boss.state = 'chase'; r.boss.cool = 0;
  const ev = r.tick(.05, 2000); assert.ok(ev.some(e => e.t === 'lad' && e.st === 'ground'), 'escada solta'); r.tick(.05, 2000 + GRAB_MS);
  assert.strictEqual(r.pos(a, { x: 0, z: 30.5, fy: 0 }, 5000), null); assert.ok(r.pos(a, { x: 0, z: 30.5, fy: 0 }, 2000 + GRAB_MS + 3500), 'trava expira');
});
test('Boss continua único e coerente com saída do anfitrião, entrada recusada e reconexão', () => {
  const r = mk(); const [a, b, c] = ready4(r); r.start(a);
  for (let i = 0; i < 100; i++) r.tick(.05, 1000 + i * 50); const s1 = r.boss.snap();
  r.drop(a); assert.strictEqual(r.hostId(), 'b'); for (let i = 0; i < 100; i++) r.tick(.05, 7000 + i * 50);
  assert.ok(Math.hypot(r.boss.x - s1.x, r.boss.z - s1.z) > 1, 'Boss segue andando sem o anfitrião');
  assert.ok(r.join({ id: 'novo' }).err, 'entrada tardia recusada'); c.off = true;
  const re = r.join({ id: 'c' }); assert.ok(re.rejoin); const snap = r.snapshot(re.p);
  assert.deepStrictEqual(snap.boss, r.boss.snap()); assert.strictEqual(snap.started, true);
  r.tick(.05, 20000); assert.strictEqual(typeof r.boss.snap().x, 'number');
});

test('sala 2/3/4: capacidade definida na criação', () => {
  for (const n of [2, 3, 4]) { const r = new Room('M' + n, SOLIDS, n); for (let i = 0; i < n; i++) assert.ok(r.join({ id: 'p' + i }).p); assert.ok(r.join({ id: 'x' }).err, 'cheia com ' + n); assert.strictEqual(r.snapshot(r.players.get('p0')).max, n); }
  assert.strictEqual(new Room('Z', SOLIDS, 9).max, 4); assert.strictEqual(new Room('Z', SOLIDS, 1).max, 2);
});
test('contorno dos papéis: servidor dispara 1 vez após 20 s e reconexão recebe o estado', () => {
  const r = mk(); const [a] = ready4(r); r.start(a, 1000);
  assert.strictEqual(r.hintDue(20999), false); assert.strictEqual(r.hintDue(21000), true); assert.strictEqual(r.hintDue(30000), false, 'só uma vez');
  a.off = true; assert.strictEqual(r.snapshot(r.join({ id: 'a' }).p).hint, true);
});

// ====== v0.7/v0.8: casa, esconderijo, escada, missão ======
const mkBoss = (x, z, yaw, state) => { const b = new Boss(SOLIDS); b.x = x; b.z = z; b.yaw = yaw; if (state) b.state = state; return b; };
const pl = (x, z, o = {}) => ({ id: 'p', x, z, fy: 0, run: false, inside: WORLD.inInside(x, z, 0), ...o });
const insideBoss = b => WORLD.inInside(b.x, b.z, 0) || WORLD.WALLS.concat([WORLD.DOORBOX]).some(w => b.x > w.x0 - .3 && b.x < w.x1 + .3 && b.z > w.z0 - .3 && b.z < w.z1 + .3);

test('esconderijo: atrás da parede não é visto nem capturado e o Boss não atravessa', () => {
  const b = mkBoss(0, -17, 0, 'chase'); let hit = null;
  for (let i = 0; i < 20 * 30; i++) { hit = b.tick(.05, [pl(0, -16)]) || hit; assert.ok(!insideBoss(b), 'Boss dentro da casa/parede em ' + i); }
  assert.strictEqual(hit, null); assert.notStrictEqual(b.state, 'chase');
});
test('esconderijo: perseguição termina na porta fechada; Boss investiga fora e desiste', () => {
  const b = mkBoss(0, 0, Math.PI, 'chase'), L = [pl(0, -9)]; let hit = null, investigou = false;
  for (let i = 0; i < 20 * 60; i++) { if (i === 10) L[0] = pl(0, -14); hit = b.tick(.05, L) || hit; if (i > 10 && b.state === 'investigate') investigou = true; assert.ok(!insideBoss(b)); }
  assert.strictEqual(hit, null); assert.ok(investigou, 'procurou em volta'); assert.strictEqual(b.state, 'patrol', 'desistiu e voltou à patrulha');
});
test('esconderijo: porta aberta expõe só quem está na entrada; o fundo continua seguro', () => {
  const entrada = mkBoss(0, -6, Math.PI); entrada.doorOpen = true; let hit = null;
  for (let i = 0; i < 20 * 20 && !hit; i++) { hit = entrada.tick(.05, [pl(0, -12.0)]); assert.ok(!insideBoss(entrada)); } assert.strictEqual(hit, 'p', 'exposto na porta aberta é visto e pego');
  const fundo = mkBoss(0, -6, Math.PI); fundo.doorOpen = true; for (let i = 0; i < 20 * 20; i++) { assert.strictEqual(fundo.tick(.05, [pl(0, -15)]), null); assert.ok(!insideBoss(fundo)); }
  assert.strictEqual(fundo.canSee(pl(0, -15)), false);
});
test('perseguição retoma quando o jogador sai e fica visível', () => {
  const b = mkBoss(0, -3, Math.PI, 'investigate'); b.gx = 0; b.gz = -8; let hit = null, estados = new Set();
  for (let i = 0; i < 20 * 12 && !hit; i++) { hit = b.tick(.05, [pl(0, -10.5)]); estados.add(b.state); }
  assert.ok(estados.has('alert') && estados.has('chase')); assert.strictEqual(hit, 'p');
});
test('barulho: correr dentro da casa não é ouvido; fora, é. Agachado só é visto de perto', () => {
  const fora = mkBoss(0, -25, 0); fora.tick(.05, [pl(0, -16, { run: true, inside: false })]); assert.strictEqual(fora.state, 'investigate');
  const dentro = mkBoss(0, -25, 0); dentro.tick(.05, [pl(0, -15, { run: true })]); assert.strictEqual(dentro.state, 'patrol');
  const em = mkBoss(0, 0, 0); em.tick(.05, [pl(0, 12, { crouch: true })]); assert.strictEqual(em.state, 'patrol', 'agachado a 12 m passa');
  const de = mkBoss(0, 0, 0); de.tick(.05, [pl(0, 12)]); assert.strictEqual(de.state, 'alert', 'em pé a 12 m é visto');
});
test('porta faz barulho que o Boss investiga', () => {
  const r = mk(); const [a] = ready4(r); r.start(a, 1000); r.boss.x = 0; r.boss.z = -25; a.x = DOOR[0]; a.z = DOOR[1] + 1; assert.ok(r.openDoor(a, 5000)); assert.strictEqual(r.boss.state, 'investigate');
});
test('escada: pegar, carregar, soltar, posicionar; sem duplicar; vale só em pontos válidos', () => {
  const r = mk(); const [a, b] = ready4(r); r.start(a, 1000);
  assert.strictEqual(r.lad(a, 'pick'), false, 'longe'); a.x = WORLD.LAD0[0]; a.z = WORLD.LAD0[1]; b.x = a.x; b.z = a.z;
  assert.strictEqual(r.lad(a, 'pick'), true); assert.strictEqual(r.ladder.holder, 'a'); assert.strictEqual(r.lad(b, 'pick'), false, 'só um carrega'); assert.strictEqual(r.lad(b, 'drop'), false); assert.strictEqual(r.lad(b, 'place'), false);
  assert.strictEqual(r.lad(a, 'place'), false, 'longe de um ponto válido'); const S = WORLD.SPOTS[0]; a.x = S.bx; a.z = S.bz;
  assert.strictEqual(r.lad(a, 'place'), true); assert.deepStrictEqual([r.ladder.st, r.ladder.spot, r.ladder.holder], ['placed', 0, null]); assert.strictEqual(r.lad(a, 'place'), false);
  b.x = S.bx; b.z = S.bz; assert.ok(r.lad(b, 'pick'), 'pode recolher a escada posicionada'); b.x = 20; b.z = 20; assert.ok(r.lad(b, 'drop')); assert.deepStrictEqual([r.ladder.st, r.ladder.x, r.ladder.z], ['ground', 20, 20]);
  const seq = r.ladder.seq; b.x = 20; assert.strictEqual(r.lad(b, 'pick'), true); r.release(b); assert.strictEqual(r.ladder.st, 'ground', 'quem sai/cai solta a escada'); assert.ok(r.ladder.seq > seq);
});
test('casa: porta, passagens, paredes e pouso da escada (geometria compartilhada)', () => {
  const bloqueia = (x, z, fy, aberta) => WORLD.WALLS.concat(aberta ? [] : [WORLD.DOORBOX]).some(w => fy < w.h - .05 && WORLD.boxHit(w, x, z, .35));
  for (let z = -9; z >= -13.5; z -= .05) { assert.ok(!bloqueia(0, z, 0, true), 'entrada livre z=' + z.toFixed(2)); }
  assert.ok([...Array(100)].some((_, i) => bloqueia(0, -9 - i * .05, 0, false)), 'porta fechada bloqueia');
  for (let z = -12.4; z >= -15.4; z -= .05) assert.ok(!bloqueia(1.9, z, 0, true), 'passagem entre salas livre z=' + z.toFixed(2));
  for (let x = -2.5; x <= 1.9; x += .05) assert.ok(!bloqueia(x, -12.7, 0, true), 'sala principal livre');
  for (let x = -2.9; x <= 2.9; x += .05) assert.ok(!bloqueia(x, -15.5, 0, true) || x > 2.4 || x < -3.05 === false, 'laboratório');
  for (const [x0, z0, x1, z1] of [[-6, -14, 0, -14], [6, -14, 0, -14], [0, -19, 0, -14.5], [-5, -11, -2, -11.6]]) { let b = false; for (let t = 0; t <= 1; t += .01) if (bloqueia(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, 0, true)) b = true; assert.ok(b, 'parede externa bloqueia'); }
  assert.ok(!bloqueia(3.4, -14, 3.5, true), 'no telhado não colide com as paredes');
  for (const S of WORLD.SPOTS) { const lx = S.bx + S.dx * (WORLD.RUN + .9), lz = S.bz + S.dz * (WORLD.RUN + .9), pl2 = WORLD.PLAT.find(q => q.h === S.h && lx > q.x0 && lx < q.x1 && lz > q.z0 && lz < q.z1); assert.ok(pl2, 'pouso dentro da plataforma: ' + S.id); assert.ok(SOLIDS.every(o => Math.hypot(o.x - S.bx, o.z - S.bz) > o.r + .4), 'base livre: ' + S.id); }
  assert.ok(Math.hypot(...WORLD.LAD0) > 0 && SOLIDS.every(o => Math.hypot(o.x - WORLD.LAD0[0], o.z - WORLD.LAD0[1]) > o.r + 1));
});
test('missão: papéis -> casa -> pistas -> painel -> concluída (servidor), Boss para e nova partida volta ao lobby', () => {
  const r = mk(); const [a, b] = ready4(r); r.start(a, 1000); const fase = () => r.mission.phase;
  assert.strictEqual(fase(), 'notes'); NOTES.forEach((n, i) => { a.x = n[0]; a.z = n[1]; assert.ok(r.note(a, i)); });
  a.x = 0; a.z = 10; b.x = 5; b.z = 10; let ev = r.tick(.05, 2000); assert.strictEqual(fase(), 'house'); assert.ok(ev.some(e => e.t === 'mis' && e.phase === 'house'));
  assert.strictEqual(r.inspect(a, 0), false, 'só depois de entrar na casa'); a.x = 0; a.z = -13; r.tick(.05, 2100); assert.strictEqual(fase(), 'clues');
  assert.strictEqual(r.panel(a), false, 'painel exige as 3 pistas'); a.x = 0; a.z = 0; assert.strictEqual(r.inspect(a, 0), false, 'longe do objeto');
  WORLD.MOBJ.forEach((o, i) => { a.x = o.x; a.z = o.z; assert.strictEqual(r.inspect(a, i), true); assert.strictEqual(r.inspect(a, i), false, 'sem repetir'); });
  assert.strictEqual(fase(), 'panel'); a.x = 0; a.z = 5; assert.strictEqual(r.panel(a), false); a.x = WORLD.PANEL.x; a.z = WORLD.PANEL.z + 1; assert.strictEqual(r.panel(a), true); assert.strictEqual(fase(), 'done');
  assert.deepStrictEqual(r.snapshot(b).mission.clues, [true, true, true]); assert.strictEqual(r.snapshot(b).mission.phase, 'done');
  const bx = r.boss.x; r.tick(.05, 3000); assert.strictEqual(r.boss.x, bx, 'Gorath para ao concluir');
  assert.strictEqual(r.start(a, 4000), false); r.reset(); assert.deepStrictEqual([r.started, r.mission.phase, r.notes.some(Boolean), r.door, r.ladder.st], [false, 'notes', false, false, 'ground']); assert.ok([...r.players.values()].every(p => !p.ready));
  [a, b].forEach(p => r.setReady(p, true)); ready4(r); assert.ok(r.start(a, 5000), 'inicia outra partida');
});
test('2, 3 e 4 jogadores: captura de um não afeta os outros e todos recebem o mesmo estado', () => {
  for (const n of [2, 3, 4]) {
    const r = new Room('N' + n, SOLIDS, n); const ps = []; for (let i = 0; i < n; i++) { const p = join(r, 'p' + i); r.setReady(p, true); ps.push(p); }
    assert.ok(r.start(ps[0], 1000)); ps.forEach((p, i) => { p.x = SPAWNS[i][0]; p.z = SPAWNS[i][1]; });
    r.boss.x = ps[1].x; r.boss.z = ps[1].z - 1; r.boss.yaw = 0; r.boss.state = 'chase'; r.boss.cool = 0;
    const cap = r.tick(.05, 2000).find(e => e.t === 'cap'); assert.ok(cap && cap.who === 'p1', 'n=' + n);
    const snaps = ps.map(p => JSON.stringify([r.snapshot(p, 2100).grab, r.snapshot(p, 2100).boss, r.snapshot(p, 2100).mission, r.snapshot(p, 2100).ladder])); assert.ok(snaps.every(s => s === snaps[0]), 'mesmo estado para todos');
    assert.ok(ps.filter(p => p.id !== 'p1').every(p => r.pos(p, { x: p.x + .1, z: p.z, fy: 0 }, 2100 + 100)), 'os demais continuam livres');
  }
});
