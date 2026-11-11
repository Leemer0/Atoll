/* =====================================================================
   05 ui: sound, events, RTS input (selection, orders, camera), HUD,
   selection screen, developer panel, main loop
   ===================================================================== */
const App = { phase: 'menu', paused: false, nick: 'BUILDER', pick: 'human', diff: 'standard', bots: 5, dev: false, nav: false, sig: '', cmdSig: '' };
try { App.nick = cleanNick(localStorage.getItem('ka-nick') || ''); } catch (e) { /* storage unavailable */ }

/* ---------- sound: tiny synth, no assets ---------- */
const AU = { ctx: null, master: null, muted: false, last: {} };
try { AU.muted = localStorage.getItem('ka-muted') === '1'; } catch (e) { /* storage unavailable */ }
function audioInit() { if (AU.ctx) { if (AU.ctx.state === 'suspended') AU.ctx.resume(); return; } try { const C = window.AudioContext || window.webkitAudioContext; AU.ctx = new C(); AU.master = AU.ctx.createGain(); AU.master.gain.value = 0.2; AU.master.connect(AU.ctx.destination); } catch (e) { AU.ctx = null; } }
function tone(type, f0, f1, dur, vol, delay) {
  const ac = AU.ctx, t0 = ac.currentTime + (delay || 0), o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
  g.gain.setValueAtTime(vol, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(AU.master); o.start(t0); o.stop(t0 + dur + 0.03);
}
const SFX = {
  place: () => tone('square', 320, 480, 0.06, 0.25), ack: () => tone('triangle', 500, 640, 0.05, 0.2),
  done: () => { tone('triangle', 520, 780, 0.1, 0.3); tone('triangle', 780, 1040, 0.12, 0.25, 0.08); },
  pulse: () => tone('square', 980, 420, 0.05, 0.1), lance: () => { tone('sawtooth', 1400, 180, 0.22, 0.3); tone('sine', 220, 60, 0.25, 0.3); },
  thud: () => tone('sine', 120, 40, 0.16, 0.6), slam: () => { tone('sawtooth', 90, 28, 0.5, 0.8); tone('square', 60, 30, 0.4, 0.5, 0.05); },
  boom: () => tone('sawtooth', 200, 40, 0.3, 0.5), zap: () => tone('sawtooth', 900, 200, 0.18, 0.35),
  roar: () => { tone('sawtooth', 70, 160, 0.5, 0.7); tone('sawtooth', 160, 45, 0.9, 0.7, 0.45); tone('square', 52, 40, 1.2, 0.4, 0.1); },
  alarm: () => { tone('square', 660, 660, 0.12, 0.3); tone('square', 880, 880, 0.12, 0.3, 0.16); tone('square', 660, 660, 0.12, 0.3, 0.32); },
  dash: () => tone('sine', 300, 1600, 0.16, 0.35), hurt: () => tone('sawtooth', 300, 90, 0.2, 0.5),
  up: () => { tone('triangle', 440, 660, 0.08, 0.3); tone('triangle', 660, 990, 0.1, 0.3, 0.07); }, deny: () => tone('square', 160, 120, 0.1, 0.25),
  win: () => { [523, 659, 784, 1047].forEach((f, i) => tone('triangle', f, f, 0.3, 0.4, i * 0.14)); }, lose: () => { [392, 330, 262, 196].forEach((f, i) => tone('sawtooth', f, f * 0.97, 0.4, 0.35, i * 0.2)); },
};
const SFX_GAP = { pulse: 0.07, thud: 0.12, place: 0.04, deny: 0.2, boom: 0.06, ack: 0.08 };
function sfx(name, wx, wy) {
  if (AU.muted || !AU.ctx || AU.ctx.state !== 'running' || App.phase !== 'game') return;
  if (wx !== undefined && (Math.hypot(wx - cam.x, wy - cam.y) > 30 || !canSee(wx, wy))) return;
  const now = AU.ctx.currentTime; if (AU.last[name] && now - AU.last[name] < (SFX_GAP[name] || 0.03)) return;
  AU.last[name] = now; SFX[name]();
}

/* ---------- events from the simulation ---------- */
function say(text, cls) {
  const f = $('feed'), el = document.createElement('div'); el.className = 'msg ' + (cls || ''); el.textContent = text; f.appendChild(el);
  while (f.children.length > 4) f.firstChild.remove();
  setTimeout(() => el.classList.add('out'), 6500); setTimeout(() => el.remove(), 7200);
}
function onEvent(ev) {
  if (!ev || typeof ev !== 'object' || !G) return;
  const vis = (x, y) => localTeam() < 0 || G.reveal || canSee(x, y), bm = (e, w, h) => G.beams.push({ x1: e.x1, y1: e.y1, h1: h, x2: e.x2, y2: e.y2, h2: h, col: e.c || '#fff', w, life: 0.35, max: 0.35 });
  switch (ev.e) {
    case 'say': if (ev.to !== undefined && ev.to !== Local.seat) return; if (ev.team !== undefined && localTeam() >= 0 && ev.team !== localTeam()) return; say(String(ev.m).slice(0, 160), ev.c); if (ev.alarm) sfx('alarm'); break;
    case 'fx': {
      const c = typeof ev.c === 'string' ? ev.c : '#ffffff';
      if (ev.k === 'slam') { if (!vis(ev.x, ev.y)) return; ring(ev.x, ev.y, 0.6, ev.r || 4, c); ring(ev.x, ev.y, 0.3, (ev.r || 4) * 0.6, c, 0.3); burst(ev.x, ev.y, '#c8a27a', 22, 6, 0.2); sfx('slam'); if (Math.hypot(ev.x - cam.x, ev.y - cam.y) < 24) G.shake = Math.max(G.shake, 10); }
      else if (ev.k === 'leap' || ev.k === 'blink') { if (!vis(ev.x2, ev.y2) && !vis(ev.x1, ev.y1)) return; bm(ev, ev.k === 'leap' ? 0.6 : 0.25, 1); ring(ev.x2, ev.y2, 0.3, 2.4, c); burst(ev.x1, ev.y1, c, 10, 3, 1); sfx(ev.k === 'leap' ? 'slam' : 'zap'); }
      else if (ev.k === 'wave') { if (!vis(ev.x2, ev.y2) && !vis(ev.x1, ev.y1)) return; bm(ev, 1.6, 0.4); for (let k = 0; k <= 6; k++) burst(ev.x1 + (ev.x2 - ev.x1) * k / 6, ev.y1 + (ev.y2 - ev.y1) * k / 6, c, 5, 3, 0.3); sfx('slam'); G.shake = Math.max(G.shake, 7); }
      else if (ev.k === 'beam') { if (!vis(ev.x2, ev.y2) && !vis(ev.x1, ev.y1)) return; bm(ev, 0.35, 1.6); burst(ev.x2, ev.y2, c, 10, 3, 1); sfx('lance'); }
      else if (ev.k === 'bolt') { if (!vis(ev.x2, ev.y2)) return; G.beams.push({ x1: ev.x1, y1: ev.y1, h1: 1.8, x2: ev.x2, y2: ev.y2, h2: 0.8, col: '#b9a6ff', w: 0.12, life: 0.2, max: 0.2 }); sfx('zap', ev.x2, ev.y2); }
      else if (ev.k === 'puff') { if (!vis(ev.x, ev.y)) return; burst(ev.x, ev.y, c, 18, 4, 0.8); ring(ev.x, ev.y, 0.4, 2.2, c); sfx('thud'); }
      else if (ev.k === 'pool') { if (G.view) G.pools.push({ x: ev.x, y: ev.y, r: ev.r, t: 6, acc: 0 }); if (vis(ev.x, ev.y)) { burst(ev.x, ev.y, c, 16, 4, 0.5); sfx('zap'); } }
      break; }
    case 'dash': if (vis(ev.x1, ev.y1) || vis(ev.x2, ev.y2)) { const c = G.seats[ev.s] ? G.seats[ev.s].col : '#fff'; G.beams.push({ x1: ev.x1, y1: ev.y1, h1: 0.8, x2: ev.x2, y2: ev.y2, h2: 0.8, col: c, w: 0.3, life: 0.3, max: 0.3 }); ring(ev.x1, ev.y1, 0.2, 1.2, c); ring(ev.x2, ev.y2, 1.0, 0.2, c); if (ev.s === Local.seat) sfx('dash'); } break;
    case 'die': if (vis(ev.x, ev.y)) { const big = ev.k === 'titan', c = ev.k === 'titan' ? COL.threat : ev.k === 'husk' || ev.k === 'brood' ? COL.husk : (G.seats[ev.s] ? G.seats[ev.s].col : '#fff'); burst(ev.x, ev.y, c, big ? 80 : ev.k === 'builder' ? 26 : 10, big ? 8 : 4, 1); if (ev.k !== 'worker' && ev.k !== 'brood') ring(ev.x, ev.y, 0.2, big ? 7 : 2.5, c); }
      if (ev.k === 'builder') { sfx('roar'); if (ev.s === Local.seat) { G.placing = null; G.aim = null; Sel.units = []; Sel.struct = null; say('You died. You will rise in the Sink as a husk and fight for the Titan.', 'warn'); } } break;
    case 'up': if (vis(ev.x, ev.y)) { ring(ev.x, ev.y, 0.4, 1.8, G.seats[ev.s] ? G.seats[ev.s].col : '#fff'); if (ev.s === Local.seat) sfx('up'); } break;
    case 'lvl': { const a = G.titan; if (a && a.seat === Local.seat) { floatText(a.x, a.y, 'LEVEL ' + ev.l, COL.threat); sfx('up'); } break; }
    case 'roar': sfx('roar'); G.shake = Math.max(G.shake, 6); break;
    case 'over': if (!G.over) G.over = { winner: ev.winner, kind: ev.kind }; G.endT = ev.t; G.endL = ev.l;
      sfx((ev.winner === 'titan') === (localTeam() === 1) ? 'win' : 'lose'); setTimeout(() => { if (App.phase === 'game' && G.over) showEnd(); }, 1800); break;
  }
}

/* ---------- selection helpers ---------- */
const RANK = { titan: 0, builder: 1, husk: 2, worker: 3, brood: 4 };
const ownSel = () => Sel.units.filter(u => u.alive && u.seat === Local.seat);
const lead = () => ownSel().sort((a, b) => RANK[a.kind] - RANK[b.kind])[0] || null;
const myUnits = () => G.units.filter(u => u.alive && !u.dormant && u.seat === Local.seat);
function setSel(units, struct, add) { if (add && !struct) { const s = new Set(Sel.units); for (const u of units) { if (s.has(u) && units.length === 1) s.delete(u); else s.add(u); } Sel.units = [...s]; } else Sel.units = units; Sel.struct = struct || null; G.placing = null; G.aim = null; App.sig = ''; }
function selectMain() { const u = localUnit(); if (u && u.alive) setSel([u]); else setSel(myUnits().slice(0, 1)); }
function centerOn(u) { if (u) { cam.x = u.x; cam.y = u.y; } }
const unitName = u => u.kind === 'titan' ? TITANS[u.tk].name : u.kind === 'builder' ? facOf(u.seat).builder : u.kind === 'worker' ? facOf(u.seat).worker : UNITS[u.kind].name;

/* ---------- HUD ---------- */
const hudCache = {}, iconCache = {};
function setText(id, v) { if (hudCache[id] !== v) { hudCache[id] = v; $(id).textContent = v; } }
function iconInto(canvas, type, fac, col) { const k = type + fac + col; if (!iconCache[k]) { const c = document.createElement('canvas'); c.width = c.height = 96; structIcon(type, fac, col, c); iconCache[k] = c; } const g = canvas.getContext('2d'); g.clearRect(0, 0, canvas.width, canvas.height); g.drawImage(iconCache[k], 0, 0, canvas.width, canvas.height); }
/* What the command grid offers for the current selection. */
function cmdSpec() {
  const S = localSeat(), L = lead(), out = []; if (!S) return out;
  const st = Sel.struct;
  if (st && !st.dead && st.seat === Local.seat && !S.dead) {
    const d = DEFS[st.type], why = upgradeBlock(st), same = G.structs.filter(o => !o.dead && o.seat === S.id && o.type === st.type && o.lvl === st.lvl && o.buildT <= 0).length;
    if (st.type === 'bay') out.push({ id: 'tr', key: 'T', label: 'Train ' + FACTIONS[S.fac].worker, cost: workerCost(S), no: st.buildT > 0 || S.workers >= MAX_WORKERS || S.lumen < workerCost(S), tip: [`Train ${FACTIONS[S.fac].worker}`, `${workerCost(S)} Lumen · ${S.workers}/${MAX_WORKERS} workers`, 'A worker that harvests plants and lumen crystals and carries each load back to a Drone Bay.'], run: () => sendCmd({ c: 'tr', id: st.id }) });
    if (st.lvl < 2) { const c = upCostOf(st) + (st.lvl === 1 ? ` + ${d.flux} Flux` : '');
      out.push({ id: 'up', key: 'U', label: 'Upgrade Mk ' + MK[st.lvl + 1], cost: upCostOf(st), no: !!why, tip: [`Upgrade to Mk ${MK[st.lvl + 1]}`, c + ' Lumen', why ? 'Blocked: ' + why + '.' : `Raises health to ${hpOf(st.type, st.lvl + 1, st.seat)}` + (d.dmg ? ` and damage to ${d.dmg[st.lvl + 1]}.` : '.')], run: () => { if (why) sfx('deny'); sendCmd({ c: 'up', id: st.id }); } });
      if (same > 1) out.push({ id: 'upa', key: '⇧U', label: 'Upgrade all ' + same, no: !!why, tip: ['Upgrade all Mk ' + MK[st.lvl], `${same} × ${c}`, 'Upgrades every ' + d.name + ' of this mark, nearest first, while resources last.'], run: () => sendCmd({ c: 'upa', id: st.id }) }); }
    out.push({ id: 'sv', key: 'Z', label: 'Salvage', no: st.buildT > 0, tip: ['Salvage', `+${Math.floor(st.spent * 0.6 * st.hp / st.maxHp)} Lumen`, 'Dismantle this structure and recover part of its cost.'], run: () => sendCmd({ c: 'sv', id: st.id }) });
    return out;
  }
  if (!L) return out;
  if (L.kind === 'builder') {
    for (const type of TYPES) { const d = DEFS[type], lock = !!d.forge && !S.forge; out.push({ id: 'b:' + type, key: d.key, icon: type, cost: lock ? 'forge' : d.cost, on: G.placing === type, no: lock || S.lumen < d.cost,
      tip: [d.name, `${d.cost} Lumen · ${hpOf(type, 0, S.id)} HP · ${(d.build * FACTIONS[S.fac].buildTime).toFixed(1)}s` + (d.dmg ? ` · ${(d.dmg[0] / d.rate).toFixed(0)} dps · range ${d.range}` : ''), d.blurb + (lock ? ' Build a Forge first.' : '')], run: () => { G.placing = G.placing === type ? null : type; G.aim = null; } }); }
    out.push({ id: 'dash', key: 'F', label: 'Dash', cool: L.dashCd, on: G.aim === 'dash', tip: ['Dash', `${FACTIONS[S.fac].dashCd}s cooldown`, 'Jump a short distance, even through walls.'], run: () => { if (L.dashCd > 0) sfx('deny'); else { G.aim = G.aim === 'dash' ? null : 'dash'; G.placing = null; } } });
    out.push({ id: 'rp', key: 'C', label: 'Repair', on: G.aim === 'repair', tip: ['Repair', 'costs Lumen while repairing', 'Then click a damaged friendly structure. Right-clicking one does the same.'], run: () => { G.aim = G.aim === 'repair' ? null : 'repair'; G.placing = null; } });
    out.push({ id: 'st', key: 'X', label: 'Stop', tip: ['Stop', '', 'Cancel all orders. Queued blueprints are refunded.'], run: () => sendCmd({ c: 'st', ids: ownSel().map(u => u.id) }) });
  } else if (L.kind === 'worker') {
    out.push({ id: 'rp', key: 'C', label: 'Repair', on: G.aim === 'repair', tip: ['Repair', 'costs Lumen while repairing', 'Then click a damaged friendly structure.'], run: () => { G.aim = G.aim === 'repair' ? null : 'repair'; } });
    out.push({ id: 'st', key: 'X', label: 'Stop', tip: ['Stop', '', 'Stand still. Right-click a resource to send the worker back to harvesting.'], run: () => sendCmd({ c: 'st', ids: ownSel().map(u => u.id) }) });
  } else {
    if (L.kind === 'titan') for (const k of ['q', 'w', 'e', 'r']) { const A = TITANS[L.tk].abil[k]; out.push({ id: 'ab:' + k, key: ABKEY[k], label: A.name, cool: L.cd[k], on: G.aim === k, no: L.dormant, tip: [A.name, `${A.cd}s cooldown` + (A.range ? ` · range ${A.range}` : ''), A.blurb], run: () => useAbility(k, false) }); }
    out.push({ id: 'am', key: 'G', label: 'Attack move', on: G.aim === 'amove', tip: ['Attack-move', '', 'Then click a spot. Units walk there and attack anything hostile on the way.'], run: () => { G.aim = G.aim === 'amove' ? null : 'amove'; } });
    out.push({ id: 'st', key: 'X', label: 'Stop', tip: ['Stop', '', 'Cancel all orders.'], run: () => sendCmd({ c: 'st', ids: ownSel().map(u => u.id) }) });
    out.push({ id: 'hd', key: 'H', label: 'Hold', on: L.hold, tip: ['Hold position', '', 'Stay put and attack only what comes into reach.'], run: () => sendCmd({ c: 'hd', ids: ownSel().map(u => u.id) }) });
  }
  return out;
}
let cmdNow = [];
function drawCmd() {
  const spec = cmdSpec(), S = localSeat(), sig = spec.map(s => s.id).join(',') + (S ? S.fac + S.col : ''), el = $('cmd'); cmdNow = spec;
  if (sig !== App.cmdSig) { App.cmdSig = sig; el.innerHTML = ''; $('tip').hidden = true;
    spec.forEach((s, i) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'cb'; b.dataset.i = i; b.innerHTML = (s.icon ? '<canvas width="68" height="68"></canvas>' : `<span>${s.label}</span>`) + `<kbd>${s.key}</kbd><em></em><div class="cool" hidden></div>`; if (s.icon) iconInto(b.firstChild, s.icon, S.fac, S.col); el.appendChild(b); }); }
  spec.forEach((s, i) => { const b = el.children[i]; if (!b) return; b.classList.toggle('on', !!s.on); b.classList.toggle('no', !!s.no); const em = b.querySelector('em'), c = s.cost === undefined ? '' : String(s.cost); if (em.textContent !== c) em.textContent = c; const cl = b.querySelector('.cool'), cd = s.cool > 0; cl.hidden = !cd; if (cd) cl.textContent = Math.ceil(s.cool); });
}
$('cmd').addEventListener('click', e => { const b = e.target.closest('.cb'); if (!b) return; const s = cmdNow[+b.dataset.i]; if (s) { audioInit(); s.run(); } b.blur(); });
$('cmd').addEventListener('pointerover', e => { const b = e.target.closest('.cb'), t = $('tip'); if (!b) return; const s = cmdNow[+b.dataset.i]; if (!s) return; t.hidden = false; t.innerHTML = ''; const h = document.createElement('b'), i = document.createElement('i'), p = document.createElement('span'); h.textContent = s.tip[0] + '  [' + s.key + ']'; i.textContent = s.tip[1]; p.textContent = s.tip[2]; t.append(h, i, p); });
$('cmd').addEventListener('pointerleave', () => { $('tip').hidden = true; });
function drawInfo() {
  const el = $('info'), us = Sel.units.filter(u => u.alive), st = Sel.struct && !Sel.struct.dead ? Sel.struct : null;
  const sig = st ? 's' + st.id + st.lvl : us.length ? us.map(u => u.id).join(',') : 'none';
  if (sig !== App.sig) { App.sig = sig; el.innerHTML = '';
    if (!st && !us.length) { const d = document.createElement('div'); d.className = 'empty'; d.textContent = 'Nothing selected. Left-click or drag a box to select your units; right-click to give orders.'; el.appendChild(d); }
    else if (us.length > 1) { const m = document.createElement('div'); m.className = 'multi'; us.slice(0, 24).forEach(u => { const b = document.createElement('button'); b.type = 'button'; b.dataset.id = u.id; b.title = unitName(u); b.innerHTML = `<span>${unitName(u).replace('The ', '').slice(0, 3).toUpperCase()}</span><u></u>`; b.style.borderColor = G.seats[u.seat].col; m.appendChild(b); }); el.appendChild(m); }
    else { const port = document.createElement('div'); port.className = 'port'; port.title = 'Double-click to centre the camera'; const c = document.createElement('canvas'); c.width = c.height = 200; port.appendChild(c);
      const body = document.createElement('div'); body.className = 'body'; body.innerHTML = '<div class="nm"></div><div class="sub"></div><div class="hp"><u></u><span></span></div><div class="at"></div><div class="act"></div>'; el.append(port, body);
      if (st) { const S = G.seats[st.seat]; shot(makeStruct(st.type, S.fac, S.col), c, DEFS[st.type].h, 0.5); } else unitPortrait(us[0], c); } }
  if (st) { const d = DEFS[st.type], S = G.seats[st.seat], q = s => el.querySelector(s); if (!q('.nm')) return;
    q('.nm').textContent = `${d.name} Mk ${MK[st.lvl]}`; q('.nm').style.color = S.col; q('.sub').textContent = `${FACTIONS[S.fac].name} · ${S.name}`;
    q('.hp u').style.width = clamp(st.hp / st.maxHp * 100, 0, 100) + '%'; q('.hp span').textContent = `${Math.ceil(st.hp)} / ${st.maxHp}`;
    q('.at').innerHTML = `<span>Armor <b>${d.armor[st.lvl]}</b></span>` + (d.dmg ? `<span>Damage <b>${Math.round(d.dmg[st.lvl] * (st.type === 'lance' ? FACTIONS[S.fac].lance : 1))}</b></span><span>Rate <b>${d.rate}s</b></span><span>Range <b>${d.range}</b></span>` : '') + (d.slow ? `<span>Slow <b>${Math.round((d.slow[st.lvl] + FACTIONS[S.fac].slow) * 100)}%</b></span><span>Range <b>${d.range}</b></span>` : '') + (d.heal ? `<span>Repair <b>${d.heal[st.lvl]}/s</b></span><span>Range <b>${d.range}</b></span>` : '') + (d.carry ? `<span>Load <b>${Math.round(d.carry[st.lvl] * FACTIONS[S.fac].carry)}</b></span><span>Workers <b>${S.workers}/${MAX_WORKERS}</b></span>` : '');
    q('.act').textContent = st.buildT > 0 ? `Constructing ${Math.round((1 - st.buildT / st.buildTotal) * 100)}%` : S.dead ? 'Collapsing' : 'Operational'; }
  else if (us.length === 1) { const u = us[0], S = G.seats[u.seat], q = s => el.querySelector(s); if (!q('.nm')) return; const T = u.kind === 'titan' ? TITANS[u.tk] : null, U = UNITS[u.kind];
    q('.nm').textContent = unitName(u) + (u.kind === 'titan' ? ' · Lv ' + u.lvl : ''); q('.nm').style.color = u.team ? '#ff9ab0' : S.col;
    q('.sub').textContent = (u.kind === 'titan' ? T.tag : u.team ? 'Titan brood' : FACTIONS[S.fac].name) + ' · ' + S.name + (u.seat === Local.seat ? '' : u.team === localTeam() ? ' (ally)' : ' (enemy)');
    q('.hp u').style.width = clamp(u.hp / u.maxHp * 100, 0, 100) + '%'; q('.hp u').style.background = u.team ? 'var(--threat)' : 'var(--ok)'; q('.hp span').textContent = `${Math.ceil(u.hp)} / ${Math.round(u.maxHp)}`;
    const at = [['Damage', u.team ? Math.round(u.dmg) : '–'], ['Armor', (T ? u.armor : U.armor).toFixed(0)], ['Speed', (T ? T.speed : U.speed).toFixed(1)], ['Range', T && T.range ? T.range : u.team ? 'melee' : '–'], ['Vision', T ? 14 : U.vision]];
    q('.at').innerHTML = at.map(a => `<span>${a[0]} <b>${a[1]}</b></span>`).join('');
    q('.act').textContent = u.act + (u.kind === 'worker' && u.carry ? ' · carrying ' + (G.view ? 'cargo' : u.carry) : '') + (u.orders && u.orders.length > 1 ? ` · ${u.orders.length - 1} queued` : ''); }
  else if (us.length > 1) for (const b of el.querySelectorAll('.multi button')) { const u = us.find(x => x.id === +b.dataset.id); if (u) b.lastChild.style.width = clamp(u.hp / u.maxHp * 100, 0, 100) + '%'; }
}
$('info').addEventListener('click', e => { const b = e.target.closest('.multi button'); if (b) { const u = Sel.units.find(x => x.id === +b.dataset.id); if (u) setSel([u]); } });
$('info').addEventListener('dblclick', e => { if (e.target.closest('.port')) centerOn(Sel.struct || Sel.units[0]); });
let hudT = 0;
function updHud() {
  const S = localSeat(), a = G.titan, team = localTeam();
  Sel.units = Sel.units.filter(u => u.alive && G.units.includes(u) && unitShown(u, G.reveal ? -1 : team)); if (Sel.struct && Sel.struct.dead) Sel.struct = null;
  setText('clock', fmtTime(G.t));
  const left = G.seats.filter(s => s.role === 'builder' && !s.dead).length, tot = G.seats.filter(s => s.role === 'builder').length;
  let ms = `${left}/${tot} Builders`, hot = false;
  if (a) { if (a.dormant) ms += ` · ${TITANS[a.tk].name} wakes in ${fmtTime(a.wake + 1)}`; else { ms += ` · ${TITANS[a.tk].name} Lv ${a.lvl}`; hot = team === 0; } } else ms += ' · no Titan';
  if (G.view && performance.now() - Net.lastU > 5000) { ms = 'Lost contact with the host…'; hot = true; }
  setText('mstat', ms); $('mstat').classList.toggle('hot', hot);
  const builder = S && S.role === 'builder' && !S.dead, tit = S && S.role === 'titan';
  if (hudCache.kind !== (builder ? 1 : tit ? 2 : 0)) { hudCache.kind = builder ? 1 : tit ? 2 : 0; $('rLumen').hidden = $('rFlux').hidden = !builder; $('rTitan').hidden = !tit; }
  if (builder) { setText('lumen', String(Math.floor(S.lumen))); setText('flux', String(Math.floor(S.flux))); setText('rate', '+' + (G.view ? (S.rate || 0) : Math.round(S.inc.reduce((x, y) => x + y[1], 0) * 2)) + '/min'); }
  else if (tit && a) { setText('tlvl', 'LV ' + a.lvl); const f = Math.round(clamp(a.xp / xpNeed(a.lvl), 0, 1) * 100); if (hudCache.xp !== f) { hudCache.xp = f; $('xpfill').style.width = f + '%'; } setText('thp', Math.ceil(a.hp) + '/' + Math.round(a.maxHp)); }
  cv.classList.toggle('aim', !!(G.aim || G.placing));
  hudT -= 1; if (hudT > 0) return; hudT = 5;
  const rkey = G.seats.map(s => s.role !== 'builder' ? 't' : s.dead ? 'x' : (s.unit && (team !== 1) ? Math.ceil(s.unit.hp / s.unit.maxHp * 20) : 0)).join('|') + team + Local.seat;
  if (hudCache.roster !== rkey) { hudCache.roster = rkey; const r = $('roster'); r.innerHTML = '';
    for (const s of G.seats) { if (s.role !== 'builder') continue; const d = document.createElement('div'); d.className = 'rig' + (s.dead ? ' dead' : '') + (s.id === Local.seat ? ' me' : '');
      const i = document.createElement('i'); i.style.background = s.dead ? COL.husk : s.col; const n = document.createElement('span'); n.textContent = s.name + ' · ' + FACTIONS[s.fac].name.slice(0, -1) + (s.dead ? ' · husk' : ''); d.append(i, n);
      if (!s.dead && s.unit && team !== 1) { const hb = document.createElement('div'); hb.className = 'hpb'; const f = document.createElement('u'); f.style.width = Math.round(s.unit.hp / s.unit.maxHp * 100) + '%'; hb.appendChild(f); d.appendChild(hb); }
      r.appendChild(d); } }
  drawCmd(); drawInfo(); if (App.dev) drawDev();
}
function useAbility(k, atCursor) {
  const u = lead(); if (!u || u.kind !== 'titan' || u.dormant) return; const A = TITANS[u.tk].abil[k]; if (!A) return;
  if (u.cd[k] > 0) { sfx('deny'); return; }
  if (!A.aim) { sendCmd({ c: 'ab', id: u.id, k }); return; }
  if (atCursor && mouse.has) { sendCmd({ c: 'ab', id: u.id, k, x: mouse.wx, y: mouse.wy }); G.aim = null; } else G.aim = G.aim === k ? null : k;
}

