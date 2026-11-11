/* =====================================================================
   01 core: constants, data definitions (factions, structures, units,
   Titans), and the island
   ===================================================================== */
const MW = 176, MH = 176, N = MW * MH, CX = 88, CY = 88, VW = MW + 1, NV = VW * (MH + 1);
const WATER = 0, SAND = 2, GROUND = 3, ROCK = 4, TREE = 5, NEST = 6, VEIN = 7, CRYSTAL = 8;
const STEP = 1 / 30;
const BUILD_RANGE = 6.6, DASH_R = 7, REPAIR_R = 6.5, SINK_R = 8, BAY_RANGE = 12, MAX_WORKERS = 10;
const LVL_H = 0.55, TOP = 4, WATER_Y = -0.32;   // ground levels 0..4; a plateau is level 4, ramps step 1-2-3
const COL = { lumen: '#5ef2ff', flux: '#ff7ad1', threat: '#ff3d74', ok: '#74f2a4', husk: '#c0364f' };
const SEAT_COLS = ['#ffb648', '#4fe08a', '#6f9bff', '#f2e85e', '#3fd8c8', '#ff8050', '#c9a3ff', '#ff7ab8'];
const BOT_NAMES = ['VEGA', 'ORRIN', 'TALLIS', 'MERAK', 'ISOLDE', 'BRANT', 'KETO', 'NIX'];
const MAX_BUILDERS = 8;

