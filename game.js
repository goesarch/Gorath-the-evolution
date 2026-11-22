'use strict';
// Lógica de jogo autoritativa. Sem dependência de rede: testada em test/logic.test.js.
// As constantes do mundo precisam ficar iguais às do cliente (public/index.html); o teste confere os obstáculos.
const WORLD = require('./public/world.js');   // fonte única do mundo (também carregada pelo cliente)
const { NOTES, DOOR, SPAWNS, WP } = WORLD, MAX = 4;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const cleanName = (s, fb) => (String(s || '').replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 14)) || fb;

function rngf(s) { return () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// Mesma geração do cliente (semente 7, mesma ordem de sorteios) para o Boss colidir com as mesmas árvores/pedras.
function buildSolids() {
  const rnd = rngf(7), S = [{ x: 24, z: 20, r: 10 }];
  let k = 0;
  for (let i = 0; i < 560 && k < 280; i++) {
    const x = (rnd() - .5) * 180, z = (rnd() - .5) * 180;
    if (Math.hypot(x, z + 14) < 9 || Math.hypot(x, z - 11) < 9 || Math.hypot(x - 24, z - 20) < 13 || (Math.abs(x) < 3 && z > -16 && z < 12)) continue;
    const s = .8 + rnd() * 1.1; rnd(); S.push({ x, z, r: .5 * s + .3 }); k++;
  }
  for (let i = 0; i < 40; i++) {
    const x = (rnd() - .5) * 120, z = (rnd() - .5) * 120;
    if (Math.hypot(x, z) < 6 || Math.hypot(x, z - 11) < 8) continue;
    const s = .4 + rnd() * .9; rnd(); rnd(); rnd(); S.push({ x, z, r: s * .8, h: s * 1.1 });
  }
  WORLD.FURN.forEach(f => S.push({ x: f.x, z: f.z, r: f.r, h: f.h }));   // casa agora é oca: paredes são caixas (WORLD.WALLS)
  S.push({ x: WORLD.TREE.x, z: WORLD.TREE.z, r: WORLD.TREE.r });
  for (let i = 0; i < 16; i++) { const a = i / 16 * 6.283, x = Math.cos(a) * 7.6, z = 11.5 + Math.sin(a) * 7.6; if (z < 8 && Math.abs(x) < 3.5) continue; S.push({ x, z, r: .3 }); }
  [-35, -32, -29].forEach(x => S.push({ x, z: -32, r: 2.6 }));
  for (let i = 0; i < 7; i++) { const a = i / 7 * 6.28; S.push({ x: 30 + Math.cos(a) * 6, z: -28 + Math.sin(a) * 6, r: .7 }); }
  return S;
}

// Interseção segmento x caixa (2D) para a visão do Boss através das paredes.
function segHitsBox(ax, az, bx, bz, b) {
  let t0 = 0, t1 = 1; const dx = bx - ax, dz = bz - az;
  for (const [p, d, lo, hi] of [[ax, dx, b.x0, b.x1], [az, dz, b.z0, b.z1]]) {
    if (Math.abs(d) < 1e-9) { if (p < lo || p > hi) return false; }
    else { let a = (lo - p) / d, c = (hi - p) / d; if (a > c) [a, c] = [c, a]; t0 = Math.max(t0, a); t1 = Math.min(t1, c); if (t0 > t1) return false; }
  }
  return true;
}
const GRAB_MS = 2600;

// Boss (Gorath): patrulha, investigação, alerta, perseguição, agarrar. Velocidades fixas e limitadas.
// A casa é esconderijo: paredes bloqueiam visão e movimento; a porta só deixa passar quando está aberta.
class Boss {
  constructor(solids) { this.solids = solids; this.reset(); }
  reset() { this.x = WP[0][0]; this.z = WP[0][1]; this.yaw = 0; this.state = 'patrol'; this.gt = 0; this.lost = 0; this.cool = 0; this.wp = 0; this.gx = this.x; this.gz = this.z; this.cx = this.x; this.cz = this.z; this.srch = 0; this.doorOpen = false; }
  set(s) { this.state = s; this.gt = s === 'alert' ? 1.2 : s === 'investigate' ? 8 : 0; this.lost = 0; }
  walls() { return WORLD.WALLS.concat([WORLD.DOORBOX]); }                       // o Boss nunca entra na casa (porta aberta ou não)
  losWalls() { return this.doorOpen ? WORLD.WALLS : WORLD.WALLS.concat([WORLD.DOORBOX]); }
  canSee(p) { if ((p.fy || 0) > 3) return true;
    // dentro da casa = esconderijo: só fica exposto com a porta aberta e a menos de 2,5 m dela
    if (p.inside && (!this.doorOpen || Math.hypot(p.x - WORLD.DOOR[0], p.z - WORLD.DOOR[1]) > 2.5)) return false;
    const w = this.losWalls(); for (let i = 0; i < w.length; i++) if (segHitsBox(this.x, this.z, p.x, p.z, w[i])) return false; return true; }
  investigate(x, z, search) { this.set('investigate'); this.gx = x; this.gz = z; this.cx = x; this.cz = z; this.srch = search | 0; }
  noise(x, z) { if (this.state === 'patrol' && Math.hypot(x - this.x, z - this.z) < 28) this.investigate(x, z, 0); }
  nextSearch() { const a = this.srch * 2.1 + 1; this.srch--; this.gx = this.cx + Math.cos(a) * 4; this.gz = this.cz + Math.sin(a) * 4; this.gt = 5; }
  face(x, z, dt) { let d = Math.atan2(x - this.x, z - this.z) - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); this.yaw += d * Math.min(1, dt * 5); }
  route(tx, tz) {                       // para chegar a alguém dentro da casa, só pela porta aberta
    const I = WORLD.inInside; if (!(I(tx, tz, 0) && !I(this.x, this.z, 0))) return [tx, tz];
    if (!this.doorOpen) return [0, -10.0];
    return (Math.abs(this.x) > .6 && this.z > -10.4) ? [0, -10.0] : [0, -12.6];
  }
  // list: [{id,x,z,fy,run,inside}]. Retorna o id de quem foi pego, ou null. Parado enquanto agarra (state 'grab').
  tick(dt, list) {
    if (this.state === 'grab') return null;
    this.cool -= dt;
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw); let seen = null, sd = 1e9, heard = null, hd = 1e9;
    for (const p of list) {
      const d = Math.hypot(p.x - this.x, p.z - this.z);
      if (this.canSee(p)) { const q = d || 1e-6, front = ((p.x - this.x) / q) * fx + ((p.z - this.z) / q) * fz > .3; if (((d < (p.crouch ? 9 : 16) && front) || d < (p.crouch ? 3 : 4.5)) && d < sd) { sd = d; seen = p; } }
      if (p.run && d < 14 && !p.inside && d < hd) { hd = d; heard = p; }     // dentro da casa o barulho é abafado
    }
    let sp = 1.5, tx = 0, tz = 0, go = true, hit = null;
    if (this.state === 'patrol') {
      const w = WP[this.wp]; tx = w[0]; tz = w[1]; if (Math.hypot(tx - this.x, tz - this.z) < 1.5) this.wp = (this.wp + 1) % WP.length;
      if (seen) { this.gx = seen.x; this.gz = seen.z; this.set('alert'); } else if (heard) this.investigate(heard.x, heard.z, 0);
    } else if (this.state === 'investigate') {
      sp = 2.4; tx = this.gx; tz = this.gz; this.gt -= dt;
      if (seen) { this.gx = seen.x; this.gz = seen.z; this.set('alert'); }
      else if (Math.hypot(tx - this.x, tz - this.z) < 1.5 || this.gt <= 0) { if (this.srch > 0) this.nextSearch(); else this.set('patrol'); }
    } else if (this.state === 'alert') {
      go = false; this.gt -= dt; const f = seen || heard; if (f) this.face(f.x, f.z, dt); else this.face(this.gx, this.gz, dt);
      if (this.gt <= 0) { if (seen) this.set('chase'); else this.investigate(this.gx, this.gz, 2); }
    } else {
      sp = 4.3; if (seen) { this.gx = seen.x; this.gz = seen.z; this.lost = 0; } else this.lost += dt;
      tx = this.gx; tz = this.gz;
      if (this.lost > 2.5) this.investigate(this.gx, this.gz, 3);   // perdeu de vista: procura em volta da última posição
      else if (seen && sd < 1.4 && this.cool <= 0) { this.cool = 4; hit = seen.id; }
    }
    if (go && !hit) {
      [tx, tz] = this.route(tx, tz); this.face(tx, tz, dt);
      const dx = tx - this.x, dz = tz - this.z, l = Math.hypot(dx, dz) || 1;
      let nx = this.x + dx / l * sp * dt, nz = this.z + dz / l * sp * dt;
      for (const o of this.solids) { const ox = nx - o.x, oz = nz - o.z, dd = Math.hypot(ox, oz), m = o.r + .9; if (dd < m && dd > 0) { nx = o.x + ox / dd * m; nz = o.z + oz / dd * m; } }
      const R = .55; for (const b of this.walls()) if (nx > b.x0 - R && nx < b.x1 + R && nz > b.z0 - R && nz < b.z1 + R) {
        const dl = nx - (b.x0 - R), dr = (b.x1 + R) - nx, du = nz - (b.z0 - R), dd = (b.z1 + R) - nz, m = Math.min(dl, dr, du, dd);
        if (m === dl) nx = b.x0 - R; else if (m === dr) nx = b.x1 + R; else if (m === du) nz = b.z0 - R; else nz = b.z1 + R;
      }
      this.x = nx; this.z = nz;
    }
    return hit;
  }
  snap() { return { x: this.x, z: this.z, y: this.yaw, s: this.state }; }
}