/* ---------- developer test panel ---------- */
function drawDev() {
  const el = $('dev'), sig = G.seats.map(s => s.name + s.role + s.fac + s.tk).join('|') + Local.seat + G.reveal + App.nav + Net.mode;
  if (hudCache.dev === sig) return; hudCache.dev = sig;
  if (!Local.host) { el.innerHTML = '<h3>Developer panel</h3><div>Only the host can use test tools.</div>'; return; }
  el.innerHTML = `<h3>Control</h3><div class="r"><select id="devSeat" aria-label="Controlled player">${G.seats.map(s => `<option value="${s.id}" ${s.id === Local.seat ? 'selected' : ''}>${esc(s.name)} · ${s.role === 'titan' ? TITANS[s.tk].name : FACTIONS[s.fac].name}</option>`).join('')}</select></div>
    <h3>Spawn Titan at cursor</h3><div class="r">${TITAN_KEYS.map(k => `<button type="button" data-dev="titan:${k}">${TITANS[k].name.replace('The ', '')}</button>`).join('')}</div>
    <h3>Spawn at cursor</h3><div class="r"><button type="button" data-dev="unit:worker">Worker</button><button type="button" data-dev="unit:husk">Husk</button><button type="button" data-dev="unit:brood">Broodling</button></div>
    <div class="r"><select id="devType" aria-label="Structure to spawn">${TYPES.map(t => `<option value="${t}">${DEFS[t].name}</option>`).join('')}</select><button type="button" data-dev="struct">Structure</button></div>
    <h3>Resources and view</h3><div class="r"><button type="button" data-dev="res">+500 Lumen +5 Flux</button></div>
    <div class="r"><button type="button" data-dev="reveal" class="${G.reveal ? 'on' : ''}">Reveal map</button><button type="button" data-dev="nav" class="${App.nav ? 'on' : ''}">Nav overlay</button></div>
    <div class="r"><button type="button" data-dev="reset">Reset map</button></div>`;
}
function devAt() { return mouse.has ? [mouse.wx, mouse.wy] : [cam.x, cam.y]; }
$('dev').addEventListener('change', e => { if (e.target.id === 'devSeat') { devControl(+e.target.value); G.visTeam = -9; updVis(); selectMain(); centerOn(localUnit()); hudCache.dev = ''; App.cmdSig = ''; e.target.blur(); } });
$('dev').addEventListener('click', e => { const b = e.target.closest('button'); if (!b || !Local.host) return; const [k, v] = b.dataset.dev.split(':'), [x, y] = [cam.x, cam.y];
  if (k === 'titan') { const t = devTitan(v, x, y); if (G.seats[t.seat].id === Local.seat) { t.ai = null; selectMain(); } say(`${TITANS[v].name} spawned at the camera centre.`, 'warn'); hudCache.dev = ''; }
  else if (k === 'unit') { const u = devUnit(v, Local.seat, x, y); say(u ? `${v} spawned.` : v === 'worker' ? 'Control a Builder to spawn workers.' : 'Spawn a Titan first.', u ? '' : 'warn'); }
  else if (k === 'struct') { const S = localSeat(), seat = S && S.role === 'builder' ? S.id : G.seats.findIndex(s => s.role === 'builder' && !s.dead), s = devStruct($('devType').value, seat, Math.round(x) - 1, Math.round(y) - 1); say(s ? `${DEFS[s.type].name} spawned.` : 'No room for a structure at the camera centre.', s ? '' : 'warn'); }
  else if (k === 'res') { const S = localSeat(); if (S) { S.lumen += 500; S.flux += 5; } }
  else if (k === 'reveal') { G.reveal = !G.reveal; G.visTeam = -9; updVis(); hudCache.dev = ''; }
  else if (k === 'nav') { App.nav = !App.nav; R3.navMesh.visible = App.nav; if (App.nav) updNav(); hudCache.dev = ''; }
  else if (k === 'reset') { const seat = Local.seat; newGame(G.cfg); Local.seat = seat; beginMatch(); }
  b.blur(); });
