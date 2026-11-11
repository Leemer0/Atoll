/* =====================================================================
   02 sim: authoritative game state, independent of rendering and UI.
   Small units (Builders, workers, broodlings) stand on tiles. Big units
   (Titans, husks) stand on tile corners and need a clear 2x2 block, so a
   one-tile gap between walls lets Builders through and keeps Titans out.
   Every unit runs a queue of orders issued by a player or a bot.
   ===================================================================== */
let G = null, uid = 0;
const Local = { seat: -1, host: true };

function mkUnit(kind, seat, x, y, tk) {
  const big = kind === 'titan' || kind === 'husk';
  return { id: ++uid, kind, tk: tk || '', seat, team: kind === 'builder' || kind === 'worker' ? 0 : 1, size: big ? 2 : 1, x, y, nx: x, ny: y, face: Math.PI / 2, hp: 1, maxHp: 1, armor: 0, alive: true,
    path: null, pi: 0, pathKey: '', repT: 0, partial: false, orders: [], hold: false, dashCd: 0, hitT: 9, atkCd: 0, slow: 0, slowed: 0,
    bBurrow: 0, bPhase: 0, bReinf: 0, bRegen: 0, bSlow: 0, beam: null, harvesting: false, moving: false, sieging: null, flash: 0, anim: Math.random() * 10,
    lvl: 1, xp: 0, dmg: 0, cd: { q: 0, w: 0, e: 0, r: 0 }, channelT: 0, revealT: 0, dormant: false, wake: 0, ai: null,
    site: null, atSite: false, thinkT: 0.5 + Math.random() * 0.5, bay: 0, wstate: 'seek', carry: 0, node: -1, workT: 0, bad: null, auto: true, life: 0, chop: 0, act: 'idle' };
}
/* cfg: { diffKey, seats: [{name, role:'builder'|'titan', bot, peer, fac, tk}] } */
function newGame(cfg) {
  uid = 0; resetMap(M); nodesReset();
  const diff = DIFFS[cfg.diffKey] || DIFFS.standard;
  G = { t: 0, over: null, diffKey: cfg.diffKey, diff, seats: [], units: [], structs: [], struct: new Array(N).fill(null), reserved: new Uint8Array(N), dirty: false,
    removed: [], nodeQ: [], nodesGone: [], shots: [], beams: [], parts: [], rings: [], floats: [], pools: [], vis: new Uint8Array(N), explored: new Uint8Array(N), visT: 0, shake: 0, titan: null,
    placing: null, aim: null, tips: 0, view: false, reveal: false, cfg };
  const order = [1, 0, 3, 2, 5, 4, 7, 6]; let rk = 0;
  cfg.seats.forEach((c, i) => {
    const S = { id: i, name: c.name, role: c.role, bot: !!c.bot, bot0: !!c.bot, peer: c.peer || null, fac: FACTIONS[c.fac] ? c.fac : 'human', tk: TITANS[c.tk] ? c.tk : 'hollow', lumen: 0, flux: 0, workers: 0, forge: 0, dead: false, respawnT: 0, unit: null, col: COL.threat, chamber: -1, inc: [] };
    if (c.role === 'builder') {
      const ch = order[rk % 8]; S.chamber = ch; S.col = SEAT_COLS[rk % 8]; rk++;
      const st = M.starts[ch], u = mkUnit('builder', i, st.x + .5, st.y + .5);
      u.hp = u.maxHp = UNITS.builder.hp; u.site = M.spots[ch]; S.unit = u; S.lumen = c.bot ? 30 : 60; G.units.push(u);
    } else if (!G.titan) {
      const u = mkUnit('titan', i, CX, CY + 5, S.tk); u.dormant = true; u.wake = c.bot ? diff.wake : 12; u.face = Math.PI / 2;
      u.ai = c.bot ? newAi() : null; S.unit = u; G.titan = u; G.units.push(u);
    }
    G.seats.push(S);
  });
  if (G.titan) setTitanLevel(G.titan, 1, true);
  return G;
}
const newAi = () => ({ state: 'hunt', target: null, lastFailed: null, picked: false });
const facOf = seat => FACTIONS[G.seats[seat].fac];
const HUMAN_MUL = { hp: 1, dmg: 1, xp: 1 };
const titanMul = () => G.seats[G.titan.seat].bot ? G.diff : HUMAN_MUL;
function setTitanLevel(a, l, full) { const T = TITANS[a.tk], m = titanMul(), nm = (650 + 300 * l + 6 * l * l) * m.hp * T.hp; a.hp = full ? nm : a.hp + (nm - a.maxHp); a.maxHp = nm; a.lvl = l; a.dmg = (16 + 7 * l + 0.3 * l * l) * m.dmg * T.dmg; a.armor = T.armor + l * 0.25; }
const xpNeed = l => 60 + 45 * l;
function gainXp(a, n) { if (!a || !a.alive) return; a.xp += n * titanMul().xp; while (a.xp >= xpNeed(a.lvl) && a.lvl < 25) { a.xp -= xpNeed(a.lvl); setTitanLevel(a, a.lvl + 1); fire({ e: 'lvl', l: a.lvl }); } }
const seatAlive = s => !G.seats[s].dead;
const unitById = id => G.units.find(u => u.id === id);
const structById = id => G.structs.find(s => s.id === id && !s.dead);
const targetable = u => u.alive && !u.dormant && u.bBurrow <= 0 && u.bPhase <= 0;
const hpOf = (type, lvl, seat) => Math.round(DEFS[type].hp[lvl] * (type === 'wall' ? facOf(seat).wallHp : 1));
const upCostOf = s => Math.round(DEFS[s.type].up[s.lvl] * facOf(s.seat).upCost);
const dealt = (dmg, armor) => dmg * 10 / (10 + Math.max(0, armor));

/* ---------- passability ---------- */
function passTile(x, y) { if (x < 0 || y < 0 || x >= MW || y >= MH) return -1; const i = y * MW + x; return M.walkT[i] && !G.struct[i] ? 0 : -1; }
/* Can a big unit stand on corner (x, y)? -1 no; 0 yes; >0 only by breaking structures. mode 1 = breaker, 2 = ghost (ignores structures). */
function passVert(x, y, mode) {
  if (x < 1 || y < 1 || x >= MW || y >= MH) return -1;
  let lo = 9, hi = -1, c = 0, s0 = null;
  for (let k = 0; k < 4; k++) { const i = (y - 1 + (k >> 1)) * MW + x - 1 + (k & 1); if (!M.walkT[i]) return -1; const h = M.h[i]; if (h < lo) lo = h; if (h > hi) hi = h;
    const s = G.struct[i]; if (s && mode !== 2) { if (!mode) return -1; if (s !== s0) { c += 6 + s.hp / 60; s0 = s; } } }
  return hi - lo > 1 ? -1 : c;
}
function vertStruct(x, y) { for (let k = 0; k < 4; k++) { const tx = x - 1 + (k & 1), ty = y - 1 + (k >> 1); if (inMap(tx, ty)) { const s = G.struct[idx(tx, ty)]; if (s) return s; } } return null; }
const standOK = (u, x, y) => u.size === 2 ? passVert(Math.round(x), Math.round(y), 0) === 0 : passTile(Math.floor(x), Math.floor(y)) === 0;