class Room {
  constructor(code, solids, max = MAX) { this.max = Math.max(2, Math.min(MAX, max | 0 || MAX)); this.hint = false; this.t0 = 0; this.code = code; this.players = new Map(); this.notes = [false, false, false]; this.door = false; this.doorT = 0; this.started = false; this.boss = new Boss(solids); this.ladder = WORLD.newLadder(); this.grab = null; this.capSeq = 0; this.mission = WORLD.newMission(); }
  hostId() { let b = null; for (const p of this.players.values()) if (!b || p.slot < b.slot) b = p; return b && b.id; }
  pub(p) { const o = { id: p.id, name: p.name, ci: p.ci, slot: p.slot, ready: p.ready }; if (this.started) { o.x = p.x; o.z = p.z; o.fy = p.fy; } return o; }
  join(d) {
    const id = String(d.id || '').replace(/[^a-z0-9]/gi, '').slice(0, 12);
    if (!id) return { err: 'Identificador inválido' };
    let p = this.players.get(id);
    if (p) { p.off = false; return { p, rejoin: true }; }
    if (this.started) return { err: 'Partida já iniciada' };
    if (this.players.size >= this.max) return { err: 'Sala cheia' };
    const used = [...this.players.values()].map(x => x.slot); let s = 0; while (used.includes(s)) s++;
    p = { id, name: cleanName(d.name, 'Jogador'), ci: clamp(d.ci | 0, 0, 3), slot: s, ready: false, x: SPAWNS[s][0], z: SPAWNS[s][1], fy: 0, off: false, lastPos: 0, rej: 0 };
    this.players.set(id, p); return { p, rejoin: false };
  }
  grabInfo(now) { const g = this.grab; return g ? { who: g.who, bx: g.bx, bz: g.bz, yaw: g.yaw, dur: GRAB_MS, elapsed: now - g.start, seq: g.seq } : null; }
  snapshot(p, now = Date.now()) { return { max: this.max, hint: this.hint, slot: p.slot, host: this.hostId(), started: this.started, notes: this.notes.slice(), door: this.door, ladder: { ...this.ladder }, mission: { ...this.mission, clues: this.mission.clues.slice() }, grab: this.grabInfo(now), boss: this.boss.snap(), me: { x: p.x, z: p.z }, players: [...this.players.values()].map(q => this.pub(q)) }; }
  setReady(p, v) { if (this.started) return false; p.ready = !!v; return true; }
  start(p, now = Date.now()) {
    if (this.started || p.id !== this.hostId() || ![...this.players.values()].every(q => q.ready)) return false;
    this.started = true; this.t0 = now; this.boss.reset(); return true;
  }
  hintDue(now = Date.now()) { if (this.started && !this.hint && now - this.t0 >= 20000) { this.hint = true; return true; } return false; }   // contorno dos papéis após 20 s
  inspect(p, i) { return this.started && WORLD.mInspect(this.mission, i, p.x, p.z); }
  panel(p) { return this.started && WORLD.mPanel(this.mission, p.x, p.z); }
  // Nova partida na mesma sala (só depois da missão concluída): volta ao lobby com todos "não prontos".
  reset() {
    this.started = false; this.notes = [false, false, false]; this.door = false; this.doorT = 0; this.hint = false; this.grab = null; this.ladder = WORLD.newLadder(); this.mission = WORLD.newMission(); this.boss.reset();
    for (const p of this.players.values()) { p.ready = false; p.x = SPAWNS[p.slot][0]; p.z = SPAWNS[p.slot][1]; p.fy = 0; p.hold = 0; p.lastPos = 0; p.rej = 0; p.crouch = false; }
  }
  note(p, i) { i |= 0; if (!this.started || i < 0 || i > 2 || this.notes[i] || Math.hypot(p.x - NOTES[i][0], p.z - NOTES[i][1]) > 6) return false; this.notes[i] = true; return true; }
  // Porta: alterna aberta/fechada (precisa estar perto; intervalo de 0,7 s = duração da animação). Abrir/fechar faz barulho.
  openDoor(p, now = Date.now()) {
    if (!this.started || (this.grab && this.grab.who === p.id) || Math.hypot(p.x - DOOR[0], p.z - DOOR[1]) > 3.5 || now - this.doorT < 700) return false;
    this.door = !this.door; this.doorT = now; this.boss.doorOpen = this.door; this.boss.noise(DOOR[0], DOOR[1] + .6); return true;
  }
  // Escada: um único objeto compartilhado; toda mudança passa por aqui.
  lad(p, kind) {
    if (!this.started || (this.grab && this.grab.who === p.id)) return false;
    const f = { pick: WORLD.ladPickup, place: WORLD.ladPlace, drop: WORLD.ladDrop }[kind]; return !!f && f(this.ladder, p.id, p.x, p.z);
  }
  release(p) { return WORLD.ladDrop(this.ladder, p.id, p.x, p.z); }     // quem sai/cai solta a escada onde estava
  pos(p, m, now) {
    if (!this.started || p.off || (this.grab && this.grab.who === p.id)) return null;
    const x = +m.x, z = +m.z, fy = +m.fy; if (![x, z, fy].every(Number.isFinite)) return null;
    const cx = clamp(x, -95, 95), cz = clamp(z, -95, 95), dt = Math.max(.05, (now - p.lastPos) / 1000);
    // após captura: ignora posições antigas (perto do Boss) até o cliente reaparecer no spawn (ou 3 s)
    if (p.hold) { if (Math.hypot(cx - p.x, cz - p.z) < 4 || now > p.hold) p.hold = 0; else return null; }
    if (p.lastPos && Math.hypot(cx - p.x, cz - p.z) > 12 * dt + 1 && ++p.rej < 5) return null; // anti-teleporte (aceita após 5 recusas seguidas para ressincronizar)
    p.rej = 0; p.lastPos = now; p.x = cx; p.z = cz; p.fy = clamp(fy, 0, 4); p.run = !!m.r; p.crouch = !!m.k;
    return { x: p.x, z: p.z, yaw: +m.yaw || 0, r: !!m.r, m: !!m.m, j: !!m.j, c: !!m.c, k: !!m.k, fy: p.fy };
  }
  // Simulação do Boss. Retorna lista de eventos para transmitir: cap (início do agarrão), capend (fim), lad (escada solta).
  tick(dt, now = Date.now()) {
    const ev = []; if (!this.started) return ev;
    const anyIn = [...this.players.values()].some(p => !p.off && WORLD.inInside(p.x, p.z, p.fy));
    if (WORLD.mAdvance(this.mission, this.notes.filter(Boolean).length, anyIn)) ev.push({ t: 'mis', ...this.mission, clues: this.mission.clues.slice() });
    if (this.mission.phase === 'done') return ev;                          // missão concluída: Gorath para
    if (this.grab) {
      if (now < this.grab.end) return ev;                                  // Boss parado agarrando
      const p = this.players.get(this.grab.who); this.grab = null;
      if (p) { p.x = SPAWNS[p.slot][0]; p.z = SPAWNS[p.slot][1]; p.fy = 0; p.rej = 0; p.lastPos = 0; p.hold = now + 3000; ev.push({ t: 'capend', who: p.id }); }
      this.boss.cool = 4; this.boss.investigate(this.boss.x, this.boss.z, 2);
      return ev;
    }
    const list = []; for (const p of this.players.values()) if (!p.off) list.push({ id: p.id, x: p.x, z: p.z, fy: p.fy, run: !!p.run, crouch: !!p.crouch, inside: WORLD.inInside(p.x, p.z, p.fy) });
    this.boss.doorOpen = this.door;
    const hit = this.boss.tick(dt, list);
    if (hit) {
      const p = this.players.get(hit), b = this.boss; b.yaw = Math.atan2(p.x - b.x, p.z - b.z); b.state = 'grab';
      this.grab = { who: hit, start: now, end: now + GRAB_MS, bx: b.x, bz: b.z, yaw: b.yaw, seq: ++this.capSeq };
      if (this.release(p)) ev.push({ t: 'lad', ...this.ladder });
      ev.push({ t: 'cap', who: hit, bx: b.x, bz: b.z, yaw: b.yaw, dur: GRAB_MS, seq: this.capSeq });
    }
    return ev;
  }
  drop(p) { this.players.delete(p.id); return this.players.size === 0; }
}

module.exports = { NOTES, DOOR, MAX, SPAWNS, WP, WORLD, GRAB_MS, buildSolids, Boss, Room, cleanName, segHitsBox };