const $ = id => document.getElementById(id);
const idx = (x, y) => y * MW + x;
const inMap = (x, y) => x >= 0 && y >= 0 && x < MW && y < MH;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const fmtTime = s => { s = Math.max(0, Math.floor(s)); return ((s / 60) | 0) + ':' + String(s % 60).padStart(2, '0'); };
const MK = ['I', 'II', 'III'];
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function angDiff(a, b) { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }
function hash2(x, y) { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vnoise(x, y) { const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi; const s = v => v * v * (3 - 2 * v);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * s(fx) + (c - a) * s(fy) + (a - b - c + d) * s(fx) * s(fy); }

/* ---------- Builder factions: one shared rule set, different numbers and models ---------- */
const FACTIONS = {
  human: { name: 'Humans', tag: 'Industrial Colonists', builder: 'Engineer', worker: 'Hauler', wallHp: 1.3, repairCost: 0.5, buildTime: 1, regen: 0, carry: 1, slow: 0, dashCd: 14, lance: 1, upCost: 1, auto: false,
    blurb: 'Balanced and tough. Thicker walls and half-price repairs.' },
  alien: { name: 'Aliens', tag: 'Symbiotic Settlers', builder: 'Shaper', worker: 'Grub', wallHp: 1, repairCost: 1, buildTime: 0.6, regen: 0.006, carry: 1, slow: 0.12, dashCd: 8, lance: 1, upCost: 1, auto: false,
    blurb: 'Grown, not built. Fast construction, structures regrow, stronger slows, quick dash.' },
  robot: { name: 'Robots', tag: 'Autonomous Machines', builder: 'Constructor', worker: 'Drone', wallHp: 1, repairCost: 1, buildTime: 1, regen: 0, carry: 1.4, slow: 0, dashCd: 14, lance: 1.25, upCost: 0.85, auto: true,
    blurb: 'Efficient machines. Bigger harvest loads, automatic repairs, stronger energy turrets, cheaper upgrades.' },
};
const FAC_KEYS = ['human', 'alien', 'robot'];
/* Structures. Each covers 2x2 tiles. `flux` is the Flux cost of the Mk III upgrade. */
const DEFS = {
  wall:   { name: 'Bulwark',      key: 'Q', cost: 20,  hp: [520, 1150, 2500], armor: [4, 6, 9], up: [45, 100],  flux: 1, build: 2.5, h: 1.9, blurb: 'Defensive barrier. Blocks movement; leave a one-tile gap and Builders fit through, Titans do not.' },
  pulse:  { name: 'Pulse Turret', key: 'E', cost: 50,  hp: [260, 380, 540],  armor: [1, 2, 3], up: [80, 160],  flux: 2, build: 5, range: 8, dmg: [10, 23, 50], rate: 0.6, h: 1.9, blurb: 'Basic automated weapon. Fast shots, short range.' },
  lance:  { name: 'Lance Turret', key: 'R', cost: 130, hp: [300, 440, 600],  armor: [1, 2, 3], up: [170, 320], flux: 2, build: 8, range: 12, dmg: [85, 185, 400], rate: 2.6, forge: true, h: 3.1, blurb: 'Advanced energy tower. Slow, heavy, long range. Needs a Forge.' },
  stasis: { name: 'Stasis Pylon', key: 'T', cost: 90,  hp: [280, 400, 540],  armor: [1, 2, 3], up: [120, 210], flux: 2, build: 6, range: 7, slow: [0.3, 0.42, 0.55], forge: true, h: 2.7, blurb: 'Slows hostile units in range. Needs a Forge.' },
  mend:   { name: 'Mend Beacon',  key: 'G', cost: 80,  hp: [280, 400, 540],  armor: [1, 2, 3], up: [110, 190], flux: 2, build: 6, range: 7, heal: [16, 34, 66], h: 2.5, blurb: 'Repairs nearby friendly structures for free.' },
  bay:    { name: 'Drone Bay',    key: 'B', cost: 50,  hp: [420, 580, 780],  armor: [2, 3, 4], up: [130, 230], flux: 2, build: 5, carry: [6, 9, 12], h: 1.9, blurb: 'Produces harvesting workers and collects what they bring back.' },
  forge:  { name: 'Forge',        key: 'V', cost: 140, hp: [520, 700, 900],  armor: [2, 3, 4], up: [150, 250], flux: 2, build: 9, h: 2.4, blurb: 'Technology building. Unlocks Mk II upgrades, Lance Turrets and Stasis Pylons.' },
};
const TYPES = ['wall', 'pulse', 'lance', 'stasis', 'mend', 'bay', 'forge'];
const UNITS = {
  builder: { hp: 140, armor: 0, speed: 4.4, vision: 13, size: 1 },
  worker:  { hp: 60,  armor: 0, speed: 3.8, vision: 7,  size: 1, name: 'Worker' },
  husk:    { hp: 170, armor: 1, speed: 5.2, vision: 11, size: 2, rate: 1.0, name: 'Husk' },
  brood:   { hp: 90,  armor: 0, speed: 5.8, vision: 7,  size: 1, rate: 0.8, name: 'Broodling' },
};
/* ---------- Titans: one shared character system, four kits ---------- */
const TITANS = {
  hollow: { name: 'The Hollow', tag: 'Biomechanical predator', hp: 1, dmg: 1, speed: 4.8, armor: 2, range: 0, rate: 0.9,
    blurb: 'Fast melee hunter. Leaps on prey, vanishes underground, smells Builders across the island.',
    abil: { q: { name: 'Seismic Slam', cd: 7, blurb: 'Shockwave that damages everything around you.' }, w: { name: 'Pounce', cd: 10, aim: 'point', range: 9, blurb: 'Leap across open ground and strike where you land.' },
      e: { name: 'Burrow', cd: 26, blurb: 'Five seconds unseen and untargetable with a burst of speed. Attacking ends it.' }, r: { name: 'Scent', cd: 45, blurb: 'Reveal every Builder on the island for a few seconds.' } } },
  colossus: { name: 'The Colossus', tag: 'Ancient war machine', hp: 1.45, dmg: 1.3, speed: 3.7, armor: 5, range: 0, rate: 1.3,
    blurb: 'Slow, armoured siege engine. Crushes single targets and tears lines through bases.',
    abil: { q: { name: 'Crushing Strike', cd: 9, blurb: 'One enormous blow on whatever is in reach.' }, w: { name: 'Shockwave', cd: 12, aim: 'line', range: 12, blurb: 'A wave that damages everything in a line.' },
      e: { name: 'Reinforce', cd: 30, blurb: 'Six seconds of heavily reduced damage.' }, r: { name: 'Overload', cd: 45, blurb: 'Reactor burst. Heavy damage in a wide circle.' } } },
  wraith: { name: 'The Wraith', tag: 'Extradimensional organism', hp: 0.72, dmg: 0.8, speed: 5.6, armor: 0, range: 6, rate: 1.0,
    blurb: 'Fragile ranged skirmisher. Walks through walls for a moment, blinks, and fires from outside turret range.',
    abil: { q: { name: 'Phase Shift', cd: 22, blurb: 'Three seconds intangible: untargetable, and you pass through structures.' }, w: { name: 'Energy Lance', cd: 8, aim: 'line', range: 13, blurb: 'A long beam that pierces everything on its path.' },
      e: { name: 'Blink', cd: 13, aim: 'point', range: 9, blurb: 'Teleport a short distance.' }, r: { name: 'Void Pulse', cd: 30, blurb: 'Damage around you and slow Builders and workers.' } } },
  brood: { name: 'The Broodmother', tag: 'Colossal alien organism', hp: 1.2, dmg: 0.9, speed: 4.4, armor: 3, range: 0, rate: 1.0,
    blurb: 'Durable swarm queen. Acid melts fortifications while broodlings slip through gaps in the walls.',
    abil: { q: { name: 'Acid Spray', cd: 10, aim: 'point', range: 8, blurb: 'A pool of acid that eats structures and units standing in it.' }, w: { name: 'Charge', cd: 12, aim: 'point', range: 11, blurb: 'Rush forward, damaging what you hit.' },
      e: { name: 'Regenerate', cd: 35, blurb: 'Recover a quarter of your health over five seconds.' }, r: { name: 'Brood Spawn', cd: 40, blurb: 'Hatch four broodlings. They are small enough to use one-tile gaps.' } } },
};
const TITAN_KEYS = ['hollow', 'colossus', 'wraith', 'brood'], ABKEY = { q: 'Q', w: 'E', e: 'R', r: 'F' };  // WASD is the camera
const DIFFS = {
  calm:     { name: 'Calm',     hp: 0.85, dmg: 0.85, xp: 0.9,  wake: 100, ally: 1.15 },
  standard: { name: 'Standard', hp: 1.15, dmg: 1.12, xp: 1.2,  wake: 90,  ally: 1.0 },
  brutal:   { name: 'Brutal',   hp: 1.3,  dmg: 1.25, xp: 1.35, wake: 70,  ally: 1.0 },
};

/* ---------------------------------------------------------------------
   The atoll: a wide volcanic ring around a flooded crater, four causeways
   to the Sink in the middle. Plant belts cut the ring into eight chambers
   with one gap each. Chambers alternate between a raised mesa with one
   ramp and a clearing with one mouth, ringed by forest or by cliffs.
   Plants and lumen crystals are both the resource and part of the walls.
   --------------------------------------------------------------------- */
const CHAMBERS = 8;
const CH_A = Array.from({ length: CHAMBERS }, (_, k) => k * Math.PI / 4 - Math.PI);
const BRIDGE_A = CH_A.filter((_, k) => k % 2 === 0);
const RIDGE_A = CH_A.map(a => a + Math.PI / 8);
const outerR = a => 80 + 2.4 * Math.sin(3 * a + 0.7) + 1.4 * Math.sin(7 * a + 2.1) + 0.7 * Math.sin(13 * a);
const innerR = a => 19 + 1.0 * Math.sin(4 * a + 1.9) + 0.6 * Math.sin(9 * a + 0.4);
const isletR = a => 11.5 + 0.8 * Math.sin(5 * a + 0.3);

/* A broad island around a small flooded crater. Up to twenty-eight base pockets in three staggered rings:
   tree-ringed groves, cliff bowls and raised mesas with a ramp, each with one mouth and its own
   crystals, joined by winding corridors. Every pocket is kept only if the whole island stays walkable. */
function genMap(seed) {
  const rnd = mulberry32(seed);
  const t = new Uint8Array(N), h = new Uint8Array(N), rampF = new Float32Array(N);
  const polar = (x, y) => { const dx = x + .5 - CX, dy = y + .5 - CY; return [Math.hypot(dx, dy), Math.atan2(dy, dx)]; };
  const pt = (a, r) => ({ x: CX + Math.cos(a) * r, y: CY + Math.sin(a) * r });
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    const [r, a] = polar(x, y); let land = false;
    if (r < outerR(a) && r > innerR(a)) land = true;
    else if (r < isletR(a)) land = true;
    else if (r <= innerR(a)) for (const b of BRIDGE_A) if (Math.abs(angDiff(a, b)) * r < 3.3 + 0.4 * Math.sin(r * 0.6 + b)) land = true;
    t[idx(x, y)] = land ? GROUND : WATER;
  }
  const keep = [], spots = [], outs = [], ponds = [], marks = [];
  const disc = (cx, cy, r, fn) => { for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) if (inMap(x, y)) { const d = Math.hypot(x + .5 - cx, y + .5 - cy); if (d <= r) fn(x, y, d, idx(x, y)); } };
  const veins = []; for (const [dx, dy] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) { t[idx(CX + dx, CY + dy)] = VEIN; veins.push({ x: CX + dx, y: CY + dy }); }
  const mouths = BRIDGE_A.map(b => pt(b, innerR(b) + 3)); for (const m of mouths) keep.push({ x: m.x, y: m.y, r: 7 });
  BRIDGE_A.forEach(b => { for (const sd of [-1, 1]) marks.push({ x: CX + Math.cos(b) * (innerR(b) + 1.5) - Math.sin(b) * 4.6 * sd, y: CY + Math.sin(b) * (innerR(b) + 1.5) + Math.cos(b) * 4.6 * sd }); });
  const vOpen = (x, y) => { if (x < 1 || y < 1 || x >= MW || y >= MH) return false; let lo = 9, hi = -1;
    for (const i of [idx(x - 1, y - 1), idx(x, y - 1), idx(x - 1, y), idx(x, y)]) { if (t[i] !== GROUND) return false; lo = Math.min(lo, h[i]); hi = Math.max(hi, h[i]); } return hi - lo <= 1; };
  const reachAll = () => {
    const seen = new Uint8Array(NV), q = [(CY + 5) * VW + CX]; seen[q[0]] = 1;
    while (q.length) { const c = q.pop(), cx = c % VW, cy = (c / VW) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = cx + dx, ny = cy + dy, ni = ny * VW + nx; if (!seen[ni] && vOpen(nx, ny)) { seen[ni] = 1; q.push(ni); } } }
    return [...mouths, ...spots, ...outs].every(p => { const x = Math.round(p.x), y = Math.round(p.y); return seen[y * VW + x] || seen[(y + 1) * VW + x + 1] || seen[y * VW + x + 1] || seen[(y + 1) * VW + x]; });
  };
  /* Carve one pocket; undo it if it cuts anything off. */
  function pocket(cx, cy, kind, R, mouth, k) {
    cx = Math.round(cx); cy = Math.round(cy); const st = t.slice(), sh = h.slice(), sr = rampF.slice(), ux = Math.cos(mouth), uy = Math.sin(mouth), R0 = R - 3.6, free = (i) => t[i] === GROUND && !h[i];
    const lob = 2 + (k % 3), amp = 0.9 + 0.5 * hash2(k, 7), ph = k * 1.9, shape = an => amp * Math.sin(an * lob + ph) + 0.4 * Math.sin(an * 5 + k);   // every pocket gets its own outline
    const ramps = kind === 'mesa' ? (k % 2 ? [mouth, mouth + 2.25] : [mouth]) : [], nearRamp = (an, d, w) => ramps.some(m => Math.abs(angDiff(an, m)) * d < w);
    let bad = false; disc(cx, cy, R + 1.5, (x, y, d, i) => { if (t[i] !== GROUND || h[i]) bad = bad || d < R - 1; }); if (bad) return false;   // needs open, level ground
    if (kind === 'mesa') {
      disc(cx, cy, R + 2, (x, y, d, i) => { const an = Math.atan2(y + .5 - cy, x + .5 - cx), rr = R - 0.9 + shape(an) * 0.8; if (d > rr || !free(i)) return; h[i] = TOP; if (d > rr - 2.3 && !nearRamp(an, d, 4.6)) t[i] = TREE; });
      for (const m of ramps) { const vx = Math.cos(m), vy = Math.sin(m); disc(cx, cy, R + 8, (x, y, d, i) => { const dx = x + .5 - cx, dy = y + .5 - cy, al = dx * vx + dy * vy, lat = Math.abs(dy * vx - dx * vy);
        if (lat < 2.7 && al > R - 4.4 && al < R + 4.2 && (t[i] === GROUND || t[i] === TREE) && (h[i] === 0 || h[i] === TOP)) { const f = clamp((R + 4.2 - al) / 8.6, 0.04, 0.96); t[i] = GROUND; h[i] = clamp(1 + Math.floor(f * 3), 1, 3); rampF[i] = f; } }); }
    } else disc(cx, cy, R + 2, (x, y, d, i) => { if (!free(i)) return; const an = Math.atan2(y + .5 - cy, x + .5 - cx), wob = shape(an) * 0.8, r0 = R0 + wob * 0.7, open = Math.abs(angDiff(an, mouth)) * d > 2.7;
        if (kind === 'bowl') { if (d >= r0 + 1 && d <= R - 0.6 + wob && open) t[i] = ROCK; else if (d >= r0 - 0.8 && d < r0 + 1 && Math.abs(angDiff(an, mouth)) * d > 3.6) t[i] = TREE; }
        else if (d >= r0 && d <= R + wob && open) t[i] = TREE; });
    const cr = kind === 'mesa' ? R - 5 : R0 - 2.4; let n = 0;
    for (const o of [0.6, -0.6]) { const qx = Math.round(cx - Math.cos(mouth + o) * cr), qy = Math.round(cy - Math.sin(mouth + o) * cr); for (const [dx, dy] of [[0, 0], [1, 0], [0, 1]]) { const i = idx(qx + dx, qy + dy); if (n < 5 && t[i] === GROUND && (h[i] === 0 || h[i] === TOP)) { t[i] = CRYSTAL; n++; } } }
    const reach = kind === 'mesa' ? R + 6.5 : R + 3, sp = { x: cx, y: cy, kind }, out = { x: cx + ux * reach, y: cy + uy * reach };
    spots.push(sp); outs.push(out);
    if (!reachAll()) { t.set(st); h.set(sh); rampF.set(sr); spots.pop(); outs.pop(); return false; }
    keep.push({ x: cx, y: cy, r: R + 1.8 }, { x: out.x, y: out.y, r: 4.6 }, { x: cx + ux * (R + 1), y: cy + uy * (R + 1), r: 3.8 });
    return true;
  }
  const KINDS = ['grove', 'mesa', 'bowl'];
  const KM = ['mesa', 'grove', 'mesa', 'bowl'];
  for (let j = 0; j < 16; j++) { const a = (j + 0.5) * Math.PI / 8 + (rnd() - 0.5) * 0.05, kind = KM[j % 4], R = kind === 'mesa' ? 9.4 : 8.4 + rnd() * 1.4, c = pt(a, outerR(a) - R - 2.8);
    pocket(c.x, c.y, kind, R, Math.atan2(CY - c.y, CX - c.x) + (j % 2 ? 0.7 : -0.7), j); }
  for (let j = 0; j < 8; j++) { const a = (j + 0.5) * Math.PI / 4 + (rnd() - 0.5) * 0.06, kind = KINDS[(j + 1) % 3], R = kind === 'mesa' ? 9.2 : 8.2 + rnd() * 1.2, c = pt(a, 48 + (rnd() - 0.5) * 2);
    pocket(c.x, c.y, kind, R, a + (j % 2 ? 1.5 : -1.5) + (rnd() - 0.5) * 0.6, j + 16); }
  for (let j = 0; j < 4; j++) { const a = Math.PI / 4 + j * Math.PI / 2 + (rnd() - 0.5) * 0.1, kind = j % 2 ? 'bowl' : 'grove', R = 7.6 + rnd() * 0.8, c = pt(a, innerR(a) + R + 3);
    pocket(c.x, c.y, kind, R, Math.atan2(c.y - CY, c.x - CX) + (j % 2 ? 1.0 : -1.0), j + 24); }
  // ponds in the corridors
  for (let j = 0; j < 60 && ponds.length < 8; j++) { const a = rnd() * 6.283, c = pt(a, 30 + rnd() * 34), R = 2.2 + rnd() * 1.3; if (keep.some(q => Math.hypot(q.x - c.x, q.y - c.y) < q.r + R + 0.5)) continue; const st = t.slice(); let n = 0;
    disc(c.x, c.y, R + 1, (x, y, d, i) => { const an = Math.atan2(y + .5 - c.y, x + .5 - c.x); if (t[i] === GROUND && !h[i] && d < R + 0.6 * Math.sin(an * 3 + j)) { t[i] = WATER; n++; } });
    if (!n || !reachAll()) { t.set(st); continue; } ponds.push({ x: c.x, y: c.y, r: R }); keep.push({ x: c.x, y: c.y, r: R + 2.6 }); }
  // loose groves and rocky outcrops between the pockets, thinned until everything is reachable
  const base = t.slice();
  for (const cut of [0.58, 0.64, 0.7, 0.78, 2]) {
    t.set(base);
    for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
      const i = idx(x, y); if (t[i] !== GROUND || h[i]) continue; const [r, a] = polar(x, y);
      if (r < innerR(a) + 1.5 || r > outerR(a) - 1.5) continue;
      if (keep.some(k => Math.hypot(k.x - x - .5, k.y - y - .5) < k.r)) continue;
      const n = vnoise(x * 0.13 + 11, y * 0.13 + 5) * 0.75 + vnoise(x * 0.31, y * 0.31) * 0.25;
      if (n > cut) t[i] = TREE; else if (n < 0.2 && vnoise(x * 0.5 + 3, y * 0.5) > 0.62) t[i] = ROCK;
    }
    if (reachAll()) break;
  }
  const okReach = reachAll();
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
    const i = idx(x, y); if (t[i] !== GROUND) continue;
    const [r] = polar(x, y);
    if (r < 7.6) { t[i] = NEST; continue; }
    let coast = false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = x + dx, ny = y + dy; if (!inMap(nx, ny) || t[idx(nx, ny)] === WATER) coast = true; }
    if (coast && !h[i]) t[i] = SAND;
  }
  // eight starting camps spread around the island, each beside a different pocket
  const pick = []; for (let k = 0; k < 8 && spots.length; k++) { const want = k * Math.PI / 4 - Math.PI + 0.3; let b = -1, bd = 9; spots.forEach((s2, i) => { if (pick.includes(i)) return; const rr = Math.hypot(s2.x - CX, s2.y - CY), d = Math.abs(angDiff(Math.atan2(s2.y - CY, s2.x - CX), want)) + (rr < 40 ? 0.8 : rr < 58 ? 0 : 0.25); if (d < bd) { bd = d; b = i; } }); if (b >= 0) pick.push(b); }
  const ord = [...pick, ...spots.map((_, i) => i).filter(i => !pick.includes(i))], spots2 = ord.map(i => spots[i]), starts = ord.slice(0, 8).map(i => ({ x: Math.floor(outs[i].x), y: Math.floor(outs[i].y) }));
  const far = new Uint8Array(N); for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) far[idx(x, y)] = polar(x, y)[0] > 21 ? 1 : 0;
  const M = { tiles: t, tiles0: null, h, rampF, walkT: new Uint8Array(N), buildable: new Uint8Array(N), far, wood: new Uint16Array(N), starts, spots: spots2, gaps: [], marks, veins, ponds, nodes: [], ok: okReach };
  for (let i = 0; i < N; i++) if (t[i] === TREE || t[i] === CRYSTAL) M.nodes.push(i);
  M.tiles0 = t.slice();
  resetMap(M);
  return M;
}
/* Resource nodes are used up during a match, so the walkable map is reset for each one. */
function resetMap(M) {
  M.tiles.set(M.tiles0);
  for (let i = 0; i < N; i++) { const v = M.tiles[i]; M.walkT[i] = (v === GROUND || v === SAND || v === NEST) ? 1 : 0; M.buildable[i] = (v === GROUND || v === SAND) && (M.h[i] === 0 || M.h[i] === TOP) && M.far[i] ? 1 : 0; M.wood[i] = v === TREE ? 40 : v === CRYSTAL ? 180 : 0; }
}
const M = genMap(20261);
/* Ground height: a vertex grid at half-tile spacing. Tile centres keep their true level; shared
   edges and corners blend, which gives slopes on ramps, beaches at the shore and steep cliff faces. */