/* ---------- pathfinding: A*, 8-way, no corner cutting. Tiles for small units, corners for big ones. ---------- */
const gS = new Float32Array(NV), came = new Int32Array(NV), seenG = new Uint32Array(NV), closedG = new Uint32Array(NV);
let pgen = 0; const hF = [], hI = [];
function hpush(f, i) { let n = hF.length; hF.push(f); hI.push(i); while (n > 0) { const p = (n - 1) >> 1; if (hF[p] <= f) break; hF[n] = hF[p]; hI[n] = hI[p]; n = p; } hF[n] = f; hI[n] = i; }
function hpop() { const top = hI[0], f = hF.pop(), i = hI.pop(), len = hF.length; if (len) { let n = 0; for (;;) { let c = 2 * n + 1; if (c >= len) break; if (c + 1 < len && hF[c + 1] < hF[c]) c++; if (hF[c] >= f) break; hF[n] = hF[c]; hI[n] = hI[c]; n = c; } hF[n] = f; hI[n] = i; } return top; }
const NB = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142]];
function findPath(size, wx, wy, gx, gy, adj, mode, cap) {
  const big = size === 2, off = big ? 0 : 0.5, sx = big ? Math.round(wx) : Math.floor(wx), sy = big ? Math.round(wy) : Math.floor(wy), gtx = big ? Math.round(gx) : Math.floor(gx), gty = big ? Math.round(gy) : Math.floor(gy), H = M.h;
  pgen++; hF.length = 0; hI.length = 0;
  const s = sy * VW + sx; gS[s] = 0; came[s] = -1; seenG[s] = pgen; hpush(0, s);
  let best = s, bestD = 1e9, found = -1, left = cap || 1e9;
  while (hF.length && left-- > 0) {
    const cur = hpop(); if (closedG[cur] === pgen) continue; closedG[cur] = pgen;
    const cx = cur % VW, cy = (cur / VW) | 0, dg = Math.hypot(cx + off - gx, cy + off - gy);
    if (adj > 0 ? dg <= adj : (cx === gtx && cy === gty)) { found = cur; break; }
    if (dg < bestD) { bestD = dg; best = cur; }
    for (let k = 0; k < 8; k++) {
      const dx = NB[k][0], dy = NB[k][1], nx = cx + dx, ny = cy + dy, ni = ny * VW + nx;
      if (nx < 0 || ny < 0 || nx > MW || ny > MH || closedG[ni] === pgen) continue;
      let extra;
      if (big) { extra = passVert(nx, ny, mode); if (extra < 0) continue; const m2 = mode === 2 ? 2 : 0; if (k >= 4 && (passVert(nx, cy, m2) !== 0 || passVert(cx, ny, m2) !== 0)) continue; }
      else {
        if (passTile(nx, ny) < 0) continue; const hc = H[cy * MW + cx], hn = H[ny * MW + nx]; if (hc - hn > 1 || hn - hc > 1) continue; extra = 0;
        if (k >= 4) { if (passTile(nx, cy) < 0 || passTile(cx, ny) < 0) continue; const ha = H[cy * MW + nx], hb = H[ny * MW + cx]; if (Math.abs(ha - hc) > 1 || Math.abs(hb - hc) > 1 || Math.abs(ha - hn) > 1 || Math.abs(hb - hn) > 1) continue; }
      }
      const ng = gS[cur] + NB[k][2] + extra;
      if (seenG[ni] !== pgen || ng < gS[ni]) { seenG[ni] = pgen; gS[ni] = ng; came[ni] = cur; hpush(ng + Math.hypot(nx + off - gx, ny + off - gy), ni); }
    }
  }
  const end = found >= 0 ? found : best, path = [];
  for (let c = end; c !== s && c >= 0; c = came[c]) path.push({ x: (c % VW) + off, y: ((c / VW) | 0) + off });
  path.reverse();
  if (!path.length && found >= 0 && Math.hypot(sx + off - wx, sy + off - wy) > 0.05) path.push({ x: sx + off, y: sy + off });
  return { path, reached: found >= 0 };
}
/* Any-angle movement: A* gives a tile route, then waypoints are dropped wherever a straight line is clear. */
function clearAt(size, x, y) {
  const r = size === 2 ? 0.95 : 0.3, x0 = Math.floor(x - r), x1 = Math.floor(x + r), y0 = Math.floor(y - r), y1 = Math.floor(y + r); let lo = 9, hi = -1;
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) { if (passTile(tx, ty) < 0) return false; const h = M.h[ty * MW + tx]; if (h < lo) lo = h; if (h > hi) hi = h; }
  return hi - lo <= 1;
}
function los(size, ax, ay, bx, by) { const d = Math.hypot(bx - ax, by - ay), n = Math.ceil(d / 0.3); for (let k = 1; k <= n; k++) if (!clearAt(size, ax + (bx - ax) * k / n, ay + (by - ay) * k / n)) return false; return true; }
function smoothPath(size, x, y, path) {
  const out = []; let cx = x, cy = y, i = 0;
  while (i < path.length) { let k = i; for (let j = Math.min(path.length - 1, i + 16); j > i; j--) if (los(size, cx, cy, path[j].x, path[j].y)) { k = j; break; } out.push(path[k]); cx = path[k].x; cy = path[k].y; i = k + 1; }
  return out;
}
const turn = (c, dx, dy, dt) => { c.face += angDiff(Math.atan2(dy, dx), c.face) * Math.min(1, dt * 12); };
const nodeBlocked = (u, p) => u.size === 2 ? passVert(Math.round(p.x), Math.round(p.y), u.bPhase > 0 ? 2 : 0) !== 0 : passTile(Math.floor(p.x), Math.floor(p.y)) < 0;
/* Walk toward a goal. Returns 'moving' | 'arrived' | 'blocked'. */
function followTo(c, gx, gy, adj, dt, speed, lazy) {
  const ghost = c.bPhase > 0 ? 2 : 0, key = (lazy ? (gx | 0) + ',' + (gy | 0) : (gx * 4 | 0) + ',' + (gy * 4 | 0)) + ',' + adj + ',' + ghost;
  c.repT -= dt;
  let need = !c.path || (c.pathKey !== key && (!lazy || c.repT <= 0));
  if (!need && c.pi < c.path.length && c.repT <= 0) { c.repT = 0.3; if (nodeBlocked(c, c.path[c.pi]) || (!ghost && !los(c.size, c.x, c.y, c.path[c.pi].x, c.path[c.pi].y))) need = true; }
  if (need) {
    const r = findPath(c.size, c.x, c.y, gx, gy, adj, ghost, c.kind === 'worker' ? 2500 : 9000);
    c.pi = 0; c.pathKey = key; c.partial = !r.reached; c.repT = 0.3;
    if (r.reached && adj === 0 && !ghost && clearAt(c.size, gx, gy)) { if (r.path.length) r.path[r.path.length - 1] = { x: gx, y: gy }; else r.path.push({ x: gx, y: gy }); }
    c.path = ghost ? r.path : smoothPath(c.size, c.x, c.y, r.path);
  }
  if (c.pi >= c.path.length) { c.path = null; return c.partial ? 'blocked' : 'arrived'; }
  const p = c.path[c.pi];
  if (nodeBlocked(c, p)) return 'moving';
  const dx = p.x - c.x, dy = p.y - c.y, d = Math.hypot(dx, dy), step = speed * dt;
  if (d <= step) { c.x = p.x; c.y = p.y; c.pi++; } else { c.x += dx / d * step; c.y += dy / d * step; turn(c, dx, dy, dt); }
  c.moving = true;
  return 'moving';
}
function speedOf(u) {
  const base = u.kind === 'titan' ? TITANS[u.tk].speed : UNITS[u.kind].speed;
  return base * (1 - u.slowed) * (u.bSlow > 0 ? 0.5 : 1) * (u.bBurrow > 0 ? 1.55 : 1) * (u.kind === 'titan' && u.hp < u.maxHp * 0.4 ? 1.35 : 1);
}

/* ---------- resource nodes: plants and lumen crystals ---------- */
const isNode = v => v === TREE || v === CRYSTAL;
function takeNode(i, n) { if (!isNode(M.tiles[i])) return 0; const got = Math.min(n, M.wood[i]); M.wood[i] -= got; if (M.wood[i] <= 0) fellNode(i, true); return got; }
function fellNode(i, loud) {
  if (!isNode(M.tiles[i])) return;
  M.tiles[i] = GROUND; M.walkT[i] = 1; M.wood[i] = 0; if ((M.h[i] === 0 || M.h[i] === TOP) && M.far[i]) M.buildable[i] = 1;
  if (Net.mode === 'host') { G.nodeQ.push(i); G.nodesGone.push(i); }
  nodeGone(i, loud);
}
function nearestNode(x, y, r, bad) {
  let b = -1, bd = 1e9; const x0 = Math.max(0, Math.floor(x - r)), x1 = Math.min(MW - 1, Math.ceil(x + r)), y0 = Math.max(0, Math.floor(y - r)), y1 = Math.min(MH - 1, Math.ceil(y + r));
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) { const i = ty * MW + tx; if (!isNode(M.tiles[i]) || (bad && bad.has(i))) continue; const d = Math.hypot(tx + .5 - x, ty + .5 - y); if (d < bd && d <= r) { bd = d; b = i; } }
  return b;
}
function credit(S, n, x, y) { S.lumen += n; S.inc.push([G.t, n]); if (S.id === Local.seat && x !== undefined) floatText(x, y, '+' + n, COL.lumen); }