$('btnDev').addEventListener('click', e => { App.dev = !App.dev; $('dev').hidden = !App.dev; e.currentTarget.classList.toggle('on', App.dev); hudCache.dev = ''; e.currentTarget.blur(); });

/* ---------- input: selection, orders, camera ---------- */
const ptrs = new Map(); let pinch = null, lastPaint = -1, lastClick = { t: 0, kind: '' };
function aimMouse() { const p = pickAt(mouse.x, mouse.y); mouse.wx = p.wx; mouse.wy = p.wy; mouse.tx = Math.floor(p.wx); mouse.ty = Math.floor(p.wy); mouse.n = p.n; mouse.s = p.s && !(localTeam() === 1 && !G.reveal && !p.s._seen) ? p.s : null; mouse.u = p.u; }
function setMouse(e) { const r = cv.getBoundingClientRect(); mouse.x = e.clientX - r.left; mouse.y = e.clientY - r.top; aimMouse(); mouse.has = true; }
function tryPlace(shift) {
  const S = localSeat(), L = lead(), type = G.placing, [ax, ay] = anchorOf(), i = ay * MW + ax; if (i === lastPaint || !S || !L || L.kind !== 'builder') return;
  const why = placeBlock(S, type, ax, ay);
  if (why === 'occupied') return; lastPaint = i;
  if (why) { sfx('deny'); return; }
  sendCmd({ c: 'b', id: L.id, t: type, tx: ax, ty: ay, q: true }); sfx('place');
  if (G.view) { for (const [dx, dy] of FOOT) G.reserved[idx(ax + dx, ay + dy)] = 1; G.viewJobs.push({ seat: S.id, type, tx: ax, ty: ay }); }
  if (!shift && type !== 'wall') G.placing = null;
}
/* Right-click: the context command for whatever is under the cursor. */
function contextCmd(shift, forceMove) {
  const us = ownSel(); if (!us.length || !inMap(mouse.tx, mouse.ty)) return; const ids = us.map(u => u.id), team = localTeam(), tu = mouse.u, ts = mouse.s, q = shift, ni = mouse.n >= 0 ? mouse.n : idx(mouse.tx, mouse.ty), v = M.tiles[ni], nx = ni % MW, ny = (ni / MW) | 0;
  const mark = (x, y, c) => { ring(x, y, 0.9, 0.2, c); sfx('ack'); };
  if (!forceMove && tu && tu.team !== team && team === 1) { sendCmd({ c: 'at', ids, uid: tu.id, q }); mark(tu.x, tu.y, '#ff6a6a'); }
  else if (!forceMove && ts && team === 1) { sendCmd({ c: 'at', ids, sid: ts.id, q }); mark(ts.x, ts.y, '#ff6a6a'); }
  else if (!forceMove && ts && team === 0 && ts.buildT <= 0 && ts.hp < ts.maxHp) { sendCmd({ c: 'rp', ids, sid: ts.id, q }); mark(ts.x, ts.y, '#ffd27a'); }
  else if (!forceMove && team === 0 && (isNode(v) || v === VEIN)) { sendCmd({ c: 'hv', ids, tx: nx, ty: ny, q }); mark(nx + .5, ny + .5, v === VEIN ? COL.flux : COL.lumen); }
  else { sendCmd({ c: G.aim === 'amove' ? 'am' : 'mv', ids, x: mouse.wx, y: mouse.wy, q }); mark(mouse.wx, mouse.wy, G.aim === 'amove' ? '#ff6a6a' : '#7dffb0'); }
}
function leftClick(shift) {
  if (G.aim) { const L = lead(), a = G.aim; G.aim = null; if (!L) return;
    if (a === 'dash') sendCmd({ c: 'ds', id: L.id, x: mouse.wx, y: mouse.wy });
    else if (a === 'amove') { G.aim = 'amove'; contextCmd(shift, true); G.aim = null; }
    else if (a === 'repair') { if (mouse.s) sendCmd({ c: 'rp', ids: ownSel().map(u => u.id), sid: mouse.s.id, q: shift }); else sfx('deny'); }
    else sendCmd({ c: 'ab', id: L.id, k: a, x: mouse.wx, y: mouse.wy });
    return; }
  const u = mouse.u, now = performance.now();
  if (u) { if (u.seat === Local.seat && now - lastClick.t < 350 && lastClick.kind === u.kind) setSel(myUnits().filter(o => o.kind === u.kind && (o => o[2] < 1 && o[0] > 0 && o[0] < W && o[1] > 0 && o[1] < H)(w2s(o.x, o.y, 0))));
    else setSel([u], null, shift && u.seat === Local.seat && Sel.units.every(o => o.seat === Local.seat)); lastClick = { t: now, kind: u.kind }; sfx('ack'); return; }
  if (mouse.s) { setSel([], mouse.s); sfx('ack'); return; }
  if (mouse.n >= 0 && ownSel().some(o => o.team === 0)) { contextCmd(shift); return; }
  if (!shift) setSel([]);
}
function boxSelect(b, shift) {
  const x0 = Math.min(b.x0, b.x1), x1 = Math.max(b.x0, b.x1), y0 = Math.min(b.y0, b.y1), y1 = Math.max(b.y0, b.y1);
  let us = myUnits().filter(u => { const p = w2s(u.x, u.y, 0.5); return p[2] < 1 && p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1; });
  if (us.some(u => u.kind !== 'worker') && us.some(u => u.kind === 'worker') && us.some(u => u.team === 0 && u.kind === 'builder')) us = us.filter(u => u.kind !== 'worker' || shift);
  if (us.length || !shift) setSel(shift ? [...new Set([...Sel.units.filter(u => u.seat === Local.seat), ...us])] : us);
}
const live = () => App.phase === 'game' && !App.paused && G;
let lastRight = 0;
function rightClick(shift) { lastRight = performance.now(); if (G.placing || (G.aim && G.aim !== 'amove')) { G.placing = null; G.aim = null; } else { contextCmd(shift); G.aim = null; } }
/* Orders go out on right-button press; the contextmenu event is a fallback where the press never reaches the page. */
let ctxAt = 0;
cv.addEventListener('contextmenu', e => { e.preventDefault(); ctxAt = performance.now(); mouse.box = null; if (live() && performance.now() - lastRight > 450) { setMouse(e); rightClick(e.shiftKey); } });
cv.addEventListener('pointerdown', e => {
  if (!live()) return; e.preventDefault(); audioInit(); cv.focus();
  try { cv.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ }
  setMouse(e);
  ptrs.set(e.pointerId, { x: mouse.x, y: mouse.y, sx: mouse.x, sy: mouse.y, type: e.pointerType, btn: e.button, moved: false, shift: e.shiftKey });
  if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; a.moved = b.moved = true; mouse.box = null; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: cam.zoom, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; return; }
  if (e.pointerType === 'mouse' && e.button === 0 && G.placing) { lastPaint = -1; ptrs.get(e.pointerId).placed = true; tryPlace(e.shiftKey); }
  else if (e.pointerType === 'mouse' && (e.button === 2 || (e.button === 0 && e.ctrlKey))) { ptrs.get(e.pointerId).asRight = true; rightClick(e.shiftKey); }
});
const panBy = (dx, dy) => { const [ax, ay] = s2w(W / 2, H / 2), [bx, by] = s2w(W / 2 + dx, H / 2 + dy); cam.x -= bx - ax; cam.y -= by - ay; };
cv.addEventListener('pointermove', e => {
  if (App.phase !== 'game') return; const p = ptrs.get(e.pointerId);
  if (!p) { if (e.pointerType === 'mouse') setMouse(e); return; }
  const r = cv.getBoundingClientRect(), nx = e.clientX - r.left, ny = e.clientY - r.top, dx = nx - p.x, dy = ny - p.y; p.x = nx; p.y = ny;
  if (pinch && ptrs.size === 2) { const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    cam.zoom = clamp(pinch.zoom * d / Math.max(20, pinch.d), minZoom(), 80); panBy(mx - pinch.mx, my - pinch.my); pinch.mx = mx; pinch.my = my; return; }
  if (!p.moved && Math.hypot(nx - p.sx, ny - p.sy) > 6) { p.moved = true; lastPaint = -1; }
  if (p.type === 'mouse') { setMouse(e);
    if (p.btn === 1) panBy(dx, dy);
    else if (p.btn === 0 && G.placing) { if (G.placing === 'wall') tryPlace(true); }
    else if (p.btn === 0 && p.moved && !G.aim && !p.placed && !p.asRight) mouse.box = { x0: p.sx, y0: p.sy, x1: nx, y1: ny };
    return; }
  if (p.moved) { if (G.placing === 'wall') { setMouse(e); tryPlace(true); } else panBy(dx, dy); }
});
function pointerEnd(e) {
  const p = ptrs.get(e.pointerId); if (!p) return; ptrs.delete(e.pointerId);
  if (ptrs.size < 2) pinch = null;
  const box = mouse.box; mouse.box = null;
  if (!live() || e.type === 'pointercancel') return;
  setMouse(e);
  if (p.type === 'mouse') {
    if (p.btn === 0 && !p.asRight && performance.now() - ctxAt > 400) { if (box) boxSelect(box, e.shiftKey); else if (!G.placing && !p.placed) leftClick(e.shiftKey); }
    return;
  }
  if (!p.moved) { if (G.placing) { lastPaint = -1; tryPlace(false); } else if (G.aim) leftClick(false); else if (mouse.u && mouse.u.seat === Local.seat) leftClick(false); else if (mouse.s && (mouse.s.seat === Local.seat || !ownSel().length)) leftClick(false); else if (ownSel().length) contextCmd(false); else leftClick(false); }
}
cv.addEventListener('pointerup', pointerEnd); cv.addEventListener('pointercancel', pointerEnd);
cv.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && !ptrs.size) mouse.has = false; });
cv.addEventListener('wheel', e => { if (App.phase !== 'game') return; e.preventDefault(); const [wx, wy] = s2w(mouse.x, mouse.y); cam.zoom = clamp(cam.zoom * Math.pow(1.0015, -e.deltaY), minZoom(), 80); placeCamera(); const [nx, ny] = s2w(mouse.x, mouse.y); cam.x += wx - nx; cam.y += wy - ny; }, { passive: false });
function miniMove(e) { const r = mini.getBoundingClientRect(); cam.x = clamp((e.clientX - r.left) / r.width, 0, 1) * MW; cam.y = clamp((e.clientY - r.top) / r.height, 0, 1) * MH; }
mini.addEventListener('contextmenu', e => { e.preventDefault(); const r = mini.getBoundingClientRect(), us = ownSel(); if (us.length) sendCmd({ c: 'mv', ids: us.map(u => u.id), x: clamp((e.clientX - r.left) / r.width, 0, 1) * MW, y: clamp((e.clientY - r.top) / r.height, 0, 1) * MH, q: e.shiftKey }); });
mini.addEventListener('pointerdown', e => { if (e.button !== 0) return; e.preventDefault(); try { mini.setPointerCapture(e.pointerId); } catch (err) { /* synthetic pointer */ } mini._d = true; miniMove(e); });
mini.addEventListener('pointermove', e => { if (mini._d) miniMove(e); });
mini.addEventListener('pointerup', () => { mini._d = false; }); mini.addEventListener('pointercancel', () => { mini._d = false; });
/* edge panning */
const edge = { x: -1, y: -1, on: false };
document.addEventListener('mousemove', e => { edge.x = e.clientX; edge.y = e.clientY; edge.on = true; });
document.addEventListener('mouseleave', () => { edge.on = false; });
const keys = new Set();
window.addEventListener('keydown', e => {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'F10'].includes(k)) e.preventDefault();
  if (App.phase !== 'game') return;
  if (k === 'F10') { togglePause(); return; }
  if (e.metaKey) return;
  if (App.paused) { if (k === 'Escape') togglePause(); return; }
  const dg = /^Digit[1-9]$/.test(e.code) ? e.code.slice(5) : '';
  if (dg) { const k = dg; e.preventDefault(); if (e.ctrlKey || e.altKey) { Sel.groups[k] = ownSel().map(u => u.id); say(`Group ${k} set (${Sel.groups[k].length}).`); } else { const us = (Sel.groups[k] || []).map(unitById).filter(u => u && u.alive && u.seat === Local.seat); if (us.length) { if (us.every(u => Sel.units.includes(u)) && Sel.units.length === us.length) centerOn(us[0]); setSel(us); } } return; }
  if (e.ctrlKey || e.altKey) return;
  keys.add(k); if (e.repeat) return;
  if (k === 'm') { toggleSound(); return; }
  if (k === '`') { $('btnDev').click(); return; }
  if (k === 'Escape') { if (G.placing || G.aim) { G.placing = null; G.aim = null; } else setSel([]); return; }
  if (k === ' ') { centerOn(Sel.struct || Sel.units[0] || localUnit()); return; }
  for (const s of cmdSpec()) if (s.key.toLowerCase() === (e.shiftKey && k === 'u' ? '⇧u' : k)) { if (s.id.startsWith('ab:')) useAbility(s.id.slice(3), true); else if (s.id === 'dash' && mouse.has) { const L = lead(); if (L.dashCd > 0) sfx('deny'); else sendCmd({ c: 'ds', id: L.id, x: mouse.wx, y: mouse.wy }); } else s.run(); return; }
});
window.addEventListener('keyup', e => keys.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key));
window.addEventListener('blur', () => { keys.clear(); edge.on = false; });
function panInput(dt) {
  let dx = 0, dy = 0; if (keys.has('ArrowLeft') || keys.has('a')) dx--; if (keys.has('ArrowRight') || keys.has('d')) dx++; if (keys.has('ArrowUp') || keys.has('w')) dy--; if (keys.has('ArrowDown') || keys.has('s')) dy++;
  if (edge.on && !ptrs.size && document.hasFocus()) { if (edge.x <= 6) dx--; else if (edge.x >= innerWidth - 7) dx++; if (edge.y <= 6) dy--; else if (edge.y >= innerHeight - 7) dy++; }
  if (dx || dy) { const sp = 34 * (30 / cam.zoom + 0.4) * dt; cam.x += dx * sp; cam.y += dy * sp; if (mouse.has) aimMouse(); }
}