const HW = MW * 2 + 1, HV = new Float32Array(HW * HW);
(() => {
  const th = (x, y) => { if (!inMap(x, y)) return -1.3; const i = idx(x, y), v = M.tiles0[i]; if (v === WATER) return -1.3; if (v === ROCK) return TOP * LVL_H + 0.5 + hash2(x, y) * 0.9; return (M.rampF[i] ? M.rampF[i] * TOP : M.h[i]) * LVL_H; };
  for (let vy = 0; vy < HW; vy++) for (let vx = 0; vx < HW; vx++) {
    const xs = vx & 1 ? [(vx - 1) >> 1] : [(vx >> 1) - 1, vx >> 1], ys = vy & 1 ? [(vy - 1) >> 1] : [(vy >> 1) - 1, vy >> 1];
    let s = 0, n = 0, land = 0; for (const y of ys) for (const x of xs) { const v = th(x, y); s += v; n++; if (v > -1) land++; }
    let hgt = s / n; if (land === n) hgt += (vnoise(vx * 0.21, vy * 0.21) - 0.5) * 0.24 + (vnoise(vx * 0.055 + 5, vy * 0.055) - 0.5) * 0.5;   // gentle rolling ground
    HV[vy * HW + vx] = hgt;
  }
})();
function heightAt(x, y) {
  const gx = clamp(x * 2, 0, HW - 1.001), gy = clamp(y * 2, 0, HW - 1.001), x0 = gx | 0, y0 = gy | 0, fx = gx - x0, fy = gy - y0, i = y0 * HW + x0;
  return (HV[i] * (1 - fx) + HV[i + 1] * fx) * (1 - fy) + (HV[i + HW] * (1 - fx) + HV[i + HW + 1] * fx) * fy;
}
const groundAt = (x, y) => Math.max(WATER_Y, heightAt(x, y));