/* ---------- construction: everything is 2x2, anchored at its north-west tile ---------- */
const FOOT = [[0, 0], [1, 0], [0, 1], [1, 1]];
const costOf = (S, type) => DEFS[type].cost;
const workerCost = S => 25 + 4 * S.workers;
/* Why a seat cannot place this here, or '' if it can. */
function placeBlock(S, type, tx, ty, free) {
  let h0 = -1;
  for (const [dx, dy] of FOOT) { const x = tx + dx, y = ty + dy; if (!inMap(x, y)) return 'off the map'; const i = idx(x, y);
    if (!M.buildable[i]) return isNode(M.tiles[i]) ? 'resources in the way' : 'cannot build there';
    if (G.struct[i] || G.reserved[i]) return 'occupied';
    if (h0 < 0) h0 = M.h[i]; else if (M.h[i] !== h0) return 'uneven ground'; }
  if (free) return '';
  if (DEFS[type].forge && !S.forge) return 'needs a Forge';
  if (S.lumen < costOf(S, type)) return 'need ' + costOf(S, type) + ' Lumen';
  return '';
}
function orderBuild(u, type, tx, ty, queue) {
  const S = G.seats[u.seat]; if (placeBlock(S, type, tx, ty)) return false;
  const cost = costOf(S, type); S.lumen -= cost;
  for (const [dx, dy] of FOOT) G.reserved[idx(tx + dx, ty + dy)] = 1;
  if (!queue) clearOrders(u, true);
  u.orders.push({ t: 'build', type, tx, ty, cost });
  return true;
}
function dropOrder(u, o) { if (o.t === 'build') { G.seats[u.seat].lumen += o.cost; for (const [dx, dy] of FOOT) G.reserved[idx(o.tx + dx, o.ty + dy)] = 0; } }
/* keepBuilds: a new build order should not cancel blueprints already queued */
function clearOrders(u, keepBuilds) { const keep = []; for (const o of u.orders) { if (keepBuilds && o.t === 'build') keep.push(o); else dropOrder(u, o); } u.orders = keep; u.path = null; }
function mkStruct(seat, type, tx, ty, done) {
  const d = DEFS[type], mh = hpOf(type, 0, seat), bt = d.build * facOf(seat).buildTime;
  const s = { id: ++uid, type, tx, ty, x: tx + 1, y: ty + 1, seat, lvl: 0, maxHp: mh, hp: done ? mh : mh * 0.15, buildT: done ? 0 : bt, buildTotal: bt,
    cd: Math.random() * 0.5, aim: Math.PI / 2, spent: d.cost, flash: 0, active: false, tgt: null, scanT: 0, dead: false, recoil: 0 };
  for (const [dx, dy] of FOOT) { const i = idx(tx + dx, ty + dy); G.struct[i] = s; G.reserved[i] = 0; }
  G.structs.push(s); return s;
}
function upgradeBlock(s) {
  const S = G.seats[s.seat], d = DEFS[s.type];
  if (s.dead || s.buildT > 0) return 'still building'; if (s.lvl >= 2) return 'fully upgraded';
  if (!S.forge && s.type !== 'forge') return 'needs a Forge';
  if (s.lvl === 1 && S.flux < d.flux) return 'need ' + d.flux + ' Flux';
  if (S.lumen < upCostOf(s)) return 'need ' + upCostOf(s) + ' Lumen';
  return '';
}
function upgrade(s) {
  if (upgradeBlock(s)) return false;
  const S = G.seats[s.seat], d = DEFS[s.type], cost = upCostOf(s);
  S.lumen -= cost; if (s.lvl === 1) S.flux -= d.flux; s.spent += cost; s.lvl++;
  const nh = hpOf(s.type, s.lvl, s.seat); s.hp += nh - s.maxHp; s.maxHp = nh;
  fire({ e: 'up', x: s.x, y: s.y, s: s.seat });
  return true;
}
function freeTileNear(s) { for (let r = 1; r <= 4; r++) for (let dy = -r; dy <= r + 1; dy++) for (let dx = -r; dx <= r + 1; dx++) { const x = s.tx + dx, y = s.ty + dy; if (passTile(x, y) === 0 && Math.abs(M.h[idx(x, y)] - M.h[idx(s.tx, s.ty)]) <= 1) return { x, y }; } return null; }
function trainWorker(s, free) {
  const S = G.seats[s.seat]; if (s.type !== 'bay' || s.dead || s.buildT > 0 || S.workers >= MAX_WORKERS || (!free && S.lumen < workerCost(S))) return null;
  const spot = freeTileNear(s); if (!spot) return null;
  if (!free) S.lumen -= workerCost(S); S.workers++;
  const w = mkUnit('worker', s.seat, spot.x + .5, spot.y + .5); w.hp = w.maxHp = UNITS.worker.hp; w.bay = s.id; w.thinkT = 0.1; G.units.push(w);
  fire({ e: 'up', x: s.x, y: s.y, s: s.seat });
  return w;
}
function salvage(s) { if (s.dead) return; G.seats[s.seat].lumen += Math.floor(s.spent * 0.6 * (s.hp / s.maxHp)); removeStruct(s, false); }
function removeStruct(s, destroyed) {
  if (s.dead) return; s.dead = true; G.dirty = true;
  for (const [dx, dy] of FOOT) G.struct[idx(s.tx + dx, s.ty + dy)] = null;
  if (Net.mode === 'host') G.removed.push(s.id);
  structGone(s, destroyed);
}
function damageStruct(s, dmg, src) {
  if (s.dead) return; dmg = dealt(dmg, DEFS[s.type].armor[s.lvl]); s.hp -= dmg; s.flash = 0.15;
  if (src && src.kind === 'titan') gainXp(src, dmg / 25);
  if (s.hp <= 0) { if (src && src.team === 1) gainXp(G.titan, 8); removeStruct(s, true); }
}
function unitInFoot(tx, ty, except) { for (const c of G.units) { if (c === except || !c.alive || c.dormant) continue; const m = c.size === 2 ? 1 : 0; if (c.x > tx - m && c.x < tx + 2 + m && c.y > ty - m && c.y < ty + 2 + m) return true; } return false; }

