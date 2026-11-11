/* =====================================================================
   03 net: one browser hosts and simulates; everyone else sends commands
   and receives state over the page's live room. Messages stay under 4 KiB
   and may drop, so structure state is also re-sent on a rolling basis.
   ===================================================================== */
const KINDS = ['builder', 'titan', 'husk', 'worker', 'brood'], ACTS = ['idle', 'moving', 'building', 'harvesting', 'drawing Flux', 'repairing', 'going to harvest', 'returning cargo', 'attacking', 'attack-moving', 'holding', 'dormant', 'recovering'];
const Net = { api: null, ready: false, lobby: null, room: null, code: '', mode: 'solo', me: null, hostPeer: null, nt: 0, evq: [], lastU: 0, cursor: 0, prevTo: 0, unsubs: [], members: [], open: [] };
const noop = () => {};

function mockApi() {
  const rooms = {};
  function mockRoom(name) {
    const bc = new BroadcastChannel('ka-' + name), me = Math.random().toString(36).slice(2, 10), others = new Map(), tl = {}, pl = [];
    let pres = {}, snap = [], closed = false;
    const mk = (peer, presence, mine) => ({ peer, presence, isMe: mine, sameTab: mine, kind: 'viewer', guest: false, by: null });
    const rebuild = () => { snap = [mk(me, pres, true), ...[...others.values()].map(o => mk(o.peer, o.pres, false))]; pl.slice().forEach(f => f({ peers: snap, joined: [], left: [], updated: [] })); };
    const hello = () => { if (!closed) bc.postMessage({ k: 'p', peer: me, pres }); };
    bc.onmessage = e => { const m = e.data;
      if (m.k === 'p') { const o = others.get(m.peer), ch = !o || JSON.stringify(o.pres) !== JSON.stringify(m.pres); others.set(m.peer, { peer: m.peer, pres: m.pres, at: Date.now() }); if (ch) rebuild(); }
      else if (m.k === 'bye') { if (others.delete(m.peer)) rebuild(); }
      else if (m.k === 'e') (tl[m.topic] || []).forEach(f => f({ topic: m.topic, data: m.data, peer: m.peer, isMe: false, sameTab: false })); };
    const iv = setInterval(() => { hello(); const now = Date.now(); let ch = false; for (const [k, o] of others) if (now - o.at > 9000) { others.delete(k); ch = true; } if (ch) rebuild(); }, 600);
    const bye = () => { if (!closed) bc.postMessage({ k: 'bye', peer: me }); };
    addEventListener('pagehide', bye);
    setTimeout(() => { hello(); rebuild(); }, 0);
    return { name,
      emit: async (topic, data) => { const js = JSON.stringify(data); if (js.length > 4096) { console.error('room message too large', topic, js.length); return; } if (!closed) bc.postMessage({ k: 'e', topic, data: JSON.parse(js), peer: me }); },
      on: (t, f) => { (tl[t] = tl[t] || []).push(f); return () => { const i = tl[t].indexOf(f); if (i >= 0) tl[t].splice(i, 1); }; },
      presence: async patch => { pres = Object.assign({}, pres, patch); for (const k in pres) if (pres[k] === null) delete pres[k]; hello(); rebuild(); },
      peers: () => snap,
      onPeers: f => { pl.push(f); setTimeout(() => f({ peers: snap, joined: snap, left: [], updated: [] }), 0); return () => { const i = pl.indexOf(f); if (i >= 0) pl.splice(i, 1); }; },
      connected: () => true,
      leave: async () => { bye(); closed = true; clearInterval(iv); bc.close(); delete rooms[name]; } };
  }
  return { join: async name => rooms[name] || (rooms[name] = mockRoom(name)) };
}
async function netInit() {
  let api = null;
  try { if (window.claude && window.claude.use) api = await window.claude.use('room'); } catch (e) { api = null; }
  if (!api && !window.claude && typeof BroadcastChannel !== 'undefined') api = mockApi(); // local file: tabs of one browser can play each other
  Net.api = api; Net.ready = true;
  if (api) { try { Net.lobby = await api.join('ka-lobby'); Net.lobby.onPeers(ch => { Net.open = ch.peers.filter(p => !p.sameTab && p.presence && typeof p.presence.open === 'string').map(p => ({ code: String(p.presence.open).slice(0, 8), nick: cleanNick(p.presence.nick), n: p.presence.n | 0, phase: p.presence.phase === 'game' ? 'game' : 'lobby' })); menuChanged(); }, noop); } catch (e) { Net.api = null; } }
  menuChanged();
}
const cleanNick = v => (typeof v === 'string' ? v : '').replace(/[^\w \-]/g, '').trim().slice(0, 12).toUpperCase() || 'BUILDER';
const myPeer = room => { const p = room.peers().find(p => p.isMe && p.sameTab); return p ? p.peer : null; };
async function leaveRoom() {
  Net.unsubs.forEach(f => { try { f(); } catch (e) { /* already gone */ } }); Net.unsubs = [];
  if (Net.room) { try { await Net.room.leave(); } catch (e) { /* already gone */ } }
  if (Net.lobby) Net.lobby.presence({ open: null, nick: null, n: null, phase: null }).catch(noop);
  Net.room = null; Net.mode = 'solo'; Net.hostPeer = null; Net.me = null; Net.members = []; Net.code = '';
}
function watchMembers() {
  Net.unsubs.push(Net.room.onPeers(ch => {
    Net.me = myPeer(Net.room) || Net.me;
    Net.members = ch.peers.map(p => ({ peer: p.peer, me: p.isMe && p.sameTab, nick: cleanNick(p.presence && p.presence.nick), want: p.presence && (FACTIONS[p.presence.want] || TITANS[p.presence.want]) ? p.presence.want : 'human', host: !!(p.presence && p.presence.host === 1), pres: p.presence || {} }));
    if (Net.mode === 'host' || Net.mode === 'hostlobby') { if (Net.lobby) Net.lobby.presence({ n: Net.members.length }).catch(noop); if (Net.mode === 'host') hostPeersChanged(); }
    else {
      const h = Net.members.find(m => m.host);
      if (h) { Net.hostPeer = h.peer; if (Net.goneT) { clearTimeout(Net.goneT); Net.goneT = 0; }
        if (h.pres.phase === 'game' && Net.mode === 'clientlobby' && Array.isArray(h.pres.seats)) startClient(h.pres);
        else if (h.pres.phase === 'lobby' && Net.mode === 'client') { Net.mode = 'clientlobby'; attract(); showLobby(); } }
      else if (Net.hostPeer && !Net.goneT) Net.goneT = setTimeout(() => { Net.goneT = 0; if (Net.room && !Net.members.some(m => m.host)) { Net.hostPeer = null; hostLost(); } }, 7000); // brief gaps are normal
    }
    lobbyChanged();
  }, noop));
}
async function hostMatch(nick, want) {
  const code = Array.from({ length: 4 }, () => 'abcdefghjkmnpqrstuvwxyz'[(Math.random() * 23) | 0]).join('');
  Net.room = await Net.api.join('m-' + code); Net.code = code; Net.mode = 'hostlobby';
  await Net.room.presence({ host: 1, nick, want, phase: 'lobby' });
  if (Net.lobby) Net.lobby.presence({ open: code, nick, n: 1, phase: 'lobby' }).catch(noop);
  Net.unsubs.push(Net.room.on('cmd', msg => { if (msg.sameTab || Net.mode !== 'host' || !G || !msg.data || typeof msg.data !== 'object') return; const seat = G.seats.findIndex(s => s.peer === msg.peer && !s.bot); if (seat >= 0) applyCmd(seat, msg.data); }, noop));
  watchMembers();
}
async function joinMatch(code, nick, want) {
  Net.room = await Net.api.join('m-' + code); Net.code = code; Net.mode = 'clientlobby';
  await Net.room.presence({ nick, want });
  const fromHost = fn => msg => { if (msg.peer === Net.hostPeer && Net.mode === 'client' && G && msg.data) { try { fn(msg.data); } catch (e) { console.error(e); } } };
  Net.unsubs.push(Net.room.on('u', fromHost(applyU), noop), Net.room.on('st', fromHost(applySt), noop), Net.room.on('ev', fromHost(evs => { if (Array.isArray(evs)) evs.forEach(onEvent); }), noop));
  watchMembers();
}
/* Host: who plays what. First to ask for a Titan gets it. */
function lobbySeats(botBuilders, botTitan) {
  const seats = [], titan = Net.members.find(m => TITANS[m.want]); let n = 0;
  for (const m of Net.members) { if (m === titan) continue; if (n >= MAX_BUILDERS) break; seats.push({ name: m.nick, role: 'builder', bot: false, peer: m.peer, fac: FACTIONS[m.want] ? m.want : FAC_KEYS[n % 3] }); n++; }
  for (let k = 0; k < botBuilders && n < MAX_BUILDERS; k++, n++) seats.push({ name: BOT_NAMES[k], role: 'builder', bot: true, fac: FAC_KEYS[(k + 1) % 3] });
  if (titan) seats.push({ name: titan.nick, role: 'titan', bot: false, peer: titan.peer, tk: titan.want });
  else if (botTitan) seats.push({ name: 'TITAN', role: 'titan', bot: true, tk: botTitan });
  return seats;
}
function hostStart(seats, diffKey) {
  newGame({ diffKey, seats }); Net.mode = 'host'; Net.nt = 0; Net.evq = []; Net.cursor = 0; Net.prevTo = 0; Local.host = true; Local.seat = G.seats.findIndex(s => s.peer === Net.me);
  Net.room.presence({ phase: 'game', diff: diffKey, seats: G.seats.map(s => [s.peer || '', s.name, s.role === 'titan' ? 1 : 0, s.bot ? 1 : 0, s.role === 'titan' ? s.tk : s.fac]) }).catch(noop);
  if (Net.lobby) Net.lobby.presence({ phase: 'game' }).catch(noop);
}
function hostPeersChanged() {
  if (!G) return;
  for (const S of G.seats) if (!S.bot && S.peer && S.peer !== Net.me && !Net.members.some(m => m.peer === S.peer)) {
    S.bot = S.bot0 = true; fire({ e: 'say', m: `${S.name} disconnected. A bot takes over.`, c: '' });
    if (S.role === 'titan' && G.titan && !G.titan.ai) { G.titan.ai = newAi(); G.titan.ai.picked = true; }
  }
}
function startClient(p) {
  const seats = p.seats.slice(0, 12).map(r => ({ peer: r[0], name: cleanNick(r[1]), role: r[2] ? 'titan' : 'builder', bot: !!r[3], fac: r[4], tk: r[4] }));
  newGame({ diffKey: DIFFS[p.diff] ? p.diff : 'standard', seats });
  G.view = true; G.units = []; G.titan = null; G.uById = new Map(); G.sById = new Map(); G.viewJobs = []; for (const S of G.seats) S.unit = null;
  Net.mode = 'client'; Local.host = false; Local.seat = seats.findIndex(s => s.peer === Net.me && !s.bot); Net.lastU = performance.now();
  beginMatch();
}
function sendCmd(c) { if (!G) return; if (Local.host) applyCmd(Local.seat, c); else if (Net.room && !G.over) Net.room.emit('cmd', c).catch(noop); }
function fire(ev) { onEvent(ev); if (Net.mode === 'host') Net.evq.push(ev); }

