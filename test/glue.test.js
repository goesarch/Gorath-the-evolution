// Testa server.js com express/socket.io/http SIMULADOS (sem rede). Não substitui teste com aparelhos reais.
const test = require('node:test'), assert = require('node:assert'), Module = require('module'), path = require('path');
const { NOTES } = require('../game');
const emitted = [], routes = {}, statics = [], handlers = {}, timers = {};
const mkSock = id => { const h = {}, out = []; return { id, h, out, join() {}, leave() {}, on(e, f) { h[e] = f; }, emit(e, d) { out.push([e, d]); }, to() { return { emit: (e, d) => emitted.push([id, e, d]), volatile: { emit: (e, d) => emitted.push([id, e, d]) } }; } }; };
const io = { on(e, f) { handlers[e] = f; }, to: r => ({ emit: (e, d) => emitted.push(['io:' + r, e, d]), volatile: { emit: (e, d) => emitted.push(['io:' + r, e, d]) } }) };
const real = Module._load; const si = global.setInterval;
global.setInterval = (f, t) => { const h = si(f, t); h.unref(); timers[t] = f; return h; };
Module._load = function (req, ...a) {
  if (req === 'express') { const e = () => ({ set() {}, get: (p, f) => { routes[p] = f; }, use() {} }); e.static = (d) => { statics.push(d); return () => {}; }; return e; }
  if (req === 'socket.io') return { Server: function () { return io; } };
  if (req === 'http') return { createServer: () => ({ listen: (p, h, cb) => cb && cb() }) };
  return real.call(this, req, ...a);
};
require('../server.js'); Module._load = real;

const A = mkSock('A'), B = mkSock('B');
const last = (s, e) => [...s.out].reverse().find(x => x[0] === e);
const m = (s, d) => s.h.m(d);
test('servidor serve a pasta public e a rota /', () => {
  assert.ok(statics[0].endsWith(path.join('echoes-server', 'public')));
  let body; routes['/health']({}, { json: o => { body = o; } }); assert.strictEqual(body.ok, true);
  let sent; routes['/']({}, { sendFile: f => { sent = f; } }); assert.ok(sent.endsWith('index.html') && require('fs').existsSync(sent));
});
test('criar, entrar, pronto e iniciar', () => {
  handlers.connection(A); handlers.connection(B);
  B.h.join({ room: 'ZZZ', id: 'b1', name: 'Bia' }); assert.strictEqual(last(B, 'denied')[1], 'Sala não encontrada');
  A.h.join({ room: 'ZZZ', id: 'a1', name: 'Ana', create: true }); assert.strictEqual(last(A, 'joined')[1].slot, 0);
  B.h.join({ room: 'zzz', id: 'b1', name: 'Bia' }); assert.strictEqual(last(B, 'joined')[1].slot, 1);
  assert.ok(emitted.some(x => x[1] === 'm' && x[2].t === 'hello' && x[2].p.name === 'Bia'));
  m(A, { t: 'start' }); assert.strictEqual(last(A, 'm')[1].t, 'err');
  m(A, { t: 'ready', v: true }); m(B, { t: 'ready', v: true });
  emitted.length = 0; m(A, { t: 'start' }); assert.ok(emitted.some(x => x[0] === 'io:ZZZ' && x[2].t === 'start'));
});
test('posição repassada; gor/caught de clientes ignorados; Boss do servidor transmite', () => {
  emitted.length = 0; m(A, { t: 'pos', x: 2, z: 11, yaw: 0, r: false, m: true, j: false, fy: 0 });
  assert.ok(emitted.some(x => x[0] === 'A' && x[2].t === 'pos' && x[2].id === 'a1'));
  emitted.length = 0; m(A, { t: 'gor', x: 1, z: 1, y: 0, s: 'chase' }); m(A, { t: 'caught', who: 'b1' }); assert.strictEqual(emitted.length, 0);
  timers[50](); timers[50](); assert.ok(emitted.some(x => x[0] === 'io:ZZZ' && x[2].t === 'gor' && x[2].s === 'patrol'));
});
test('anotação validada, reconexão devolve estado e posição', () => {
  A.h.m({ t: 'pos', x: NOTES[0][0], z: NOTES[0][1], yaw: 0, fy: 0 }); // limitado por taxa (45 ms): espera
  const t0 = Date.now(); while (Date.now() - t0 < 60);
  m(A, { t: 'pos', x: NOTES[0][0], z: NOTES[0][1], yaw: 0, fy: 0 }); // teleporte recusado (ainda longe) -> nota deve falhar
  emitted.length = 0; m(A, { t: 'note', i: 0 }); assert.strictEqual(emitted.length, 0, 'sem estar perto, recusa');
  const A2 = mkSock('A2'); handlers.connection(A2); A.h.disconnect();
  A2.h.join({ room: 'ZZZ', id: 'a1', name: 'Ana' }); const s = last(A2, 'joined')[1];
  assert.strictEqual(s.slot, 0); assert.strictEqual(s.started, true); assert.deepStrictEqual(s.notes, [false, false, false]); assert.ok(s.boss && s.me);
});