/* ---------- Builders ---------- */
const repairCostPerHp = (s, seat) => DEFS[s.type].cost / hpOf(s.type, 0, s.seat) * 0.35 * facOf(seat).repairCost;
function doRepair(u, o, dt, rate) {
  const s = structById(o.sid), S = G.seats[u.seat];
  if (!s || s.buildT > 0 || s.hp >= s.maxHp || G.seats[s.seat].role !== 'builder') { u.orders.shift(); return; }
  if (Math.hypot(s.x - u.x, s.y - u.y) > 3.3) { if (followTo(u, s.x, s.y, 3.1, dt, speedOf(u)) === 'blocked') u.orders.shift(); u.act = 'moving'; return; }
  const add = Math.min(rate * dt, s.maxHp - s.hp), cost = add * repairCostPerHp(s, u.seat);
  if (S.lumen < cost) { u.orders.shift(); fire({ e: 'say', m: 'Not enough Lumen to keep repairing.', c: 'warn', to: u.seat }); return; }
  S.lumen -= cost; s.hp += add; u.face = Math.atan2(s.y - u.y, s.x - u.x); u.beam = { x: s.x, y: s.y, k: 2 }; u.act = 'repairing';
}
function updBuilder(c, dt) {
  const S = G.seats[c.seat], F = FACTIONS[S.fac];
  c.hitT += dt; if (c.hitT > 5 && c.hp < c.maxHp) c.hp = Math.min(c.maxHp, c.hp + 4 * dt);
  c.dashCd = Math.max(0, c.dashCd - dt); c.bSlow = Math.max(0, c.bSlow - dt); c.beam = null; c.harvesting = false; c.moving = false; c.flash = Math.max(0, c.flash - dt); c.act = 'idle';
  if (S.bot) botBuilder(c, S, dt);
  const o = c.orders[0];
  if (o) {
    if (o.t === 'move') { c.act = 'moving'; if (followTo(c, o.x, o.y, 0, dt, speedOf(c)) !== 'moving') c.orders.shift(); }
    else if (o.t === 'build') {
      const jx = o.tx + 1, jy = o.ty + 1, d = Math.hypot(jx - c.x, jy - c.y); c.act = 'building';
      if (c.x > o.tx && c.x < o.tx + 2 && c.y > o.ty && c.y < o.ty + 2) {
        let best = null, bd = 1e9;
        for (let dy = -1; dy <= 2; dy++) for (let dx = -1; dx <= 2; dx++) { if (dx >= 0 && dx <= 1 && dy >= 0 && dy <= 1) continue; const nx = o.tx + dx, ny = o.ty + dy; if (passTile(nx, ny) < 0 || G.reserved[idx(nx, ny)]) continue; const dd = Math.hypot(nx + .5 - c.x, ny + .5 - c.y); if (dd < bd) { bd = dd; best = { x: nx + .5, y: ny + .5 }; } }
        if (best) c.orders.unshift({ t: 'move', x: best.x, y: best.y }); else { dropOrder(c, o); c.orders.shift(); }
      } else if (d <= BUILD_RANGE) {
        c.face = Math.atan2(jy - c.y, jx - c.x);
        if (unitInFoot(o.tx, o.ty, c)) { if (c.orders.length > 1) c.orders.push(c.orders.shift()); }
        else { c.orders.shift(); mkStruct(c.seat, o.type, o.tx, o.ty, false); c.beam = { x: jx, y: jy, k: 1 }; if (c.seat === Local.seat) sfx('place'); }
      } else if (followTo(c, jx, jy, BUILD_RANGE - 0.6, dt, speedOf(c)) === 'blocked' && Math.hypot(jx - c.x, jy - c.y) > BUILD_RANGE) { dropOrder(c, o); c.orders.shift(); fire({ e: 'say', m: 'Can\'t reach that spot. Order cancelled and refunded.', c: 'warn', to: c.seat }); }
    } else if (o.t === 'harvest') {
      const i = idx(o.tx, o.ty), v = M.tiles[i];
      if (!isNode(v) && v !== VEIN) { const n = o.node ? nearestNode(c.x, c.y, 4) : -1; if (n >= 0) { o.tx = n % MW; o.ty = (n / MW) | 0; c.path = null; } else c.orders.shift(); }
      else {
        const hx = v === VEIN ? CX : o.tx + .5, hy = v === VEIN ? CY : o.ty + .5, reach = v === VEIN ? 2.4 : 1.6, d = Math.hypot(hx - c.x, hy - c.y);
        if (d <= reach) { c.harvesting = true; c.face = Math.atan2(hy - c.y, hx - c.x); c.beam = { x: hx, y: hy, k: v === VEIN ? 3 : 0 }; c.act = v === VEIN ? 'drawing Flux' : 'harvesting'; c.chop += dt;
          if (v === VEIN) { if (c.chop >= 3) { c.chop = 0; S.flux += 1; if (c.seat === Local.seat) floatText(c.x, c.y, '+1 Flux', COL.flux); } }
          else if (c.chop >= 1) { c.chop = 0; const got = takeNode(i, 4); if (got) credit(S, got, c.x, c.y); } }
        else { c.act = 'moving'; if (followTo(c, hx, hy, reach - 0.1, dt, speedOf(c)) === 'blocked') {
            // that one is walled in by its neighbours: take the closest reachable-looking node beside it instead
            (o.bad = o.bad || new Set()).add(i); let best = -1, bd = 1e9;
            if (v !== VEIN && o.bad.size < 10) for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) { const x = o.tx + dx, y = o.ty + dy; if (!inMap(x, y)) continue; const n = idx(x, y); if (!isNode(M.tiles[n]) || o.bad.has(n)) continue; const d = Math.hypot(x + .5 - c.x, y + .5 - c.y); if (d < bd) { bd = d; best = n; } }
            if (best >= 0) { o.tx = best % MW; o.ty = (best / MW) | 0; c.path = null; } else c.orders.shift(); } }
      }
    } else if (o.t === 'repair') doRepair(c, o, dt, 48);
    else c.orders.shift();
  } else if (F.auto || S.bot) { // robots (and bot players) mend what is near them without being told
    let worst = 1, tgt = null; for (const s of G.structs) { if (s.dead || s.buildT > 0 || s.hp >= s.maxHp || s.seat !== c.seat) continue; if (Math.hypot(s.x - c.x, s.y - c.y) > REPAIR_R) continue; const f = s.hp / s.maxHp; if (f < worst) { worst = f; tgt = s; } }
    if (tgt) { tgt.hp = Math.min(tgt.maxHp, tgt.hp + (S.bot ? 34 : 16) * dt); c.beam = { x: tgt.x, y: tgt.y, k: 2 }; c.act = 'repairing'; }
  }
}
function dash(c, wx, wy) {
  if (!c.alive || c.dashCd > 0) return false;
  const dx = wx - c.x, dy = wy - c.y, d = Math.hypot(dx, dy) || 1, maxD = Math.min(d, DASH_R);
  let bx = c.x, by = c.y;
  for (let s = 0.25; s <= maxD + 1e-6; s += 0.25) { const x = c.x + dx / d * s, y = c.y + dy / d * s; if (standOK(c, x, y)) { bx = x; by = y; } }
  if (Math.hypot(bx - c.x, by - c.y) < 0.4) return false;
  fire({ e: 'dash', x1: c.x, y1: c.y, x2: bx, y2: by, s: c.seat });
  c.x = bx; c.y = by; c.path = null; c.dashCd = facOf(c.seat).dashCd; c.face = Math.atan2(dy, dx); if (c.orders[0] && c.orders[0].t === 'move') c.orders.shift();
  return true;
}
/* ---------- workers: walk to a node, harvest, carry the load to a Drone Bay, repeat ---------- */
function nearestBay(w) { let b = null, bd = 1e9; for (const s of G.structs) if (!s.dead && s.seat === w.seat && s.type === 'bay' && s.buildT <= 0) { const d = Math.hypot(s.x - w.x, s.y - w.y); if (d < bd) { bd = d; b = s; } } return b; }
function updWorker(w, dt) {
  const S = G.seats[w.seat]; w.moving = false; w.harvesting = false; w.beam = null; w.flash = Math.max(0, w.flash - dt); w.hitT += dt; w.bSlow = Math.max(0, w.bSlow - dt); w.act = 'idle';
  const o = w.orders[0];
  if (o) {
    if (o.t === 'move') { w.act = 'moving'; if (followTo(w, o.x, o.y, 0, dt, speedOf(w)) !== 'moving') w.orders.shift(); return; }
    if (o.t === 'repair') { doRepair(w, o, dt, 22); return; }
    if (o.t === 'harvest') { const i = idx(o.tx, o.ty); w.orders.shift(); if (isNode(M.tiles[i])) { w.auto = true; w.node = i; w.wstate = w.carry > 0 ? 'back' : 'go'; w.bad = null; w.path = null; } }
    else w.orders.shift();
  }
  if (!w.auto) return;
  if (w.wstate === 'seek') {
    w.thinkT -= dt; if (w.thinkT > 0) return; w.thinkT = 0.7;
    const bay = structById(w.bay) || nearestBay(w); if (!bay) return; w.bay = bay.id;
    let t = nearestNode(w.x, w.y, 6, w.bad); if (t < 0 || Math.hypot((t % MW) + .5 - bay.x, ((t / MW) | 0) + .5 - bay.y) > BAY_RANGE + 4) t = nearestNode(bay.x, bay.y, BAY_RANGE + 4, w.bad);
    if (t < 0) { w.bad = null; return; }
    w.node = t; w.wstate = 'go'; w.path = null;
  } else if (w.wstate === 'go') {
    if (!isNode(M.tiles[w.node])) { w.wstate = 'seek'; w.thinkT = 0; return; }
    const hx = (w.node % MW) + .5, hy = ((w.node / MW) | 0) + .5; w.act = 'going to harvest';
    if (Math.hypot(hx - w.x, hy - w.y) <= 1.6) { w.wstate = 'chop'; w.workT = 3; w.fails = 0; w.face = Math.atan2(hy - w.y, hx - w.x); return; }
    if (followTo(w, hx, hy, 1.5, dt, speedOf(w)) === 'blocked') { (w.bad = w.bad || new Set()).add(w.node); w.wstate = 'seek'; w.fails = (w.fails || 0) + 1; w.thinkT = Math.min(6, 0.4 * w.fails); w.act = 'no path to resources'; }
  } else if (w.wstate === 'chop') {
    if (!isNode(M.tiles[w.node])) { w.wstate = 'seek'; w.thinkT = 0; return; }
    w.harvesting = true; w.act = 'harvesting'; w.beam = { x: (w.node % MW) + .5, y: ((w.node / MW) | 0) + .5, k: 0 }; w.workT -= dt;
    if (w.workT <= 0) { const bay = structById(w.bay), lv = bay ? bay.lvl : 0; w.carry = takeNode(w.node, Math.round(DEFS.bay.carry[lv] * facOf(w.seat).carry)); w.wstate = w.carry > 0 ? 'back' : 'seek'; w.path = null; }
  } else {
    let bay = structById(w.bay); if (!bay || bay.buildT > 0) { bay = nearestBay(w); if (!bay) return; w.bay = bay.id; }
    w.act = 'returning cargo';
    if (Math.hypot(bay.x - w.x, bay.y - w.y) <= 2.3) { credit(S, w.carry, bay.x, bay.y); w.carry = 0; w.wstate = isNode(M.tiles[w.node]) ? 'go' : 'seek'; w.thinkT = 0; w.path = null; return; }
    if (followTo(w, bay.x, bay.y, 2.2, dt, speedOf(w)) === 'blocked') w.repT = 1;
  }
}
function damageUnit(u, dmg, src) {
  if (!u.alive || u.dormant || u.bPhase > 0) return;
  dmg = dealt(dmg, u.armor) * (u.bReinf > 0 ? 0.35 : 1); u.hp -= dmg; u.hitT = 0; u.flash = 0.15;
  if (u.hp > 0) return;
  u.hp = 0; u.alive = false;
  if (u.kind === 'titan') { fire({ e: 'die', x: u.x, y: u.y, k: 'titan' }); endGame('builders', 'kill'); return; }
  const S = G.seats[u.seat];
  if (u.kind === 'husk') { S.respawnT = 15; fire({ e: 'die', x: u.x, y: u.y, k: 'husk' }); return; }
  if (u.kind === 'brood') { fire({ e: 'die', x: u.x, y: u.y, k: 'brood' }); return; }
  if (u.kind === 'worker') { S.workers = Math.max(0, S.workers - 1); gainXp(G.titan, 12); fire({ e: 'die', x: u.x, y: u.y, k: 'worker', s: u.seat }); return; }
  S.dead = true; S.respawnT = 6; clearOrders(u);
  for (const w of G.units) if (w.kind === 'worker' && w.seat === u.seat && w.alive) { w.alive = false; fire({ e: 'die', x: w.x, y: w.y, k: 'worker', s: w.seat }); }
  const a = G.titan; if (a) { gainXp(a, 60); a.hp = Math.min(a.maxHp, a.hp + a.maxHp * 0.15); if (a.ai) { a.ai.target = null; a.path = null; } }
  fire({ e: 'die', x: u.x, y: u.y, k: 'builder', s: u.seat });
  fire({ e: 'say', m: `${S.name} has fallen. Their base collapses and they rise as a husk.`, c: 'warn' });
  if (G.titan && !G.seats.some(s => s.role === 'builder' && !s.dead)) endGame('titan', 'wipe');
}