/* ---------- host -> clients ---------- */
function encU() {
  return { t: Math.round(G.t * 10), S: G.seats.map(S => [Math.floor(S.lumen), Math.floor(S.flux), S.dead ? 1 : 0, S.forge, S.workers, Math.round(S.inc.reduce((a, b) => a + b[1], 0) * 2)]),
    U: G.units.filter(u => u.alive || u.kind === 'builder' || u.kind === 'titan' || u.kind === 'husk').map(u => {
      const f = (u.alive ? 1 : 0) | (u.moving ? 2 : 0) | (u.sieging ? 4 : 0) | (u.harvesting ? 8 : 0) | (u.slowed > 0 || u.bSlow > 0 ? 16 : 0) | (u.bBurrow > 0 ? 32 : 0) | (u.dormant ? 64 : 0) | (u.revealT > 0 ? 128 : 0) | (u.carry > 0 ? 256 : 0) | (u.bPhase > 0 ? 512 : 0) | (u.bReinf > 0 ? 1024 : 0) | (u.bRegen > 0 ? 2048 : 0) | (u.hold ? 4096 : 0);
      const r = [u.id, KINDS.indexOf(u.kind), u.seat, Math.round(u.x * 16), Math.round(u.y * 16), Math.round(u.face * 10), Math.ceil(u.hp), Math.round(u.maxHp), f, Math.max(0, ACTS.indexOf(u.act))];
      if (u.kind === 'builder') r.push(Math.ceil(u.dashCd * 10), u.beam ? Math.round(u.beam.x * 2) : -1, u.beam ? Math.round(u.beam.y * 2) : 0, u.beam ? u.beam.k : 0);
      else if (u.kind === 'titan') r.push(u.lvl, Math.floor(u.xp), Math.ceil(u.cd.q * 10), Math.ceil(u.cd.w * 10), Math.ceil(u.cd.e * 10), Math.ceil(u.cd.r * 10), Math.ceil(u.wake || 0), TITAN_KEYS.indexOf(u.tk));
      else if (u.kind === 'worker') r.push(u.harvesting ? u.node : -1);
      return r; }) };
}
const encS = (s, bp) => [s.id, TYPES.indexOf(s.type), s.tx, s.ty, s.seat, s.lvl, Math.ceil(s.hp), bp];
const bpOf = s => s.buildT > 0 ? Math.min(99, Math.floor((1 - s.buildT / s.buildTotal) * 20) * 5) : 100;
function hostNetTick() {
  const r = Net.room; if (!r || !G) return; Net.nt++;
  r.emit('u', encU()).catch(noop);
  let budget = 3300; const n = [], h = [];
  for (const s of G.structs) {
    if (s.dead) continue; const bp = bpOf(s), hp = Math.ceil(s.hp), c = s._n;
    if (!c || c.lvl !== s.lvl) { if (budget < 40) continue; n.push(encS(s, bp)); s._n = { hp, bp, lvl: s.lvl }; budget -= 40; }
    else if (c.bp !== bp || Math.abs(c.hp - hp) >= Math.max(4, s.maxHp * 0.02) || (hp !== c.hp && (hp >= s.maxHp || hp <= 1))) { if (budget < 18) continue; h.push([s.id, hp, bp]); c.hp = hp; c.bp = bp; budget -= 18; }
  }
  const d = G.removed.splice(0, Math.max(0, Math.floor(budget / 8))), msg = {};
  if (n.length) msg.n = n; if (h.length) msg.h = h; if (d.length) msg.d = d;
  if (Net.nt % 5 === 0) msg.j = allJobs().slice(0, 60).map(j => [j.seat, TYPES.indexOf(j.type), j.tx, j.ty]);
  if (G.nodeQ.length) msg.x = G.nodeQ.splice(0, 120);
  if (msg.n || msg.h || msg.d || msg.j || msg.x) r.emit('st', msg).catch(noop);
  if (Net.nt % 20 === 7 && G.nodesGone.length) { Net.tcur = (Net.tcur || 0) >= G.nodesGone.length ? 0 : (Net.tcur || 0); r.emit('st', { x: G.nodesGone.slice(Net.tcur, Net.tcur + 400), q: 1 }).catch(noop); Net.tcur += 400; }
  if (Net.nt % 10 === 0) { // rolling resync heals dropped messages and serves late joiners
    const live = G.structs.filter(s => !s.dead), chunk = live.slice(Net.cursor, Net.cursor + 60), last = Net.cursor + 60 >= live.length;
    const from = Net.prevTo + 1, to = last ? 1e9 : chunk[chunk.length - 1].id;
    r.emit('st', { r: [from, to, chunk.map(s => encS(s, bpOf(s)))] }).catch(noop);
    if (last) { Net.cursor = 0; Net.prevTo = 0; } else { Net.cursor += 60; Net.prevTo = to; }
  }
  if (Net.evq.length) r.emit('ev', Net.evq.splice(0, 10)).catch(noop);
}