test('agarrão ponta a ponta: servidor decide, avisa a sala, congela posição da vítima e devolve ao spawn', () => {
  const rn = Date.now; let clk = 5e6; Date.now = () => (clk += 100);
  try {
    const C = mkSock('C'); handlers.connection(C);
    C.h.join({ room: 'QQQ', id: 'c1', name: 'Cai', create: true }); m(C, { t: 'ready', v: true }); m(C, { t: 'start' });
    m(C, { t: 'pos', x: 12, z: -30, yaw: 0, fy: 0 });
    emitted.length = 0; let hit = null;
    for (let i = 0; i < 300 && !hit; i++) { timers[50](); hit = emitted.find(x => x[2] && x[2].t === 'cap'); }
    assert.ok(hit && hit[0] === 'io:QQQ' && hit[2].who === 'c1' && hit[2].id === 'srv' && hit[2].dur === 2600, 'início do agarrão transmitido pelo servidor');
    emitted.length = 0; m(C, { t: 'pos', x: 12, z: -29, yaw: 0, fy: 0 }); assert.ok(!emitted.some(x => x[2] && x[2].t === 'pos'), 'vítima não move durante o agarrão');
    clk += 3000; emitted.length = 0; timers[50](); assert.ok(emitted.some(x => x[0] === 'io:QQQ' && x[2].t === 'capend' && x[2].who === 'c1'), 'fim transmitido');
    emitted.length = 0; m(C, { t: 'pos', x: 12, z: -30, yaw: 0, fy: 0 }); assert.ok(!emitted.some(x => x[2] && x[2].t === 'pos'), 'posição antiga não é repassada');
    emitted.length = 0; m(C, { t: 'pos', x: -2.5, z: 10, yaw: 0, fy: 0 }); assert.ok(emitted.some(x => x[2] && x[2].t === 'pos'), 'spawn é repassado');
    C.h.disconnect(); const C2 = mkSock('C2'); handlers.connection(C2); C2.h.join({ room: 'QQQ', id: 'c1', name: 'Cai' });
    const s = C2.out.find(x => x[0] === 'joined')[1]; assert.strictEqual(s.started, true); assert.ok(s.boss && typeof s.boss.x === 'number' && s.mission && s.ladder);
  } finally { Date.now = rn; }
});
test('sala criada com máximo 2 recusa o terceiro; aviso de contorno é emitido pelo servidor aos 20 s', () => {
  const rn = Date.now; let clk = 9e6; Date.now = () => clk;
  try {
    const P1 = mkSock('P1'), P2 = mkSock('P2'), P3 = mkSock('P3'); [P1, P2, P3].forEach(handlers.connection);
    P1.h.join({ room: 'DUO', id: 'p1', name: 'U', create: true, max: 2 }); P2.h.join({ room: 'DUO', id: 'p2', name: 'D' }); P3.h.join({ room: 'DUO', id: 'p3', name: 'T' });
    assert.strictEqual(last(P1, 'joined')[1].max, 2); assert.strictEqual(last(P3, 'denied')[1], 'Sala cheia');
    m(P1, { t: 'ready', v: true }); m(P2, { t: 'ready', v: true }); m(P1, { t: 'start' });
    emitted.length = 0; timers[50](); assert.ok(!emitted.some(x => x[0] === 'io:DUO' && x[2] && x[2].t === 'hint'), 'antes dos 20 s não avisa');
    clk += 20500; emitted.length = 0; timers[50](); assert.ok(emitted.some(x => x[0] === 'io:DUO' && x[2].t === 'hint' && x[2].id === 'srv'));
    emitted.length = 0; timers[50](); assert.ok(!emitted.some(x => x[0] === 'io:DUO' && x[2] && x[2].t === 'hint'), 'não repete');
  } finally { Date.now = rn; }
});