/* ---------- bot Builders: walk into the chamber's base spot, ring up, upgrade ---------- */
const TEMPLATE = (() => {
  const t = [['pulse', -1, -1], ['pulse', 1, 1]];
  for (let x = -2; x <= 2; x++) { t.push(['wall', x, -2]); t.push(['wall', x, 2]); }
  for (let y = -1; y <= 1; y++) { t.push(['wall', -2, y]); t.push(['wall', 2, y]); }
  t.push(['pulse', 1, -1], ['pulse', -1, 1], ['forge', -1, 0], ['mend', 0, 1], ['stasis', 1, 0], ['lance', 0, -1]);
  return t;
})();
const UP_PRI = { pulse: 0, lance: 1, wall: 2, mend: 3, stasis: 4, forge: 5, bay: 6 };
function botBuilder(c, S, dt) {
  S.lumen += (3.5 + 1.2 * G.t / 60) * G.diff.ally * dt; S.flux += dt / 30;
  c.thinkT -= dt; if (c.thinkT > 0) return; c.thinkT = 0.5;
  const sx = c.site.x + .5, sy = c.site.y + .5;
  if (!c.atSite) { if (Math.hypot(c.x - sx, c.y - sy) < 0.3) c.atSite = true; else if (!c.orders.length) c.orders.push({ t: 'move', x: sx, y: sy }); return; }
  if (c.orders.length) return;
  for (const [type, dx, dy] of TEMPLATE) {
    const tx = c.site.x + dx * 2 - 1, ty = c.site.y + dy * 2 - 1;
    if (FOOT.some(([fx, fy]) => !inMap(tx + fx, ty + fy) || G.struct[idx(tx + fx, ty + fy)] || !M.buildable[idx(tx + fx, ty + fy)])) continue;
    if (DEFS[type].forge && !S.forge) continue;
    if (!placeBlock(S, type, tx, ty)) orderBuild(c, type, tx, ty, true);
    return;
  }
  let best = null, bk = 1e9;
  for (const s of G.structs) { if (s.seat !== c.seat || s.dead || s.buildT > 0 || s.lvl >= 2) continue; if (s.lvl === 1 && S.flux < DEFS[s.type].flux) continue; const k = s.lvl * 10 + UP_PRI[s.type]; if (k < bk) { bk = k; best = s; } }
  if (best) upgrade(best);
}

/* ---------- structures ---------- */
function turretTarget(s, range) {
  let best = null, bd = 1e9;
  for (const u of G.units) { if (u.team !== 1 || !targetable(u)) continue; const d = Math.hypot(u.x - s.x, u.y - s.y); if (d > range) continue; const k = d + (u.kind === 'titan' ? -100 : 0); if (k < bd) { bd = k; best = u; } }
  return best;
}
function updStruct(s, dt) {
  if (s.dead) return; s.flash = Math.max(0, s.flash - dt); s.recoil = Math.max(0, s.recoil - dt);
  const d = DEFS[s.type], S = G.seats[s.seat], F = FACTIONS[S.fac];
  if (S.dead) { if (Local.host) { s.hp -= s.maxHp * (0.4 + hash2(s.tx, s.ty) * 0.5) * dt; if (s.hp <= 0) removeStruct(s, true); } return; }
  if (s.buildT > 0) { if (Local.host) { s.buildT -= dt; s.hp = Math.min(s.maxHp, s.hp + s.maxHp * 0.85 * dt / s.buildTotal); if (s.buildT <= 0 && s.seat === Local.seat && s.type !== 'wall') sfx('done', s.x, s.y); } return; }
  if (Local.host && F.regen && s.hp < s.maxHp) s.hp = Math.min(s.maxHp, s.hp + s.maxHp * F.regen * dt);
  switch (s.type) {
    case 'pulse': case 'lance': {
      s.cd -= dt; const tg = turretTarget(s, d.range); if (!tg) break;
      s.aim = Math.atan2(tg.y - s.y, tg.x - s.x);
      if (s.cd <= 0) { s.cd = d.rate; s.recoil = 0.18;
        if (s.type === 'pulse') { G.shots.push({ x: s.x + Math.cos(s.aim) * .9, y: s.y + Math.sin(s.aim) * .9, dmg: d.dmg[s.lvl], seat: s.seat, tg, dead: false, fac: S.fac }); sfx('pulse', s.x, s.y); }
        else { G.beams.push({ x1: s.x, y1: s.y, h1: 2.7, x2: tg.x, y2: tg.y, h2: 1, col: S.fac === 'alien' ? '#b6ff7a' : '#d6fbff', w: 0.14 + 0.05 * s.lvl, life: 0.3, max: 0.3 }); if (Local.host) { damageUnit(tg, d.dmg[s.lvl] * F.lance, s.seat); } burst(tg.x, tg.y, '#d6fbff', 6, 3, 1); sfx('lance', s.x, s.y); }
      }
      break;
    }
    case 'stasis': s.active = false; for (const u of G.units) if (u.team === 1 && targetable(u) && Math.hypot(u.x - s.x, u.y - s.y) <= d.range) { s.active = true; u.slow = Math.max(u.slow, Math.min(0.7, d.slow[s.lvl] + F.slow)); } break;
    case 'mend': {
      s.scanT -= dt;
      if (s.scanT <= 0) { s.scanT = 0.4; s.tgt = null; let worst = 1;
        for (const o of G.structs) { if (o === s || o.dead || o.buildT > 0 || o.hp >= o.maxHp || !seatAlive(o.seat)) continue; if (Math.hypot(o.x - s.x, o.y - s.y) > d.range) continue; const f = o.hp / o.maxHp; if (f < worst) { worst = f; s.tgt = o; } } }
      if (s.tgt && !s.tgt.dead && s.tgt.hp < s.tgt.maxHp) { if (Local.host) s.tgt.hp = Math.min(s.tgt.maxHp, s.tgt.hp + d.heal[s.lvl] * dt); } else s.tgt = null;
      break;
    }
  }
}

