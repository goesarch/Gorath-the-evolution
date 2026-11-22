// Mundo compartilhado entre cliente e servidor (fonte única): casa, porta, plataformas, escada.
var WORLD = (function () {
  var W = {};
  W.NOTES = [[-9, 4], [14, -6], [-16, -24]]; W.DOOR = [0, -11.4];
  W.SPAWNS = [[-2.5, 10], [2.5, 10], [-2.5, 13], [2.5, 13]];
  W.WP = [[12, -34], [-20, -20], [-26, 8], [16, 2], [30, -10], [0, -40]];
  // Casa (mesma posição/tamanho de antes): x[-3.5,3.5] z[-16.5,-11.5]. Paredes de 0,3 m; vão da porta x[-0,7;0,7] na frente (z=-11,5).
  W.WALLS = [
    { x0: -3.5, x1: 3.5, z0: -16.5, z1: -16.2, h: 3.2 },   // fundo
    { x0: -3.5, x1: -3.2, z0: -16.5, z1: -11.5, h: 3.2 },  // esquerda
    { x0: 3.2, x1: 3.5, z0: -16.5, z1: -11.5, h: 3.2 },    // direita
    { x0: -3.5, x1: -0.7, z0: -11.8, z1: -11.5, h: 3.2 },  // frente (esq.)
    { x0: 0.7, x1: 3.5, z0: -11.8, z1: -11.5, h: 3.2 },    // frente (dir.)
    { x0: -3.2, x1: 1.2, z0: -14.1, z1: -13.9, h: 3.2 },   // divisória: sala principal (frente) | laboratório (fundo)
    { x0: 2.6, x1: 3.2, z0: -14.1, z1: -13.9, h: 3.2 }     // passagem entre as salas: x[1,2 ; 2,6]
  ];
  W.DOORBOX = { x0: -0.7, x1: 0.7, z0: -11.8, z1: -11.5, h: 2.3 };   // só bloqueia com a porta fechada
  W.INSIDE = { x0: -3.2, x1: 3.2, z0: -16.2, z1: -11.8 };
  W.FURN = [{ x: -1.6, z: -15.2, r: 0.9, h: 0.8 }, { x: 2.3, z: -15.2, r: 0.6, h: 0.8 }, { x: -2.3, z: -12.9, r: 0.9, h: 0.5 }];   // mesa, caixa, cama
  W.MOBJ = [{ id: 'c0', x: -2.7, z: -12.6 }, { id: 'c1', x: -1.6, z: -15.2 }, { id: 'c2', x: 2.3, z: -15.2 }];   // mural, caderno, gravador
  W.PANEL = { x: 0, z: -16.0 };                                // painel de contenção (laboratório)
  W.TREE = { x: -14, z: 1, r: 1.1 };                            // árvore do mirante (plataforma a 3 m)
  W.PLAT = [
    { x0: -3.7, x1: 3.7, z0: -16.7, z1: -11.3, h: 3.5 },       // telhado
    { x0: -15.5, x1: -12.5, z0: -0.5, z1: 2.5, h: 3.0 }        // mirante
  ];
  W.RUN = 0.9;                                                  // recuo horizontal da escada apoiada
  W.SPOTS = [
    { id: 'back', bx: 0, bz: -17.4, dx: 0, dz: 1, h: 3.5 },
    { id: 'right', bx: 4.4, bz: -14, dx: -1, dz: 0, h: 3.5 },
    { id: 'left', bx: -4.4, bz: -14, dx: 1, dz: 0, h: 3.5 },
    { id: 'tree', bx: -14, bz: 3.4, dx: 0, dz: -1, h: 3.0 }
  ];
  W.LAD0 = [3, -4];
  W.inInside = function (x, z, fy) { var i = W.INSIDE; return (fy || 0) < 3 && x > i.x0 && x < i.x1 && z > i.z0 && z < i.z1; };
  W.boxHit = function (b, x, z, pad) { return x > b.x0 - pad && x < b.x1 + pad && z > b.z0 - pad && z < b.z1 + pad; };
  // Escada portátil: máquina de estados única (servidor online; cliente no modo solo).
  W.newLadder = function () { return { st: 'ground', x: W.LAD0[0], z: W.LAD0[1], spot: -1, holder: null, seq: 0 }; };
  W.spotNear = function (x, z) { for (var i = 0; i < W.SPOTS.length; i++) if (Math.hypot(W.SPOTS[i].bx - x, W.SPOTS[i].bz - z) < 2.4) return i; return -1; };
  W.ladPos = function (L) { return L.st === 'placed' ? [W.SPOTS[L.spot].bx, W.SPOTS[L.spot].bz] : [L.x, L.z]; };
  W.ladPickup = function (L, id, x, z) { if (L.holder || L.st === 'carried') return false; var p = W.ladPos(L); if (Math.hypot(p[0] - x, p[1] - z) > 2.6) return false; L.st = 'carried'; L.holder = id; L.spot = -1; L.seq++; return true; };
  W.ladPlace = function (L, id, x, z) { if (L.st !== 'carried' || L.holder !== id) return false; var i = W.spotNear(x, z); if (i < 0) return false; L.st = 'placed'; L.holder = null; L.spot = i; L.seq++; return true; };
  W.ladDrop = function (L, id, x, z) { if (L.st !== 'carried' || L.holder !== id) return false; L.st = 'ground'; L.holder = null; L.x = x; L.z = z; L.spot = -1; L.seq++; return true; };
  // Missão: notes -> house -> clues -> panel -> done (única fonte; servidor online e cliente solo usam as mesmas funções)
  W.newMission = function () { return { phase: 'notes', clues: [false, false, false], seq: 0 }; };
  W.mAdvance = function (M, notes, anyInside) { var c = false;
    if (M.phase === 'notes' && notes >= 3) { M.phase = 'house'; c = true; }
    if (M.phase === 'house' && anyInside) { M.phase = 'clues'; c = true; }
    if (c) M.seq++; return c; };
  W.mInspect = function (M, i, x, z) { i |= 0; var o = W.MOBJ[i]; if (!o || M.phase !== 'clues' || M.clues[i] || Math.hypot(o.x - x, o.z - z) > 2.4) return false;
    M.clues[i] = true; if (M.clues.every(Boolean)) M.phase = 'panel'; M.seq++; return true; };
  W.mPanel = function (M, x, z) { if (M.phase !== 'panel' || Math.hypot(W.PANEL.x - x, W.PANEL.z - z) > 2.4) return false; M.phase = 'done'; M.seq++; return true; };
  return W;
})();
if (typeof module !== 'undefined') module.exports = WORLD;
