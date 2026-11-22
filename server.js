// ECHOES: THE EVOLUTION — servidor (Express + Socket.IO). Regras em game.js.
const express = require('express'), http = require('http'), path = require('path'), fs = require('fs'), os = require('os');
const { Server } = require('socket.io');
const { Room, buildSolids } = require('./game');

const PUBLIC = path.join(__dirname, 'public'), INDEX = path.join(PUBLIC, 'index.html');
if (!fs.existsSync(INDEX)) { console.error('ERRO: não encontrei ' + INDEX); process.exit(1); }

const app = express(), srv = http.createServer(app);
app.set('trust proxy', 1);                       // atrás de proxy HTTPS (Render, Railway, Fly...)
const io = new Server(srv, { cors: { origin: process.env.ALLOWED_ORIGIN || false }, pingInterval: 5000, pingTimeout: 8000 });
const rooms = new Map(), SOLIDS = buildSolids(), GRACE_MS = 30000, TICK = 50;
app.get('/health', (q, r) => r.json({ ok: true, rooms: rooms.size, players: [...rooms.values()].reduce((n, x) => n + x.players.size, 0), uptime: Math.round(process.uptime()) }));
app.use(express.static(PUBLIC, { setHeaders: (res, f) => { if (f.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache'); } }));
app.get('/', (q, r) => r.sendFile(INDEX));

const okCode = s => /^[A-Z0-9]{3,6}$/.test(s);
const ladMsg = r => ({ t: 'lad', id: 'srv', ...r.ladder });
const gone = (r, p) => { if (r.release(p)) io.to(r.code).emit('m', ladMsg(r)); const empty = r.drop(p); io.to(r.code).emit('m', { t: 'bye', id: p.id }); if (empty) rooms.delete(r.code); };

io.on('connection', sock => {
  let R = null, P = null, last = 0, tokens = 80;
  const refill = setInterval(() => { tokens = 80; }, 1000);
  const leave = () => { if (!R) return; sock.leave(R.code); if (P && P.sock === sock) gone(R, P); R = P = null; };

  sock.on('join', d => {
    try {
      leave();
      const c = String((d && d.room) || '').toUpperCase();
      if (!okCode(c)) return sock.emit('denied', 'Código inválido');
      let r = rooms.get(c);
      if (!r) { if (!d.create) return sock.emit('denied', 'Sala não encontrada'); r = new Room(c, SOLIDS, (d.max | 0) || 4); rooms.set(c, r); }
      const res = r.join(d);
      if (res.err) { if (!r.players.size) rooms.delete(c); return sock.emit('denied', res.err); }
      const p = res.p; p.sock = sock; R = r; P = p; sock.join(c);
      sock.emit('joined', r.snapshot(p));
      if (!res.rejoin) sock.to(c).emit('m', { t: 'hello', id: p.id, p: r.pub(p) });
    } catch (e) { console.error(e); }
  });
  sock.on('leave', leave);

  sock.on('m', m => {
    if (!R || !P || !m || typeof m !== 'object' || --tokens < 0) return;
    const now = Date.now();
    switch (m.t) {
      case 'pos': { if (now - last < 45) return; last = now; const o = R.pos(P, m, now); if (o) sock.to(R.code).volatile.emit('m', { t: 'pos', id: P.id, ...o }); break; }
      case 'ready': if (R.setReady(P, m.v)) sock.to(R.code).emit('m', { t: 'ready', id: P.id, v: P.ready }); break;
      case 'start': if (R.start(P)) io.to(R.code).emit('m', { t: 'start', id: 'srv' }); else sock.emit('m', { t: 'err', id: 'srv' }); break;
      case 'note': if (R.note(P, m.i)) sock.to(R.code).emit('m', { t: 'note', id: P.id, i: m.i | 0 }); break;
      case 'door': if (R.openDoor(P, now)) io.to(R.code).emit('m', { t: 'door', id: 'srv', open: R.door }); break;   // inclui quem pediu: todos veem o estado oficial
      case 'insp': if (R.inspect(P, m.i)) io.to(R.code).emit('m', { t: 'mis', id: 'srv', ...R.mission }); break;
      case 'panel': if (R.panel(P)) io.to(R.code).emit('m', { t: 'mis', id: 'srv', ...R.mission }); break;
      case 'again': if (R.mission.phase === 'done' && P.id === R.hostId()) { R.reset(); io.to(R.code).emit('m', { t: 'reset', id: 'srv' }); } break;
      case 'lad_pick': case 'lad_place': case 'lad_drop': if (R.lad(P, m.t.slice(4))) io.to(R.code).emit('m', { ...ladMsg(R), by: P.id, act: m.t.slice(4) }); break;
    }   // 'gor' e 'caught' vindos de clientes são ignorados: o Boss é do servidor
  });

  sock.on('disconnect', () => {
    clearInterval(refill);
    if (!P || P.sock !== sock) return;
    const p = P, r = R; p.off = true; if (r.release(p)) io.to(r.code).emit('m', ladMsg(r));
    setTimeout(() => { if (p.off && r.players.get(p.id) === p) gone(r, p); }, GRACE_MS);
  });
});

let n = 0;   // simulação do Boss a 20 Hz, envio a 10 Hz
setInterval(() => {
  n++;
  for (const r of rooms.values()) {
    if (!r.started) continue;
    if (r.hintDue(Date.now())) io.to(r.code).emit('m', { t: 'hint', id: 'srv' });
    for (const e of r.tick(TICK / 1000, Date.now())) io.to(r.code).emit('m', { ...e, id: 'srv' });
    if (n % 2 === 0) io.to(r.code).volatile.emit('m', { t: 'gor', id: 'srv', ...r.boss.snap() });
  }
}, TICK);

const PORT = process.env.PORT || 3000;
srv.listen(PORT, '0.0.0.0', () => {
  console.log('ECHOES rodando na porta ' + PORT + '\n  Neste computador: http://localhost:' + PORT);
  for (const l of Object.values(os.networkInterfaces()).flat()) if (l && l.family === 'IPv4' && !l.internal) console.log('  Mesma Wi-Fi:      http://' + l.address + ':' + PORT);
});