/* ---------- screens ---------- */
const CONTROLS = `<ul class="keys">
  <li><b>LEFT CLICK</b><span>Select a unit or structure. Drag a box for several. Shift adds. Double-click selects all of that type on screen.</span></li>
  <li><b>RIGHT CLICK</b><span>Order: move, attack an enemy, harvest a plant, crystal or the Sink, repair a damaged structure. Shift queues. Left-clicking a resource with Builders or workers selected also harvests it.</span></li>
  <li><b>CTRL / ALT+1…9</b><span>Save a control group (use Alt where the browser keeps Ctrl+number for tabs); the number recalls it, twice to jump there.</span></li>
  <li><b>WASD · ARROWS · EDGES</b><span>Pan the camera. Middle-drag pans too. Wheel zooms. Space jumps to the selection. Click the minimap to move.</span></li>
  <li><b>Q E R T G B V</b><span>Builder: place structures (drag to paint walls, Shift to keep placing). F dash, C repair, X stop.</span></li>
  <li><b>Q E R F · G X H</b><span>Titan: four abilities at the cursor; attack-move, stop, hold position.</span></li>
  <li><b>U · Z · T</b><span>Selected structure: upgrade, salvage, train a worker at a Drone Bay.</span></li>
  <li><b>ESC · F10 · \`</b><span>Cancel targeting; menu; developer test panel.</span></li>
</ul>`;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function overlay(html) { const o = $('overlay'); o.hidden = false; o.innerHTML = `<div class="brief">${html}</div>`; return o; }
const card = (k, t) => { const d = t ? TITANS[k] : FACTIONS[k]; return `<button type="button" class="card pnl ${t ? 't' : ''}" data-pick="${k}"><canvas width="168" height="168" data-pv="${k}"></canvas><span><b>${d.name}</b><i>${d.tag}</i><span>${d.blurb}</span></span></button>`; };
function showMenu() {
  App.phase = 'menu'; $('hud').hidden = true;
  overlay(`<div class="eyebrow">Survey ring 7 · 04°S 171°W</div><h1>Kessler <em>Atoll</em></h1>
    <p>Builders settle a volcanic ring around a flooded crater, harvest Lumen, wall in and arm up. Beneath the crater sleeps a Titan that hunts them, and every Builder it kills rises as a husk on its side. Pick a side to enter the island; bots play everyone else.</p>
    <div class="eyebrow">Builders</div><div class="cards">${FAC_KEYS.map(k => card(k, false)).join('')}</div>
    <div class="eyebrow">Titans</div><div class="cards">${TITAN_KEYS.map(k => card(k, true)).join('')}</div>
    <div class="rowb"><span class="eyebrow">Bot strength</span>${Object.entries(DIFFS).map(([k, d]) => `<button type="button" data-diff="${k}" class="${k === App.diff ? 'on' : ''}">${d.name}</button>`).join('')}
      <label class="field"><span>Callsign</span><input id="nick" type="text" maxlength="12" autocomplete="off" spellcheck="false" value="${esc(App.nick)}"></label></div>
    <div id="mp"></div>
    <details><summary>Controls</summary>${CONTROLS}</details>`);
  menuChanged();
}
function menuChanged() {
  const el = $('mp'); if (!el || App.phase !== 'menu') return;
  if (!Net.ready || !Net.api) { el.innerHTML = Net.ready ? '' : '<p class="note">Looking for a live room…</p>'; return; }
  el.innerHTML = `<div class="rowb"><span class="eyebrow">With other people</span><button type="button" data-host="1">Host a match</button>${Net.open.map(m => `<button type="button" data-join="${esc(m.code)}">${m.phase === 'game' ? 'Watch' : 'Join'} ${esc(m.nick)} (${m.n})</button>`).join('')}</div>`;
}
function readNick() { const i = $('nick'); if (i) { App.nick = cleanNick(i.value); try { localStorage.setItem('ka-nick', App.nick); } catch (e) { /* storage unavailable */ } } }
const pickName = k => TITANS[k] ? TITANS[k].name : FACTIONS[k].name;
function showLobby() {
  App.phase = 'lobby'; $('hud').hidden = true;
  overlay(`<div class="eyebrow">Match ${esc(Net.code.toUpperCase())} · ${Net.mode === 'hostlobby' ? 'you are hosting' : 'waiting for the host'}</div><h1>Muster <em>point</em></h1>
    <div class="rowb"><span class="eyebrow">You play</span><select id="want" aria-label="Your side">${[...FAC_KEYS, ...TITAN_KEYS].map(k => `<option value="${k}" ${k === App.pick ? 'selected' : ''}>${pickName(k)}</option>`).join('')}</select></div>
    <ul class="matches" id="members"></ul><div id="hostbox"></div>
    <div class="rowb"><button type="button" data-leave="1">Leave</button></div>`);
  $('want').addEventListener('change', e => { App.pick = e.target.value; if (Net.room) Net.room.presence({ want: App.pick }).catch(noop); });
  lobbyChanged();
}
function lobbyChanged() {
  if (App.phase !== 'lobby') return; const ul = $('members'); if (!ul) return;
  const tit = Net.members.find(m => TITANS[m.want]);
  ul.innerHTML = Net.members.map(m => `<li><span><b>${esc(m.nick)}</b>${m.me ? ' (you)' : ''}${m.host ? ' · host' : ''}</span><span class="tag ${m === tit ? 'threat' : ''}">${m === tit ? pickName(m.want) : TITANS[m.want] ? 'Builder (Titan taken)' : pickName(m.want)}</span></li>`).join('');
  const hb = $('hostbox'); if (!hb) return;
  if (Net.mode !== 'hostlobby') { hb.innerHTML = '<p class="note">The host starts the match. Empty seats are filled by bots.</p>'; return; }
  hb.innerHTML = `<div class="rowb"><span class="eyebrow">Bot Builders</span><button type="button" data-bots="-1" aria-label="Fewer bots">−</button><b>${App.bots}</b><button type="button" data-bots="1" aria-label="More bots">+</button>
    <span class="eyebrow">Strength</span>${Object.entries(DIFFS).map(([k, d]) => `<button type="button" data-diff="${k}" class="${k === App.diff ? 'on' : ''}">${d.name}</button>`).join('')}<button type="button" data-start="1" class="on">Start match</button></div>
    <p class="note">${tit ? esc(tit.nick) + ' plays ' + pickName(tit.want) + '.' : 'Nobody has taken a Titan, so a bot will play the Hollow.'}</p>`;
}
function showEnd() {
  const o = G.over, team = localTeam(), won = team < 0 ? null : (o.winner === 'titan') === (team === 1), alive = G.seats.filter(s => s.role === 'builder' && !s.dead).length, total = G.seats.filter(s => s.role === 'builder').length, tn = G.titan ? TITANS[G.titan.tk].name : 'The Titan';
  $('hud').hidden = true; App.phase = 'end';
  overlay(`<div class="eyebrow">${won === null ? 'match over' : won ? 'your side won' : 'your side lost'}</div>
    <h1 class="${won === false ? 'bad' : ''}">${o.kind === 'kill' ? `${tn.replace('The ', 'The ')} is <em>dead</em>` : 'The atoll is <em>silent</em>'}</h1>
    <p>${o.kind === 'kill' ? 'The Builders grew strong enough to bring the Titan down.' : 'Every Builder was taken. The Titan has the island to itself.'}</p>
    <div class="stats"><div><b>${fmtTime(G.endT === undefined ? G.t : G.endT)}</b>match length</div><div><b>Lv ${G.endL || 1}</b>${tn}</div><div><b>${alive} of ${total}</b>Builders standing</div><div><b>${G.structs.filter(s => !s.dead).length}</b>structures standing</div></div>
    <div class="rowb">${Net.mode === 'host' ? '<button type="button" data-relobby="1" class="on">Back to lobby</button>' : ''}${Net.mode === 'solo' ? '<button type="button" data-again="1" class="on">Play again</button>' : ''}<button type="button" data-leave="1">Selection screen</button></div>`);
}
function showPause() {
  const solo = Net.mode === 'solo';
  overlay(`<div class="eyebrow">${solo ? 'Paused' : 'Match still running'} · ${fmtTime(G.t)}</div><h1>Kessler <em>Atoll</em></h1>${CONTROLS}
    <div class="rowb"><button type="button" data-resume="1" class="on">Resume</button><button type="button" data-leave="1">${solo ? 'Abandon' : 'Leave match'}</button></div>`);
}
function startSolo(pick) {
  App.pick = pick; Net.mode = 'solo'; Local.host = true; const tit = !!TITANS[pick], bots = FAC_KEYS.filter(f => f !== pick), nb = tit ? 6 : 5;
  const seats = BOT_NAMES.slice(0, nb).map((n, k) => ({ name: n, role: 'builder', bot: true, fac: tit ? FAC_KEYS[k % 3] : [...bots, pick][k % 3] }));
  if (tit) seats.push({ name: App.nick, role: 'titan', bot: false, tk: pick }); else { seats.unshift({ name: App.nick, role: 'builder', bot: false, fac: pick }); seats.push({ name: 'TITAN', role: 'titan', bot: true, tk: TITAN_KEYS[(Math.random() * 4) | 0] }); }
  newGame({ diffKey: App.diff, seats }); Local.seat = tit ? nb : 0;
  beginMatch();
}
function beginMatch() {
  audioInit(); App.phase = 'game'; App.paused = false; simAcc = 0; simLast = performance.now(); Sel.units = []; Sel.struct = null; Sel.groups = {};
  $('overlay').hidden = true; $('hud').hidden = false; $('feed').innerHTML = ''; for (const k in hudCache) delete hudCache[k]; App.sig = ''; App.cmdSig = '';
  resize(); cam.zoom = defaultZoom(); const u = localUnit(); if (u) { cam.x = u.x; cam.y = u.y; selectMain(); } else { cam.x = CX; cam.y = CY; cam.zoom = minZoom() * 1.3; }
  G.visTeam = -9; updVis(); if (App.nav) updNav(); cv.focus();
  const S = localSeat();
  if (S && S.role === 'builder') { say(`${FACTIONS[S.fac].name} landing party on the ground. The island is dark until you explore it.`, 'good'); G.tipList = TIPS_BUILDER; }
  else if (S) { say(`You are ${TITANS[S.tk].name}. You wake in the Sink shortly.`, 'warn'); G.tipList = TIPS_TITAN; } else G.tipList = [];
}
const TIPS_BUILDER = [
  [3, 'Your Builder is selected. Build a Drone Bay (B) near plants or cyan crystals, then select it and train workers (T).'],
  [22, 'Workers harvest and carry loads back by themselves. Right-click a resource with your Builder to gather by hand.'],
  [45, 'Base spots: raised mesas reached by one long ramp, and clearings ringed by forest or cliffs with one mouth. Each has crystals inside.'],
  [70, 'Bulwarks (Q) are two tiles wide. Leave a one-tile gap: Builders and workers fit through, the Titan does not.'],
  [95, 'A Forge (V) unlocks Mk II and the heavy turrets. Mk III needs Flux, drawn from the deposit in the Sink.'],
];
const TIPS_TITAN = [
  [3, 'Builders are scattering across the ring. You grow with time, and faster from everything you break.'],
  [20, 'Right-click to move or attack. Q E R F are your abilities; G is attack-move. WASD moves the camera.'],
  [44, 'You are too big for one-tile gaps and cannot cross plants or cliffs. Standing in the Sink heals you fast.'],
];
function togglePause() { if (App.phase !== 'game' || G.over) return; App.paused = !App.paused; if (App.paused) showPause(); else { $('overlay').hidden = true; simLast = performance.now(); cv.focus(); } }
function toggleSound() { AU.muted = !AU.muted; $('btnSound').classList.toggle('off', AU.muted); try { localStorage.setItem('ka-muted', AU.muted ? '1' : '0'); } catch (e) { /* storage unavailable */ } }
function hostLost() { if (App.phase === 'menu') return; leaveRoom().then(() => { attract(); showMenu(); const el = $('mp'); if (el) el.insertAdjacentHTML('afterbegin', '<p class="note warn">The host left, so that match is over.</p>'); }); }
function attract() { Local.host = true; Local.seat = -1; newGame({ diffKey: 'standard', seats: [] }); G.vis.fill(1); G.explored.fill(1); Sel.units = []; Sel.struct = null; }
async function leaveToMenu() { App.paused = false; await leaveRoom(); attract(); showMenu(); }
$('overlay').addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return; const d = b.dataset;
  if (d.pick) { readNick(); startSolo(d.pick); }
  else if (d.again) startSolo(App.pick);
  else if (d.diff) { App.diff = d.diff; document.querySelectorAll('[data-diff]').forEach(x => x.classList.toggle('on', x.dataset.diff === App.diff)); }
  else if (d.host) { readNick(); b.disabled = true; try { await hostMatch(App.nick, App.pick); showLobby(); } catch (err) { b.disabled = false; } }
  else if (d.join) { readNick(); b.disabled = true; try { await joinMatch(d.join, App.nick, App.pick); showLobby(); } catch (err) { b.disabled = false; } }
  else if (d.bots) { App.bots = clamp(App.bots + (+d.bots), 0, MAX_BUILDERS - 1); lobbyChanged(); }
  else if (d.start) { const seats = lobbySeats(App.bots, 'hollow'); if (!seats.some(s => s.role === 'builder')) { $('hostbox').insertAdjacentHTML('beforeend', '<p class="note warn">A match needs at least one Builder. Add a bot.</p>'); return; } hostStart(seats, App.diff); beginMatch(); }
  else if (d.relobby) { Net.mode = 'hostlobby'; attract(); Net.room.presence({ phase: 'lobby', seats: null }).catch(noop); if (Net.lobby) Net.lobby.presence({ phase: 'lobby' }).catch(noop); showLobby(); }
  else if (d.resume) togglePause();
  else if (d.leave) leaveToMenu();
});
$('btnPause').addEventListener('click', e => { togglePause(); e.currentTarget.blur(); });
$('btnSound').addEventListener('click', e => { audioInit(); toggleSound(); e.currentTarget.blur(); });
$('btnSound').classList.toggle('off', AU.muted);