/* ---------- Titan-side combat ---------- */
const reachOf = (u, isS) => Math.max(u.size === 2 ? (isS ? 2.95 : 1.95) : (isS ? 1.95 : 1.25), u.kind === 'titan' ? TITANS[u.tk].range : 0);
const rateOf = u => u.kind === 'titan' ? TITANS[u.tk].rate : UNITS[u.kind].rate;
function strike(u, tg, isStruct) {
  u.face = Math.atan2(tg.y - u.y, tg.x - u.x); u.sieging = tg; u.act = 'attacking';
  if (u.atkCd > 0) return;
  u.atkCd = rateOf(u) / (1 - u.slowed * 0.6); u.bBurrow = 0;
  if (u.kind === 'titan' && TITANS[u.tk].range > 3) fire({ e: 'fx', k: 'bolt', x1: u.x, y1: u.y, x2: tg.x, y2: tg.y });
  if (isStruct) damageStruct(tg, u.dmg, u); else damageUnit(tg, u.dmg, u.seat);
}
function reachEnemy(u, extra) {
  let best = null, bd = reachOf(u, false) + (extra || 0);
  for (const c of G.units) { if (c.team !== 0 || !c.alive) continue; const d = Math.hypot(c.x - u.x, c.y - u.y) - (c.kind === 'builder' ? 0.3 : 0); if (d < bd) { bd = d; best = c; } }
  if (best) return [best, false];
  bd = reachOf(u, true) + (extra || 0); for (const s of G.structs) { if (s.dead) continue; const d = Math.hypot(s.x - u.x, s.y - u.y); if (d < bd) { bd = d; best = s; } }
  return best ? [best, true] : null;
}
function engage(u, tg, isS, dt) {
  const reach = reachOf(u, isS);
  if (Math.hypot(tg.x - u.x, tg.y - u.y) <= reach) { strike(u, tg, isS); return true; }
  if (u.hold) return false;
  u.act = 'moving';
  if (followTo(u, tg.x, tg.y, reach - 0.1, dt, speedOf(u), !isS) === 'blocked') { const e = reachEnemy(u); if (e) strike(u, e[0], e[1]); else return false; }
  return true;
}
/* Player-driven combat unit: follow the order queue, strike what is in reach when idle. */
function combatUpdate(u, dt) {
  const o = u.orders[0];
  if (!o) { u.act = u.hold ? 'holding' : 'idle'; const e = reachEnemy(u); if (e) strike(u, e[0], e[1]); return; }
  if (o.t === 'move') { u.act = 'moving'; if (followTo(u, o.x, o.y, 0, dt, speedOf(u)) !== 'moving') u.orders.shift(); return; }
  if (o.t === 'amove') { const e = reachEnemy(u, 5); if (e && engage(u, e[0], e[1], dt)) return; u.act = 'attack-moving'; if (followTo(u, o.x, o.y, 0, dt, speedOf(u)) !== 'moving') u.orders.shift(); return; }
  if (o.t === 'attack') { const tg = o.sid ? structById(o.sid) : unitById(o.uid); if (!tg || tg.alive === false || !engage(u, tg, !!o.sid, dt)) u.orders.shift(); return; }
  u.orders.shift();
}
/* Bot-driven: path through the cheapest structures and break what blocks. Returns true when in reach of the goal. */
function huntStep(u, gx, gy, adj, dt) {
  if (Math.hypot(u.x - gx, u.y - gy) <= adj + 0.1) return true;
  u.repT -= dt;
  if (!u.path || u.repT <= 0) { const r = findPath(2, u.x, u.y, gx, gy, adj, u.bPhase > 0 ? 2 : 1); u.path = u.bPhase > 0 ? r.path : smoothPath(2, u.x, u.y, r.path); u.pi = 0; u.repT = 0.5; }
  if (u.pi >= u.path.length) return false;
  const p = u.path[u.pi], s = u.bPhase > 0 ? null : vertStruct(p.x, p.y);
  if (s) { strike(u, s, true); return false; }
  const dx = p.x - u.x, dy = p.y - u.y, d = Math.hypot(dx, dy), step = speedOf(u) * dt;
  if (d <= step) { u.x = p.x; u.y = p.y; u.pi++; } else { u.x += dx / d * step; u.y += dy / d * step; turn(u, dx, dy, dt); }
  u.moving = true; u.act = 'moving'; return false;
}
/* ---------- Titan abilities: one cast function, four kits ---------- */
function areaHit(a, x, y, r, sd, ud, slowT) {
  for (const o of G.structs) if (!o.dead && Math.hypot(o.x - x, o.y - y) <= r + 0.7) damageStruct(o, sd, a);
  for (const c of G.units) if (c.team === 0 && c.alive && Math.hypot(c.x - x, c.y - y) <= r) { damageUnit(c, ud, a.seat); if (slowT) c.bSlow = slowT; }
}
function lineHit(a, x2, y2, w, sd, ud) {
  const dx = x2 - a.x, dy = y2 - a.y, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
  const on = (px, py, pad) => { const t = (px - a.x) * ux + (py - a.y) * uy; return t > 0 && t < len + pad && Math.abs((px - a.x) * uy - (py - a.y) * ux) < w + pad; };
  for (const o of G.structs) if (!o.dead && on(o.x, o.y, 0.9)) damageStruct(o, sd, a);
  for (const c of G.units) if (c.team === 0 && c.alive && on(c.x, c.y, 0.2)) damageUnit(c, ud, a.seat);
}
function leapTo(a, x, y, range, through) {
  const dx = x - a.x, dy = y - a.y, d = Math.hypot(dx, dy) || 1, maxD = Math.min(d, range); let bx = a.x, by = a.y;
  for (let s = 0.5; s <= maxD + 1e-6; s += 0.5) { const px = a.x + dx / d * s, py = a.y + dy / d * s; if (standOK(a, px, py)) { bx = Math.round(px); by = Math.round(py); } else if (!through) break; }
  return [bx, by, Math.hypot(bx - a.x, by - a.y)];
}
function castAbility(a, k, x, y) {
  const T = TITANS[a.tk], A = T.abil[k];
  if (!A || !a.alive || a.dormant || a.cd[k] > 0) return false;
  const L = a.lvl, m = titanMul().dmg, tk = a.tk, own = !a.ai;
  if (A.aim) { const d = Math.hypot(x - a.x, y - a.y) || 1; if (d > A.range) { x = a.x + (x - a.x) / d * A.range; y = a.y + (y - a.y) / d * A.range; } a.face = Math.atan2(y - a.y, x - a.x); }
  if (tk === 'hollow') {
    if (k === 'q') { areaHit(a, a.x, a.y, 4.3, (20 + 8 * L) * m, (20 + 8 * L) * m * 0.25); fire({ e: 'fx', k: 'slam', x: a.x, y: a.y, r: 4.3, c: COL.threat }); }
    else if (k === 'w') { const [bx, by, d] = leapTo(a, x, y, A.range, false); if (d < 1.2) return false; fire({ e: 'fx', k: 'leap', x1: a.x, y1: a.y, x2: bx, y2: by, c: COL.threat }); a.x = bx; a.y = by; a.path = null; if (own) a.orders.length = 0; areaHit(a, bx, by, 2.6, a.dmg * 0.5, a.dmg); }
    else if (k === 'e') { a.bBurrow = 5; fire({ e: 'fx', k: 'puff', x: a.x, y: a.y, c: '#8a7f8f' }); }
    else { a.revealT = 7; fire({ e: 'say', m: 'The Hollow tastes the air. Every Builder is exposed.', c: 'warn' }); fire({ e: 'roar' }); }
  } else if (tk === 'colossus') {
    if (k === 'q') { const e = reachEnemy(a, 0.6); if (!e) return false; a.face = Math.atan2(e[0].y - a.y, e[0].x - a.x); if (e[1]) damageStruct(e[0], a.dmg * 4, a); else damageUnit(e[0], a.dmg * 3, a.seat); fire({ e: 'fx', k: 'slam', x: e[0].x, y: e[0].y, r: 1.8, c: '#ffb648' }); }
    else if (k === 'w') { lineHit(a, x, y, 1.7, a.dmg * 1.6, a.dmg * 0.8); fire({ e: 'fx', k: 'wave', x1: a.x, y1: a.y, x2: x, y2: y, c: '#ffb648' }); }
    else if (k === 'e') { a.bReinf = 6; fire({ e: 'fx', k: 'puff', x: a.x, y: a.y, c: '#ffd27a' }); }
    else { areaHit(a, a.x, a.y, 7, (40 + 16 * L) * m, (40 + 16 * L) * m * 0.3); fire({ e: 'fx', k: 'slam', x: a.x, y: a.y, r: 7, c: '#ffb648' }); }
  } else if (tk === 'wraith') {
    if (k === 'q') { a.bPhase = 3.5; a.path = null; fire({ e: 'fx', k: 'puff', x: a.x, y: a.y, c: '#9f8cff' }); }
    else if (k === 'w') { lineHit(a, x, y, 0.9, a.dmg * 2.2, a.dmg * 1.2); fire({ e: 'fx', k: 'beam', x1: a.x, y1: a.y, x2: x, y2: y, c: '#b9a6ff' }); }
    else if (k === 'e') { const [bx, by, d] = leapTo(a, x, y, A.range, true); if (d < 1.2) return false; fire({ e: 'fx', k: 'blink', x1: a.x, y1: a.y, x2: bx, y2: by, c: '#9f8cff' }); a.x = bx; a.y = by; a.path = null; if (own) a.orders.length = 0; }
    else { areaHit(a, a.x, a.y, 6.5, (25 + 10 * L) * m, (25 + 10 * L) * m * 0.3, 4); fire({ e: 'fx', k: 'slam', x: a.x, y: a.y, r: 6.5, c: '#9f8cff' }); }
  } else {
    if (k === 'q') { G.pools.push({ x, y, r: 3.2, t: 6, dps: (10 + 4 * L) * m, seat: a.seat, acc: 0 }); fire({ e: 'fx', k: 'pool', x, y, r: 3.2, c: '#b6ff3a' }); }
    else if (k === 'w') { const [bx, by, d] = leapTo(a, x, y, A.range, false); if (d < 1.2) return false; lineHit(a, bx, by, 1.6, a.dmg * 1.2, a.dmg * 1.2); fire({ e: 'fx', k: 'leap', x1: a.x, y1: a.y, x2: bx, y2: by, c: '#b6ff3a' }); a.x = bx; a.y = by; a.path = null; if (own) a.orders.length = 0; areaHit(a, bx, by, 2.6, a.dmg * 0.8, a.dmg * 0.5); }
    else if (k === 'e') { a.bRegen = 5; fire({ e: 'fx', k: 'puff', x: a.x, y: a.y, c: '#74f2a4' }); }
    else { let n = 0; for (let r = 2; r <= 4 && n < 4; r++) for (let j = 0; j < 8 && n < 4; j++) { const an = j / 8 * 6.283 + r, bx = Math.floor(a.x + Math.cos(an) * r), by = Math.floor(a.y + Math.sin(an) * r); if (passTile(bx, by) !== 0) continue; const b = mkUnit('brood', a.seat, bx + .5, by + .5); b.maxHp = b.hp = UNITS.brood.hp + 15 * L; b.dmg = 5 + 1.5 * L; b.life = 22; G.units.push(b); n++; } if (!n) return false; fire({ e: 'fx', k: 'puff', x: a.x, y: a.y, c: '#b6ff3a' }); }
  }
  a.cd[k] = A.cd; a.bBurrow = k === 'e' && tk === 'hollow' ? a.bBurrow : 0; return true;
}
function pickTarget(a) {
  const ai = a.ai; let best = null, bs = 1e9;
  const spare = !ai.picked && G.seats.some(s => s.role === 'builder' && !s.dead && s.bot) && G.seats.some(s => s.role === 'builder' && !s.bot); ai.picked = true;
  for (const c of G.units) {
    if (c.kind !== 'builder' || !c.alive || (spare && !G.seats[c.seat].bot)) continue;
    let def = 0; for (const s of G.structs) { if (s.dead || s.buildT > 0 || !seatAlive(s.seat)) continue; if (s.type !== 'pulse' && s.type !== 'lance') continue; if (Math.hypot(s.x - c.x, s.y - c.y) < 11) def += DEFS[s.type].dmg[s.lvl] / DEFS[s.type].rate; }
    const sc = Math.hypot(c.x - a.x, c.y - a.y) * 0.35 + def * 0.12 + Math.random() * 26 + (c === ai.lastFailed ? 22 : 0);
    if (sc < bs) { bs = sc; best = c; }
  }
  if (best && best !== ai.target && !G.seats[best.seat].bot) fire({ e: 'say', m: `${TITANS[a.tk].name} has your scent. It is coming for you.`, c: 'warn', to: best.seat, alarm: 1 });
  ai.target = best; a.path = null; return best;
}
function botTitan(a, dt) {
  const ai = a.ai, sinkD = Math.hypot(a.x - CX, a.y - CY), tk = a.tk, low = a.hp < a.maxHp * 0.4;
  if (ai.state === 'heal') { a.act = 'recovering'; if (a.hp >= a.maxHp * 0.97) { ai.state = 'hunt'; pickTarget(a); } return; }
  if (ai.state === 'hunt' && low) { ai.state = 'retreat'; a.path = null; ai.lastFailed = ai.target; fire({ e: 'say', m: `${TITANS[a.tk].name} is wounded. It falls back to the Sink.`, c: 'good', team: 0 });
    if (tk === 'hollow') castAbility(a, 'e'); else if (tk === 'colossus') castAbility(a, 'e'); else if (tk === 'wraith') castAbility(a, 'q'); else castAbility(a, 'e'); }
  if (ai.state === 'retreat') { if (sinkD < SINK_R - 2 || huntStep(a, CX, CY + 4, 1.5, dt)) { ai.state = 'heal'; a.path = null; } return; }
  if (!ai.target || !ai.target.alive) { if (!pickTarget(a)) return; }
  const tg = ai.target, d = Math.hypot(tg.x - a.x, tg.y - a.y), reach = reachOf(a, false);
  if (tk !== 'colossus' && d > 4 && d < TITANS[tk].abil[tk === 'wraith' ? 'e' : 'w'].range && a.cd[tk === 'wraith' ? 'e' : 'w'] <= 0 && !vertStruct(Math.round((a.x + tg.x) / 2), Math.round((a.y + tg.y) / 2))) { if (castAbility(a, tk === 'wraith' ? 'e' : 'w', tg.x, tg.y)) return; }
  if (huntStep(a, tg.x, tg.y, reach - 0.15, dt)) strike(a, tg, false);
  const sg = a.sieging && a.sieging.type ? a.sieging : null;
  if (a.lvl >= 2 && (sg || d < 4)) {
    if (tk === 'hollow') castAbility(a, 'q');
    else if (tk === 'colossus') { if (!castAbility(a, 'q') && sg) { if (!castAbility(a, 'w', sg.x, sg.y)) castAbility(a, 'r'); } }
    else if (tk === 'wraith') { if (sg) castAbility(a, 'w', sg.x, sg.y); castAbility(a, 'r'); }
    else { if (sg) castAbility(a, 'q', sg.x, sg.y); castAbility(a, 'r'); if (a.hp < a.maxHp * 0.6) castAbility(a, 'e'); }
  }
}
function updTitan(a, dt) {
  a.anim += dt; a.atkCd -= dt; a.flash = Math.max(0, a.flash - dt); a.moving = false; a.sieging = null; a.hitT += dt; a.act = 'idle';
  if (a.dormant) { a.act = 'dormant'; a.wake -= dt; if (a.wake <= 0) { a.dormant = false; fire({ e: 'say', m: `${TITANS[a.tk].name} wakes in the Sink.`, c: 'warn' }); fire({ e: 'roar' }); } return; }
  for (const k in a.cd) a.cd[k] = Math.max(0, a.cd[k] - dt);
  const wasPhase = a.bPhase > 0;
  a.revealT = Math.max(0, a.revealT - dt); a.bBurrow = Math.max(0, a.bBurrow - dt); a.bPhase = Math.max(0, a.bPhase - dt); a.bReinf = Math.max(0, a.bReinf - dt); a.bRegen = Math.max(0, a.bRegen - dt);
  a.slowed = a.slow; a.slow = 0;
  if (wasPhase && a.bPhase <= 0 && !standOK(a, a.x, a.y)) { let done = false; for (let r = 1; r < 8 && !done; r++) for (let j = 0; j < 12 && !done; j++) { const x = Math.round(a.x + Math.cos(j * 0.52) * r), y = Math.round(a.y + Math.sin(j * 0.52) * r); if (passVert(x, y, 0) === 0) { a.x = x; a.y = y; a.path = null; done = true; } } }
  gainXp(a, 3 * dt);
  const sinkD = Math.hypot(a.x - CX, a.y - CY);
  a.hp = Math.min(a.maxHp, a.hp + a.maxHp * ((sinkD < SINK_R && a.hitT > 2 ? 0.07 : 0.002) + (a.bRegen > 0 ? 0.05 : 0)) * dt);
  if (a.ai) botTitan(a, dt); else combatUpdate(a, dt);
}
function updMinion(u, dt) {
  u.anim += dt; u.atkCd -= dt; u.flash = Math.max(0, u.flash - dt); u.moving = false; u.sieging = null; u.hitT += dt; u.slowed = u.slow; u.slow = 0;
  const T = G.titan, L = T ? T.lvl : 1;
  if (u.kind === 'brood') { u.life -= dt; if (u.life <= 0) { u.alive = false; fire({ e: 'die', x: u.x, y: u.y, k: 'brood' }); return; } } else { u.dmg = 6 + 2 * L; u.armor = UNITS.husk.armor; }
  const S = G.seats[u.seat], bot = u.kind === 'brood' ? (T && !!T.ai) : S.bot;
  if (!bot) { combatUpdate(u, dt); return; }
  u.thinkT -= dt;
  if (u.thinkT <= 0 || !u.tgt || !u.tgt.alive) { u.thinkT = 2; u.tgt = null; let bd = 1e9; for (const c of G.units) if (c.team === 0 && c.alive && (c.kind === 'builder' || u.kind === 'brood')) { const d = Math.hypot(c.x - u.x, c.y - u.y); if (d < bd) { bd = d; u.tgt = c; } } }
  if (!u.tgt) return;
  if (u.size === 2) { if (huntStep(u, u.tgt.x, u.tgt.y, reachOf(u, false) - 0.15, dt)) strike(u, u.tgt, false); }
  else if (!engage(u, u.tgt, false, dt)) { const e = reachEnemy(u, 1); if (e) strike(u, e[0], e[1]); }
}
function spawnHusk(S) {
  const a = (S.id * 2.4) % 6.28, u = mkUnit('husk', S.id, CX + Math.round(Math.cos(a) * 5), CY + Math.round(Math.sin(a) * 5)), L = G.titan ? G.titan.lvl : 1;
  u.maxHp = u.hp = UNITS.husk.hp + 30 * L; u.dmg = 6 + 2 * L;
  if (S.unit && S.unit.kind === 'husk') G.units.splice(G.units.indexOf(S.unit), 1);
  S.unit = u; G.units.push(u);
}