/* ---------- client: replicate ---------- */
function applyU(m) {
  Net.lastU = performance.now(); G.t = m.t / 10;
  m.S.forEach((r, i) => { const S = G.seats[i]; if (!S) return; S.lumen = r[0]; S.flux = r[1]; S.dead = !!r[2]; S.forge = r[3]; S.workers = r[4]; S.rate = r[5]; });
  const seen = new Set();
  for (const r of m.U) {
    let u = G.uById.get(r[0]); const kind = KINDS[r[1]]; if (!kind || !G.seats[r[2]]) continue;
    if (!u) { u = mkUnit(kind, r[2], r[3] / 16, r[4] / 16, kind === 'titan' ? TITAN_KEYS[r[17]] || 'hollow' : ''); u.id = r[0]; u.face = r[5] / 10; u.hp = r[6]; G.uById.set(u.id, u); G.units.push(u); }
    seen.add(u.id); u.nx = r[3] / 16; u.ny = r[4] / 16; u.nface = r[5] / 10;
    if (Math.hypot(u.nx - u.x, u.ny - u.y) > 3) { u.x = u.nx; u.y = u.ny; }
    if (r[6] < u.hp - 0.5) { u.flash = 0.15; u.hitT = 0; if (u.seat === Local.seat && u.kind === 'builder') { sfx('hurt'); G.shake = Math.max(G.shake, 6); } }
    u.hp = r[6]; u.maxHp = r[7]; const f = r[8]; u.act = ACTS[r[9]] || 'idle';
    u.alive = !!(f & 1); u.moving = !!(f & 2); u.sieging = (f & 4) ? u : null; u.harvesting = !!(f & 8); u.slowed = (f & 16) ? 0.3 : 0; u.bBurrow = (f & 32) ? 1 : 0; u.dormant = !!(f & 64); u.revealT = (f & 128) ? 1 : 0; u.carry = (f & 256) ? 1 : 0; u.bPhase = (f & 512) ? 1 : 0; u.bReinf = (f & 1024) ? 1 : 0; u.bRegen = (f & 2048) ? 1 : 0; u.hold = !!(f & 4096);
    if (kind === 'builder') { u.dashCd = r[10] / 10; u.beam = r[11] >= 0 ? { x: r[11] / 2, y: r[12] / 2, k: r[13] } : null; }
    else if (kind === 'titan') { u.lvl = r[10]; u.xp = r[11]; u.cd.q = r[12] / 10; u.cd.w = r[13] / 10; u.cd.e = r[14] / 10; u.cd.r = r[15] / 10; u.wake = r[16]; G.titan = u; }
    else if (kind === 'worker') { u.node = r[10]; u.beam = r[10] >= 0 ? { x: (r[10] % MW) + .5, y: ((r[10] / MW) | 0) + .5, k: 0 } : null; }
    const S = G.seats[u.seat]; if (kind === 'titan' || kind === 'husk' || (kind === 'builder' && (!S.unit || S.unit.kind === 'builder'))) S.unit = u;
  }
  if (seen.size !== G.units.length) { G.units = G.units.filter(u => seen.has(u.id) || (G.uById.delete(u.id), false)); }
}
function viewUpsert(r) {
  const type = TYPES[r[1]]; if (!type || !inMap(r[2], r[3]) || !inMap(r[2] + 1, r[3] + 1) || !G.seats[r[4]]) return;
  let s = G.sById.get(r[0]); const d = DEFS[type];
  if (!s) { s = { id: r[0], type, tx: r[2], ty: r[3], x: r[2] + 1, y: r[3] + 1, seat: r[4], lvl: 0, maxHp: 1, hp: r[6], buildT: 0, buildTotal: d.build, cd: Math.random(), aim: Math.PI / 2, spent: d.cost, flash: 0, active: false, tgt: null, scanT: 0, dead: false, recoil: 0 };
    G.sById.set(s.id, s); G.structs.push(s); for (const [dx, dy] of FOOT) G.struct[idx(s.tx + dx, s.ty + dy)] = s; }
  s.lvl = clamp(r[5] | 0, 0, 2); s.maxHp = hpOf(type, s.lvl, s.seat); if (r[6] < s.hp - 0.5) s.flash = 0.15; s.hp = r[6]; s.buildT = r[7] >= 100 ? 0 : (1 - r[7] / 100) * d.build;
}
function viewRemove(id, loud) { const s = G.sById.get(id); if (!s) return; s.dead = true; G.sById.delete(id); for (const [dx, dy] of FOOT) { const i = idx(s.tx + dx, s.ty + dy); if (G.struct[i] === s) G.struct[i] = null; } G.dirty = true; structGone(s, loud); }
function applySt(m) {
  if (Array.isArray(m.x)) for (const i of m.x) if (Number.isInteger(i) && i >= 0 && i < N) fellNode(i, !m.q);
  if (Array.isArray(m.d)) m.d.forEach(id => viewRemove(id, true));
  if (Array.isArray(m.n)) m.n.forEach(viewUpsert);
  if (Array.isArray(m.h)) for (const [id, hp, bp] of m.h) { const s = G.sById.get(id); if (!s) continue; if (hp < s.hp - 0.5) s.flash = 0.15; s.hp = hp; s.buildT = bp >= 100 ? 0 : (1 - bp / 100) * s.buildTotal; }
  if (Array.isArray(m.j)) { G.reserved.fill(0); G.viewJobs = m.j.filter(j => TYPES[j[1]] && inMap(j[2], j[3]) && inMap(j[2] + 1, j[3] + 1)).map(j => { for (const [dx, dy] of FOOT) G.reserved[idx(j[2] + dx, j[3] + dy)] = 1; return { seat: j[0], type: TYPES[j[1]], tx: j[2], ty: j[3] }; }); }
  if (Array.isArray(m.r)) { const [from, to, recs] = m.r, keep = new Set(recs.map(r => r[0])); for (const s of G.structs.slice()) if (s.id >= from && s.id <= to && !keep.has(s.id)) viewRemove(s.id, false); recs.forEach(viewUpsert); }
  if (G.dirty) { G.structs = G.structs.filter(s => !s.dead); G.dirty = false; }
}
/* Client-side cosmetics between snapshots: glide units, spin turrets, fly shots. */
function viewTick(dt) {
  G.t += dt;
  for (const u of G.units) {
    const k = Math.min(1, dt * 12); u.x += (u.nx - u.x) * k; u.y += (u.ny - u.y) * k;
    if (u.nface !== undefined) u.face += angDiff(u.nface, u.face) * Math.min(1, dt * 14);
    u.anim += dt; u.flash = Math.max(0, u.flash - dt); u.dashCd = Math.max(0, u.dashCd - dt); u.hitT += dt; for (const c in u.cd) u.cd[c] = Math.max(0, u.cd[c] - dt);
  }
  for (const s of G.structs) updStruct(s, dt);
  for (const p of G.shots) { const a = p.tg; if (!a.alive) { p.dead = true; continue; } const dx = a.x - p.x, dy = a.y - p.y, d = Math.hypot(dx, dy), step = 22 * dt; if (d <= step + 0.5) p.dead = true; else { p.x += dx / d * step; p.y += dy / d * step; } }
  G.shots = G.shots.filter(p => !p.dead);
}
const allJobs = () => { if (G.view) return G.viewJobs; const out = []; for (const u of G.units) if (u.kind === 'builder' && u.alive) for (const j of u.orders) if (j.t === 'build') out.push({ seat: u.seat, type: j.type, tx: j.tx, ty: j.ty }); return out; };