/* ---------- main loops ---------- */
let simAcc = 0, simLast = performance.now(), simN = 0, last = performance.now(), pvI = 0, navT = 0;
const PV = {};
function menuPreviews(t) { // one rotating model per frame keeps the selection screen cheap
  const cs = document.querySelectorAll('[data-pv]'); if (!cs.length || !R3.ok) return; const c = cs[pvI++ % cs.length], k = c.dataset.pv;
  if (!PV[k]) { if (TITANS[k]) { PV[k] = makeTitan(k); PV[k].userData.hh = k === 'colossus' ? 4.2 : k === 'wraith' ? 3.2 : 2.6; } else { const g = new T3.Group(), b = makeBuilder(k, '#ffb648'); b.scale.setScalar(1.5); b.position.x = 0.9; const w = makeStruct('pulse', k, '#ffb648'); w.scale.setScalar(0.75); w.position.x = -0.7; g.add(b, w); PV[k] = g; PV[k].userData.hh = 2.0; } }
  shot(PV[k], c, PV[k].userData.hh, t * 0.7, TITANS[k] ? undefined : 7.4);
}
function simStep() { // timer-driven so a hosted match keeps running if the host's tab is in the background
  const now = performance.now(), dt = Math.min(1, (now - simLast) / 1000); simLast = now;
  if (App.phase !== 'game' || !Local.host || !G || (App.paused && Net.mode === 'solo')) return;
  simAcc += dt; let n = 0;
  while (simAcc >= STEP && n < 30) { tick(STEP); simAcc -= STEP; n++; if (Net.mode === 'host' && ++simN % 3 === 0) hostNetTick(); }
  if (n === 30) simAcc = 0;
}
setInterval(simStep, 33);
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (App.phase === 'game' && G) {
    if (!App.paused) panInput(dt);
    if (G.view) { viewTick(dt); for (const p of G.pools) p.t -= dt; G.pools = G.pools.filter(p => p.t > 0); if (!G.camInit && localUnit()) { G.camInit = true; centerOn(localUnit()); cam.zoom = defaultZoom(); selectMain(); } }
    G.visT -= dt; if (G.visT <= 0) { updVis(); G.visT = 0.2; }
    if (App.nav && (navT -= dt) <= 0) { navT = 0.5; updNav(); }
    while (G.tipList && G.tips < G.tipList.length && G.t >= G.tipList[G.tips][0]) say(G.tipList[G.tips++][1]);
  } else if (App.phase === 'menu') menuPreviews(now / 1000);
  try { render(dt); } catch (e) { console.error(e); }
  requestAnimationFrame(frame);
}
window.addEventListener('resize', resize);
resize(); attract(); showMenu(); netInit();
requestAnimationFrame(frame);

// test hook
window.__ka = { get G() { return G; }, M, DEFS, TITANS, FACTIONS, Net, App, Local, Sel, cam, R3, pickAt, heightAt, findPath, passVert, sim(sec) { const n = Math.round(sec / STEP); for (let i = 0; i < n && !G.over; i++) tick(STEP); }, applyCmd, startSolo, w2s, s2w, devTitan, devUnit, devStruct, devControl, setSel, castAbility, mkStruct, trainWorker };