/* ---------- commands: every player action arrives here, local or remote ---------- */
function formation(n, k, sp) { if (n <= 1) return [0, 0]; const side = Math.ceil(Math.sqrt(n)); return [((k % side) - (side - 1) / 2) * sp, (Math.floor(k / side) - (Math.ceil(n / side) - 1) / 2) * sp]; }
function applyCmd(seat, c) {
  const S = G.seats[seat]; if (!S || !c || G.over && c.c !== 'dev') return;
  const num = v => typeof v === 'number' && isFinite(v), mine = u => u && u.alive && !u.dormant && u.seat === seat;
  const us = Array.isArray(c.ids) ? c.ids.slice(0, 40).map(unitById).filter(mine) : [], q = !!c.q;
  const give = (u, o) => { if (!q) clearOrders(u); u.orders.push(o); u.hold = false; if (u.kind === 'worker') u.auto = o.t === 'harvest'; };
  switch (c.c) {
    case 'mv': case 'am': if (!num(c.x) || !num(c.y)) return; us.forEach((u, k) => { const [ox, oy] = formation(us.length, k, u.size === 2 ? 2.4 : 1.1); give(u, { t: c.c === 'am' && u.team === 1 ? 'amove' : 'move', x: clamp(c.x + ox, 0.5, MW - 0.5), y: clamp(c.y + oy, 0.5, MH - 0.5) }); }); break;
    case 'st': us.forEach(u => { clearOrders(u); u.hold = false; if (u.kind === 'worker') { u.auto = false; } }); break;
    case 'hd': us.forEach(u => { clearOrders(u); u.hold = true; if (u.kind === 'worker') u.auto = false; }); break;
    case 'at': { const tg = c.sid ? structById(c.sid) : unitById(c.uid); if (!tg || (c.uid && (tg.team !== 0 || !tg.alive))) return; us.forEach(u => { if (u.team === 1) give(u, c.sid ? { t: 'attack', sid: c.sid } : { t: 'attack', uid: c.uid }); }); break; }
    case 'hv': { if (!Number.isInteger(c.tx) || !Number.isInteger(c.ty) || !inMap(c.tx, c.ty)) return; const v = M.tiles[idx(c.tx, c.ty)]; if (!isNode(v) && v !== VEIN) return;
      us.forEach(u => { if (u.kind === 'builder' || (u.kind === 'worker' && v !== VEIN)) give(u, { t: 'harvest', tx: c.tx, ty: c.ty, node: v !== VEIN }); }); break; }
    case 'rp': { const s = structById(c.sid); if (!s || G.seats[s.seat].role !== 'builder') return; us.forEach(u => { if (u.team === 0) give(u, { t: 'repair', sid: c.sid }); }); break; }
    case 'b': { const u = unitById(c.id); if (mine(u) && u.kind === 'builder' && DEFS[c.t] && Number.isInteger(c.tx) && Number.isInteger(c.ty)) orderBuild(u, c.t, c.tx, c.ty, q); break; }
    case 'ds': { const u = unitById(c.id); if (mine(u) && u.kind === 'builder' && num(c.x) && num(c.y)) dash(u, c.x, c.y); break; }
    case 'ab': { const u = unitById(c.id); if (mine(u) && u.kind === 'titan') castAbility(u, c.k, num(c.x) ? c.x : u.x, num(c.y) ? c.y : u.y); break; }
    case 'up': case 'upa': case 'sv': case 'tr': { const s = structById(c.id); if (!s || s.seat !== seat || S.dead) return;
      if (c.c === 'up') upgrade(s); else if (c.c === 'sv') { if (s.buildT <= 0) salvage(s); } else if (c.c === 'tr') trainWorker(s);
      else { const list = G.structs.filter(o => !o.dead && o.seat === seat && o.type === s.type && o.lvl === s.lvl && o.buildT <= 0).sort((a, b) => Math.hypot(a.x - s.x, a.y - s.y) - Math.hypot(b.x - s.x, b.y - s.y)); for (const o of list) if (!upgrade(o)) break; }
      break; }
  }
}
function endGame(winner, kind) { if (G.over) return; G.over = { winner, kind }; fire({ e: 'over', winner, kind, t: Math.round(G.t), l: G.titan ? G.titan.lvl : 1 }); }