test('sockets (2, 3 e 4 jogadores): porta, escada e missão sincronizadas para todos; só o anfitrião reinicia', () => {
  const rn = Date.now; let clk = 8e6; Date.now = () => clk;
  const go = (s, x, z) => { for (let k = 0; k < 6; k++) { clk += 100; m(s, { t: 'pos', x, z, yaw: 0, fy: 0 }); } };   // posições aceitas (anti-teleporte/limite de taxa)
  const ev = (room, t) => emitted.filter(x => x[0] === 'io:' + room && x[2] && x[2].t === t);
  try {
    for (const n of [2, 3, 4]) {
      const room = 'T' + n + 'X', S = [...Array(n)].map((_, i) => mkSock('S' + n + i)); S.forEach(handlers.connection);
      S[0].h.join({ room, id: 'u' + n + '0', name: 'A', create: true, max: n }); for (let i = 1; i < n; i++) S[i].h.join({ room, id: 'u' + n + i, name: 'J' + i });
      assert.strictEqual(last(S[n - 1], 'joined')[1].slot, n - 1); S.forEach(s => m(s, { t: 'ready', v: true })); emitted.length = 0; m(S[0], { t: 'start' }); assert.strictEqual(ev(room, 'start').length, 1);
      go(S[0], 0, -10.4); emitted.length = 0; clk += 1000; m(S[0], { t: 'door' }); assert.strictEqual(ev(room, 'door')[0][2].open, true, 'todos recebem a porta aberta (inclui quem pediu)');
      go(S[1], 0, -10.4); emitted.length = 0; m(S[1], { t: 'door' }); assert.strictEqual(ev(room, 'door').length, 0, 'sem estado conflitante dentro da animação'); clk += 1000; m(S[1], { t: 'door' }); assert.strictEqual(ev(room, 'door')[0][2].open, false);
      go(S[0], 3, -4); go(S[1], 3, -4); emitted.length = 0; m(S[0], { t: 'lad_pick' }); assert.strictEqual(ev(room, 'lad')[0][2].holder, 'u' + n + '0'); emitted.length = 0; m(S[1], { t: 'lad_pick' }); assert.strictEqual(ev(room, 'lad').length, 0, 'não duplica a escada');
      go(S[0], 0, -17.4); emitted.length = 0; m(S[0], { t: 'lad_place' }); assert.deepStrictEqual([ev(room, 'lad')[0][2].st, ev(room, 'lad')[0][2].spot], ['placed', 0]);
      m(S[0], { t: 'insp', i: 0 }); assert.strictEqual(ev(room, 'mis').length, 0, 'pista fora de fase');
      [[-9, 4], [14, -6], [-16, -24]].forEach((p, i) => { go(S[0], p[0], p[1]); m(S[0], { t: 'note', i }); }); go(S[0], 0, -13); emitted.length = 0; clk += 100; timers[50]();
      assert.ok(ev(room, 'mis').some(e => e[2].phase === 'house' || e[2].phase === 'clues'), 'missão avança para todos');
      [[-2.7, -12.6], [-1.6, -15.2], [2.3, -15.2]].forEach((p, i) => { go(S[0], p[0], p[1]); m(S[0], { t: 'insp', i }); }); go(S[0], 0, -15); emitted.length = 0; m(S[0], { t: 'panel' });
      assert.strictEqual(ev(room, 'mis').pop()[2].phase, 'done', 'conclusão para toda a sala');
      emitted.length = 0; m(S[n - 1], { t: 'again' }); assert.strictEqual(ev(room, 'reset').length, 0, 'só o anfitrião reinicia'); m(S[0], { t: 'again' }); assert.strictEqual(ev(room, 'reset').length, 1);
    }
  } finally { Date.now = rn; }
});