/* ---------- developer tools (host or solo only) ---------- */
function devTitan(tk, x, y) {
  let S = G.seats.find(s => s.role === 'titan'); if (!S) { S = { id: G.seats.length, name: 'TITAN', role: 'titan', bot: true, bot0: true, peer: null, fac: 'human', tk, lumen: 0, flux: 0, workers: 0, forge: 0, dead: false, respawnT: 0, unit: null, col: COL.threat, chamber: -1, inc: [] }; G.seats.push(S); }
  if (G.titan) G.units = G.units.filter(u => u !== G.titan);
  S.tk = tk; const vx = Math.round(x), vy = Math.round(y), u = mkUnit('titan', S.id, vx, vy, tk);
  if (passVert(vx, vy, 0) !== 0) { u.x = CX; u.y = CY + 5; }
  u.ai = S.bot ? newAi() : null; if (u.ai) u.ai.picked = true; S.unit = u; G.titan = u; G.units.push(u); G.over = null; setTitanLevel(u, Math.max(1, Math.min(12, 1 + Math.floor(G.t / 70))), true); return u;
}
function devUnit(kind, seat, x, y) {
  const S = G.seats[seat]; if (!S) return null; const T = G.titan;
  if (kind === 'worker') { if (S.role !== 'builder') return null; const w = mkUnit('worker', seat, Math.floor(x) + .5, Math.floor(y) + .5); w.hp = w.maxHp = UNITS.worker.hp; S.workers++; G.units.push(w); return w; }
  if (!T) return null; const u = mkUnit(kind, T.seat, kind === 'husk' ? Math.round(x) : Math.floor(x) + .5, kind === 'husk' ? Math.round(y) : Math.floor(y) + .5);
  u.maxHp = u.hp = UNITS[kind].hp + (kind === 'husk' ? 30 : 15) * T.lvl; u.dmg = kind === 'husk' ? 6 + 2 * T.lvl : 5 + 1.5 * T.lvl; u.life = 60; G.units.push(u); return u;
}
function devStruct(type, seat, tx, ty) { const S = G.seats[seat]; if (!S || S.role !== 'builder' || placeBlock(S, type, tx, ty, true)) return null; return mkStruct(seat, type, tx, ty, true); }
function devControl(seat) { const S = G.seats[seat]; if (!S) return; for (const o of G.seats) o.bot = o.bot0; S.bot = false; Local.seat = seat; if (S.role === 'titan' && G.titan) G.titan.ai = null; else if (G.titan && G.seats[G.titan.seat].bot && !G.titan.ai) { G.titan.ai = newAi(); G.titan.ai.picked = true; G.titan.orders.length = 0; } }

function tick(dt) {
  const g = G; if (g.over) return; g.t += dt;
  for (const S of g.seats) { S.forge = 0; while (S.inc.length && S.inc[0][0] < g.t - 30) S.inc.shift(); }
  for (const s of g.structs) if (!s.dead && s.type === 'forge' && s.buildT <= 0) g.seats[s.seat].forge++;
  for (const s of g.structs) updStruct(s, dt);
  for (const u of g.units.slice()) { if (!u.alive) continue; if (u.kind === 'builder') updBuilder(u, dt); else if (u.kind === 'worker') updWorker(u, dt); else if (u.kind === 'titan') updTitan(u, dt); else updMinion(u, dt); if (g.over) return; }
  if ((g.cleanT = (g.cleanT || 0) + dt) > 4) { g.cleanT = 0; g.units = g.units.filter(u => u.alive || u.kind === 'builder' || u.kind === 'husk' || u.kind === 'titan'); }
  if (g.titan) for (const S of g.seats) if (S.role === 'builder' && S.dead && (!S.unit || !S.unit.alive)) { S.respawnT -= dt; if (S.respawnT <= 0) spawnHusk(S); }
  for (const p of g.pools) { p.t -= dt; p.acc += dt; if (p.acc >= 0.5) { p.acc = 0; const a = g.titan; if (a) areaHit(a, p.x, p.y, p.r, p.dps * 0.5, p.dps * 0.15); } }
  g.pools = g.pools.filter(p => p.t > 0);
  for (const p of g.shots) {
    const a = p.tg; if (!a.alive) { p.dead = true; continue; }
    const dx = a.x - p.x, dy = a.y - p.y, d = Math.hypot(dx, dy), step = 22 * dt;
    if (d <= step + 0.5) { p.dead = true; damageUnit(a, p.dmg, p.seat); burst(a.x, a.y, '#ffe1a6', 3, 2, 1); if (g.over) return; } else { p.x += dx / d * step; p.y += dy / d * step; }
  }
  g.shots = g.shots.filter(p => !p.dead);
  if (g.dirty) { g.structs = g.structs.filter(s => !s.dead); g.dirty = false; }
}
