/* =====================================================================
   04 render: 3D presentation only (three.js). Reads game state, never
   changes it. Heightfield terrain with baked shading, instanced alien
   plants and lumen crystals, low-poly models per faction and per Titan,
   three-state fog of war, and a 2D overlay for bars, names and marquee.
   ===================================================================== */
const cv = $('view'), ctx = cv.getContext('2d'), glc = $('gl');
let W = 0, H = 0, DPR = 1;
const cam = { x: CX, y: CY, zoom: 30 };
const FOV = 30, PITCH = 56 * Math.PI / 180;
const R3 = { ok: false };
function defaultZoom() { return clamp(W / 40, 16, 32); }
function minZoom() { return 6; }
const T3 = window.THREE;
const Sel = { units: [], struct: null, groups: {} };   // what the local player has selected

function canvasTex(n, draw, rep) { const c = document.createElement('canvas'); c.width = c.height = n; draw(c.getContext('2d'), n); const t = new T3.CanvasTexture(c); t.wrapS = t.wrapT = T3.RepeatWrapping; t.magFilter = T3.NearestFilter; if (rep) t.repeat.set(rep, rep); return t; }
function initGL() {
  if (!T3) return;
  let renderer;
  try { renderer = new T3.WebGLRenderer({ canvas: glc, antialias: true, powerPreference: 'high-performance' }); } catch (e) { return; }
  const scene = new T3.Scene(); scene.background = new T3.Color(0x4a2f4a); scene.fog = new T3.Fog(0x6a4258, 120, 260);
  const camera = new T3.PerspectiveCamera(FOV, 1, 1, 420);
  scene.add(new T3.HemisphereLight(0xffe4c4, 0x6a4a5e, 0.74));
  const sun = new T3.DirectionalLight(0xffb070, 1.08); sun.castShadow = true; const sm = Math.min(4096, renderer.capabilities.maxTextureSize); sun.shadow.mapSize.set(sm, sm);
  const sc = sun.shadow.camera; sc.left = -48; sc.right = 48; sc.top = 48; sc.bottom = -48; sc.near = 1; sc.far = 170; sun.shadow.bias = -0.0012; sun.shadow.radius = 3;
  scene.add(sun); scene.add(sun.target);
  const fill = new T3.DirectionalLight(0xff86b4, 0.2); fill.position.set(40, 30, -30); scene.add(fill);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = T3.PCFSoftShadowMap;
  Object.assign(R3, { ok: true, renderer, scene, camera, sun, structs: new Map(), units: new Map(), mats: new Map(), geos: {}, dying: [] });
  const g = R3.geos; g.box = new T3.BoxGeometry(1, 1, 1); g.cyl = new T3.CylinderGeometry(1, 1, 1, 18); g.cyl6 = new T3.CylinderGeometry(1, 1, 1, 6); g.sph = new T3.SphereGeometry(1, 16, 12); g.cone = new T3.ConeGeometry(1, 1, 14); g.cone4 = new T3.ConeGeometry(1, 1, 4); g.octa = new T3.OctahedronGeometry(1); g.tetra = new T3.TetrahedronGeometry(1);
  g.ring = new T3.RingGeometry(0.9, 1, 56); g.disc = new T3.CircleGeometry(1, 32); g.torus = new T3.TorusGeometry(1, 0.06, 8, 32); g.dome = new T3.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  // subtle brushed grain for models; a large hand-painted style ground texture for the terrain
  R3.grain = canvasTex(256, (c, n) => { const r = mulberry32(5), im = c.createImageData(n, n); for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const v = 222 + ((vnoise(x * 0.06, y * 0.06) * 26 + vnoise(x * 0.3, y * 0.3) * 10 + r() * 6) | 0), o = (y * n + x) * 4; im.data[o] = im.data[o + 1] = im.data[o + 2] = Math.min(255, v); im.data[o + 3] = 255; } c.putImageData(im, 0, 0); });
  R3.grain.magFilter = T3.LinearFilter;
  R3.ground = canvasTex(1024, (c, n) => { const r = mulberry32(9), im = c.createImageData(n, n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const u = x / n * 16, v = y / n * 16, w = (a, b2, f) => vnoise(((a % f) + f) % f, ((b2 % f) + f) % f); // tiling noise
      const big = (w(u, v, 16) + w(u + 16, v, 16) * 0 ) , v0 = 190 + vnoise(u * 2, v * 2) * 34 + vnoise(u * 7, v * 7) * 20 + vnoise(u * 19, v * 19) * 12 + big * 0, o = (y * n + x) * 4; im.data[o] = im.data[o + 1] = im.data[o + 2] = Math.min(255, v0); im.data[o + 3] = 255; }
    c.putImageData(im, 0, 0);
    c.lineCap = 'round'; for (let k = 0; k < 150; k++) { let x = r() * n, y = r() * n, a = r() * 6.28; c.strokeStyle = `rgba(70,40,30,${0.18 + r() * 0.2})`; c.lineWidth = 1 + r() * 1.6; c.beginPath(); c.moveTo(x, y); for (let j = 0; j < 7; j++) { a += (r() - 0.5) * 1.3; x += Math.cos(a) * (10 + r() * 22); y += Math.sin(a) * (10 + r() * 22); c.lineTo(x, y); } c.stroke(); }
    for (let k = 0; k < 900; k++) { const x = r() * n, y = r() * n, s2 = 1.5 + r() * 4; c.fillStyle = r() > 0.5 ? `rgba(255,240,220,${0.10 + r() * 0.14})` : `rgba(60,30,20,${0.10 + r() * 0.16})`; c.beginPath(); c.ellipse(x, y, s2, s2 * (0.6 + r() * 0.4), r() * 3, 0, 6.28); c.fill(); } });
  R3.ground.magFilter = T3.LinearFilter; R3.ground.minFilter = T3.LinearMipmapLinearFilter; R3.ground.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  buildTerrain(); buildNodes(); buildDecor(); buildFx();
}
const mat = (col, emissive) => { const k = col + (emissive ? 'e' : ''); let m = R3.mats.get(k); if (!m) { m = emissive ? new T3.MeshBasicMaterial({ color: col }) : new T3.MeshLambertMaterial({ color: col, map: R3.grain }); R3.mats.set(k, m); } return m; };
function P(parent, geo, col, sx, sy, sz, x, y, z, opt) { const m = new T3.Mesh(R3.geos[geo], mat(col, opt && opt.e)); m.scale.set(sx, sy, sz); m.position.set(x, y, z); if (opt) { if (opt.rx) m.rotation.x = opt.rx; if (opt.ry) m.rotation.y = opt.ry; if (opt.rz) m.rotation.z = opt.rz; } const e = opt && opt.e; m.castShadow = !e; m.receiveShadow = !e; parent.add(m); return m; }
function seg(parent, ax, ay, az, bx, by, bz, r, col) { const m = new T3.Mesh(R3.geos.cyl6, mat(col)), d = new T3.Vector3(bx - ax, by - ay, bz - az), len = d.length(); m.scale.set(r, len, r); m.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2); m.quaternion.setFromUnitVectors(new T3.Vector3(0, 1, 0), d.normalize()); m.castShadow = true; parent.add(m); return m; }

/* ---------- terrain: a quarter-tile heightfield with baked colour (dirt, grass, worn paths, banded cliffs) and fake ambient occlusion ---------- */
function buildTerrain() {
  const K = 3, RW = MW * K + 1, pos = new Float32Array(RW * RW * 3), col = new Float32Array(RW * RW * 3), uv = new Float32Array(RW * RW * 2), hs = new Float32Array(RW * RW), ind = [];
  for (let vy = 0; vy < RW; vy++) for (let vx = 0; vx < RW; vx++) { const x = vx / K, y = vy / K, h0 = heightAt(x, y); hs[vy * RW + vx] = h0 > WATER_Y - 0.05 ? h0 + (vnoise(x * 1.7, y * 1.7) - 0.5) * 0.09 + (vnoise(x * 5, y * 5) - 0.5) * 0.03 : h0; }
  const hv = (x, y) => hs[clamp(y, 0, RW - 1) * RW + clamp(x, 0, RW - 1)], mix = (a, b, f) => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  for (let vy = 0; vy < RW; vy++) for (let vx = 0; vx < RW; vx++) {
    const i = vy * RW + vx, h = hs[i], x = vx / K, y = vy / K, tx = clamp(Math.floor(x - 0.001), 0, MW - 1), ty = clamp(Math.floor(y - 0.001), 0, MH - 1), ti = idx(tx, ty), v = M.tiles0[ti];
    pos[i * 3] = x; pos[i * 3 + 1] = h; pos[i * 3 + 2] = y; uv[i * 2] = x * 0.14; uv[i * 2 + 1] = y * 0.14;
    const n = vnoise(x * 0.09, y * 0.09), n2 = vnoise(x * 0.45 + 9, y * 0.45 + 3), n3 = vnoise(x * 1.6 + 2, y * 1.6), sl = Math.max(Math.abs(hv(vx + 2, vy) - hv(vx - 1, vy)), Math.abs(hv(vx, vy + 2) - hv(vx, vy - 1)));
    const avg = (hv(vx + 4, vy) + hv(vx - 4, vy) + hv(vx, vy + 4) + hv(vx, vy - 4)) / 4, ao = 1 - clamp((avg - h) * 0.42, 0, 0.45), rc = Math.hypot(x - CX, y - CY), an = Math.atan2(y - CY, x - CX);
    let c = mix([0.80, 0.53, 0.30], [0.68, 0.40, 0.23], n); c = [c[0] + (n2 - 0.5) * 0.08, c[1] + (n2 - 0.5) * 0.07, c[2] + (n2 - 0.5) * 0.05];
    const grass = clamp((vnoise(x * 0.16 + 31, y * 0.16 + 7) - 0.48) * 3.2 + (n3 - 0.5) * 0.5, 0, 1); c = mix(c, [0.46 + 0.08 * n3, 0.60 + 0.06 * n3, 0.22], grass * 0.85);
    const road = clamp(1 - Math.abs(rc - (innerR(an) + 6.5 + 1.5 * Math.sin(an * 5))) / (1.5 + n3), 0, 1); if (rc > 20) c = mix(c, [0.90, 0.72, 0.50], road * 0.6);
    if (M.h[ti] === TOP && v !== ROCK) c = mix(c, [0.86, 0.66, 0.40], 0.3);
    if (M.rampF[ti]) c = mix(c, [0.90, 0.72, 0.50], 0.7);
    if (v === TREE) c = mix(c, [0.36, 0.42, 0.18], 0.75);
    if (v === SAND || h < 0.03) c = mix(c, [0.93, 0.78, 0.55], clamp((0.25 - h) * 4, 0.35, 1));
    if ((sl > 0.5 && !M.rampF[ti]) || v === ROCK) { const band = 0.5 + 0.5 * Math.sin(h * 7 + n * 5 + n3), rk = mix([0.88, 0.66, 0.54], [0.60, 0.38, 0.32], band); c = mix(c, v === ROCK && sl < 0.3 ? mix(rk, [0.80, 0.60, 0.48], 0.6) : rk, clamp((sl - 0.3) * 3, v === ROCK ? 1 : 0, 1)); } // banded sandstone cliffs
    if (h < WATER_Y) c = mix([0.36, 0.62, 0.60], [0.16, 0.36, 0.44], clamp((WATER_Y - h) * 1.6, 0, 1));
    const sink = clamp(1 - rc / 15, 0, 1); if (sink > 0 && h > WATER_Y) { const s2 = sink * sink; c = mix(c, [0.46 + 0.2 * n2, 0.10, 0.22], s2 * 0.92); }
    col[i * 3] = c[0] * ao; col[i * 3 + 1] = c[1] * ao; col[i * 3 + 2] = c[2] * ao;
  }
  for (let vy = 0; vy < RW - 1; vy++) for (let vx = 0; vx < RW - 1; vx++) { const a = vy * RW + vx, b = a + 1, c = a + RW, d = c + 1; if (Math.max(hs[a], hs[b], hs[c], hs[d]) > -1.25) ind.push(a, c, b, b, c, d); }
  const geo = new T3.BufferGeometry(); geo.setAttribute('position', new T3.BufferAttribute(pos, 3)); geo.setAttribute('color', new T3.BufferAttribute(col, 3)); geo.setAttribute('uv', new T3.BufferAttribute(uv, 2)); geo.setIndex(ind); geo.computeVertexNormals();
  const mesh = new T3.Mesh(geo, new T3.MeshLambertMaterial({ vertexColors: true, map: R3.ground })); mesh.receiveShadow = true; R3.scene.add(mesh);
  const floor = new T3.Mesh(new T3.PlaneGeometry(900, 900), new T3.MeshBasicMaterial({ color: 0x1c5a6a })); floor.rotation.x = -Math.PI / 2; floor.position.set(CX, -1.32, CY); R3.scene.add(floor);
  R3.waterTex = canvasTex(256, (c, n) => { c.fillStyle = '#2f93a0'; c.fillRect(0, 0, n, n); const r = mulberry32(8); for (let k = 0; k < 160; k++) { c.fillStyle = r() > 0.4 ? `rgba(255,${200 + r() * 40},${150 + r() * 60},${0.10 + r() * 0.2})` : `rgba(20,70,90,${0.12 + r() * 0.15})`; c.beginPath(); c.ellipse(r() * n, r() * n, 5 + r() * 16, 1 + r() * 1.5, 0, 0, 6.28); c.fill(); } }, 70);
  R3.waterTex.magFilter = T3.LinearFilter;
  R3.water = new T3.Mesh(new T3.PlaneGeometry(900, 900), new T3.MeshLambertMaterial({ color: 0xffffff, map: R3.waterTex, transparent: true, opacity: 0.8 })); R3.water.rotation.x = -Math.PI / 2; R3.water.position.set(CX, WATER_Y, CY); R3.water.receiveShadow = true; R3.scene.add(R3.water);
  // fog of war and the debug navigation overlay share one sheet that floats just above the ground
  const fpos = new Float32Array(HW * HW * 3), fuv = new Float32Array(HW * HW * 2), find = [];
  for (let vy = 0; vy < HW; vy++) for (let vx = 0; vx < HW; vx++) { const i = vy * HW + vx; fpos[i * 3] = vx / 2; fpos[i * 3 + 1] = Math.max(HV[i], WATER_Y) + 0.5; fpos[i * 3 + 2] = vy / 2; fuv[i * 2] = vx / 2 / MW; fuv[i * 2 + 1] = vy / 2 / MH; }
  for (let vy = 0; vy < HW - 1; vy++) for (let vx = 0; vx < HW - 1; vx++) { const a = vy * HW + vx; find.push(a, a + HW, a + 1, a + 1, a + HW, a + HW + 1); }
  const fg = new T3.BufferGeometry(); fg.setAttribute('position', new T3.BufferAttribute(fpos, 3)); fg.setAttribute('uv', new T3.BufferAttribute(fuv, 2)); fg.setIndex(find);
  R3.fogData = new Uint8Array(N * 4); R3.fogTex = new T3.DataTexture(R3.fogData, MW, MH, T3.RGBAFormat); R3.fogTex.magFilter = R3.fogTex.minFilter = T3.LinearFilter;
  R3.fogMesh = new T3.Mesh(fg, new T3.MeshBasicMaterial({ color: 0x160d18, transparent: true, alphaMap: R3.fogTex, depthWrite: false, fog: false })); R3.fogMesh.renderOrder = 2; R3.scene.add(R3.fogMesh);
  R3.navData = new Uint8Array(N * 4); R3.navTex = new T3.DataTexture(R3.navData, MW, MH, T3.RGBAFormat); R3.navTex.magFilter = R3.navTex.minFilter = T3.NearestFilter;
  R3.navMesh = new T3.Mesh(fg, new T3.MeshBasicMaterial({ map: R3.navTex, transparent: true, opacity: 0.55, depthWrite: false, fog: false })); R3.navMesh.renderOrder = 2; R3.navMesh.visible = false; R3.navMesh.position.y = -0.35; R3.scene.add(R3.navMesh);
}
/* ---------- resource nodes: alien plants and lumen crystals, instanced ---------- */
function buildNodes() {
  const trees = M.nodes.filter(i => M.tiles0[i] === TREE), crys = M.nodes.filter(i => M.tiles0[i] === CRYSTAL), nt = trees.length, nc = crys.length * 3;
  const stalk = new T3.CylinderGeometry(0.09, 0.16, 0.9, 5); stalk.translate(0, 0.45, 0);
  const c1 = new T3.ConeGeometry(0.72, 1.05, 9); c1.translate(0, 1.05, 0);
  const c2 = new T3.ConeGeometry(0.56, 0.95, 9); c2.translate(0, 1.65, 0);
  const c3 = new T3.ConeGeometry(0.38, 0.9, 9); c3.translate(0, 2.25, 0);
  const bulb = new T3.SphereGeometry(0.11, 8, 6); bulb.translate(0, 2.78, 0);
  const shard = new T3.OctahedronGeometry(0.5); shard.scale(0.5, 1.5, 0.5); shard.translate(0, 0.6, 0);
  const mk = (geo, m, n) => { const o = new T3.InstancedMesh(geo, m, n); o.castShadow = true; o.receiveShadow = true; R3.scene.add(o); return o; };
  const leaf = () => new T3.MeshLambertMaterial({ color: 0xffffff, map: R3.grain });
  R3.tree = [mk(stalk, new T3.MeshLambertMaterial({ color: 0x5a3a2a }), nt), mk(c1, leaf(), nt), mk(c2, leaf(), nt), mk(c3, leaf(), nt), mk(bulb, new T3.MeshBasicMaterial({ color: 0xffffff }), nt)];
  R3.tree[4].castShadow = false;
  R3.crys = mk(shard, new T3.MeshBasicMaterial({ color: 0xffffff }), nc); R3.crys.castShadow = false;
  R3.nodeInst = new Int32Array(N).fill(-1); R3.nodeMat = []; R3.nodeCol = []; R3.nodeState = new Int8Array(M.nodes.length).fill(-1); R3.nodeKind = [];
  const d = new T3.Object3D(); let ti = 0, ci = 0;
  M.nodes.forEach((tile, k) => { const x = tile % MW, y = (tile / MW) | 0; R3.nodeInst[tile] = k;
    if (M.tiles0[tile] === TREE) {
      d.position.set(x + 0.5 + (hash2(x, y) - 0.5) * 0.5, heightAt(x + .5, y + .5), y + 0.5 + (hash2(y, x) - 0.5) * 0.5); const s = 0.8 + hash2(x * 3, y * 7) * 0.45; d.scale.set(s, s * (0.9 + hash2(x * 5, y) * 0.4), s); d.rotation.set(0, hash2(x, y * 3) * 6.28, 0); d.updateMatrix();
      const v = hash2(x * 11, y * 13); R3.nodeMat.push([d.matrix.clone()]); R3.nodeKind.push([0, ti++]); const au = hash2(x * 17, y * 29) < 0.16, gold = hash2(x * 5, y * 41) < 0.5;
      R3.nodeCol.push(au ? (gold ? [new T3.Color(0.78, 0.48, 0.12), new T3.Color(0.92, 0.62, 0.16), new T3.Color(1.0, 0.78, 0.24), new T3.Color(1, 0.9, 0.6)] : [new T3.Color(0.70, 0.26, 0.16), new T3.Color(0.86, 0.36, 0.20), new T3.Color(0.98, 0.50, 0.28), new T3.Color(1, 0.8, 0.6)]) : [new T3.Color(0.26 + 0.08 * v, 0.50 + 0.10 * v, 0.13), new T3.Color(0.36 + 0.08 * v, 0.63 + 0.10 * v, 0.15), new T3.Color(0.50 + 0.10 * v, 0.76 + 0.08 * v, 0.20), new T3.Color(1, 0.84, 0.42)]);
    } else {
      const ms = [], r = mulberry32(tile); for (let j = 0; j < 3; j++) { d.position.set(x + 0.2 + r() * 0.6, heightAt(x + .5, y + .5) - 0.1, y + 0.2 + r() * 0.6); const s = 0.7 + r() * 0.9; d.scale.set(s, s * (0.8 + r() * 0.8), s); d.rotation.set((r() - 0.5) * 0.7, r() * 6.28, (r() - 0.5) * 0.7); d.updateMatrix(); ms.push(d.matrix.clone()); }
      R3.nodeMat.push(ms); R3.nodeKind.push([1, ci]); ci += 3; R3.nodeCol.push([new T3.Color(0.30, 0.92, 0.86)]);
    } });
  // soft additive halos: lumen crystals and the Sink read as light sources
  R3.glowTex = canvasTex(64, (c, n) => { const g = c.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.35)'); g.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = g; c.fillRect(0, 0, n, n); }); R3.glowTex.magFilter = T3.LinearFilter;
  const gp = new Float32Array(crys.length * 3); R3.glowIdx = new Int32Array(N).fill(-1);
  crys.forEach((tile, k) => { const x = tile % MW, y = (tile / MW) | 0; gp[k * 3] = x + .5; gp[k * 3 + 1] = heightAt(x + .5, y + .5) + 0.9; gp[k * 3 + 2] = y + .5; R3.glowIdx[tile] = k; });
  const gg = new T3.BufferGeometry(); gg.setAttribute('position', new T3.BufferAttribute(gp, 3));
  R3.glow = new T3.Points(gg, new T3.PointsMaterial({ map: R3.glowTex, color: 0x4fe8d8, size: 5.5, transparent: true, opacity: 0.55, blending: T3.AdditiveBlending, depthWrite: false })); R3.glow.frustumCulled = false; R3.glow.renderOrder = 4; R3.scene.add(R3.glow);
  const sg = new T3.BufferGeometry(); sg.setAttribute('position', new T3.BufferAttribute(new Float32Array([CX, heightAt(CX, CY) + 3, CY, CX, heightAt(CX, CY) + 1, CY]), 3));
  R3.sinkHalo = new T3.Points(sg, new T3.PointsMaterial({ map: R3.glowTex, color: 0xff4f86, size: 26, transparent: true, opacity: 0.5, blending: T3.AdditiveBlending, depthWrite: false })); R3.sinkHalo.renderOrder = 4; R3.scene.add(R3.sinkHalo);
  nodesReset();
}
const ZERO_M = T3 ? new T3.Matrix4().makeScale(0, 0, 0) : null, DIMC = T3 ? new T3.Color() : null;
/* state: 0 hidden (unexplored), 1 dimmed (explored), 2 lit (visible), -2 gone */
function setNode(k, st) {
  if (R3.nodeState[k] === st) return; R3.nodeState[k] = st; const [kind, i] = R3.nodeKind[k], ms = R3.nodeMat[k], c = R3.nodeCol[k], f = st === 2 ? 1 : 0.42, show = st > 0;
  if (kind === 0) { for (const t of R3.tree) t.setMatrixAt(i, show ? ms[0] : ZERO_M); if (show) for (let j = 0; j < 4; j++) R3.tree[j + 1].setColorAt(i, DIMC.copy(c[j]).multiplyScalar(f)); R3.treeDirty = true; }
  else { for (let j = 0; j < 3; j++) { R3.crys.setMatrixAt(i + j, show ? ms[j] : ZERO_M); if (show) R3.crys.setColorAt(i + j, DIMC.copy(c[0]).multiplyScalar(f * (0.8 + j * 0.12))); } R3.crysDirty = true; }
}
function flushNodes() {
  if (R3.treeDirty) { for (const t of R3.tree) { t.instanceMatrix.needsUpdate = true; if (t.instanceColor) t.instanceColor.needsUpdate = true; } R3.treeDirty = false; }
  if (R3.crysDirty) { R3.crys.instanceMatrix.needsUpdate = true; if (R3.crys.instanceColor) R3.crys.instanceColor.needsUpdate = true; R3.crysDirty = false; }
}
function nodesReset() { if (R3.glow) { const pa = R3.glow.geometry.attributes.position; for (let i = 0; i < N; i++) if (R3.glowIdx[i] >= 0) pa.setY(R3.glowIdx[i], heightAt((i % MW) + .5, ((i / MW) | 0) + .5) + 0.9); pa.needsUpdate = true; } if (R3.ok && R3.tree) { R3.nodeState.fill(-1); M.nodes.forEach((t, k) => setNode(k, 2)); flushNodes(); } if (R3.miniBase) paintMiniBase(); }
function nodeGone(i, loud) {
  const x = i % MW, y = (i / MW) | 0;
  if (R3.ok && R3.tree) { const k = R3.nodeInst[i]; if (k >= 0) { const kind = R3.nodeKind[k][0]; R3.nodeState[k] = -1; setNode(k, 0); R3.nodeState[k] = -2; flushNodes(); if (loud && G && canSee(x + .5, y + .5)) { burst(x + .5, y + .5, kind ? '#5ef2e0' : '#4f9a78', 9, 3, 1.2); sfx('thud', x + .5, y + .5); } } }
  if (R3.glow && R3.glowIdx[i] >= 0) { R3.glow.geometry.attributes.position.setY(R3.glowIdx[i], -99); R3.glow.geometry.attributes.position.needsUpdate = true; }
  if (R3.miniBase) { const g = R3.miniBase.getContext('2d'); g.fillStyle = M.h[i] === TOP ? '#dba968' : '#c08552'; g.fillRect(x, y, 1, 1); }
}
function buildDecor() {
  const g = new T3.Group(); g.position.set(CX, heightAt(CX, CY), CY); const r = mulberry32(77);
  for (let k = 0; k < 9; k++) { const a = r() * 6.28, d = k ? 0.4 + r() * 1.2 : 0; P(g, 'octa', k % 2 ? 0xff7ad1 : 0xff3d74, 0.35 + r() * 0.35, k ? 1.4 + r() * 2.2 : 4.6, 0.35 + r() * 0.35, Math.cos(a) * d, k ? 0.9 : 2.2, Math.sin(a) * d, { e: 1, rz: (r() - 0.5) * 0.5, rx: (r() - 0.5) * 0.5 }); }
  for (let k = 0; k < 8; k++) { const a = k / 8 * 6.28 + 0.2, d = 7.2; const p = P(g, 'box', 0x3a2430, 0.8, 2.6 + (k % 3) * 0.8, 0.8, Math.cos(a) * d, 1.3, Math.sin(a) * d, { ry: a, rz: 0.08 }); P(g, 'box', 0xff3d74, 0.82, 0.12, 0.82, p.position.x, 2.2, p.position.z, { e: 1, ry: a }); }
  R3.scene.add(g); R3.sink = g;
  // scattered flora and stones (all low enough to sit under the fog sheet)
  const sc = (geo, n, mat2) => { const o = new T3.InstancedMesh(geo, mat2 || new T3.MeshLambertMaterial({ color: 0xffffff }), n); o.instanceColor = new T3.InstancedBufferAttribute(new Float32Array(n * 3), 3); o.count = 0; o.receiveShadow = true; R3.scene.add(o); return o; }, d = new T3.Object3D(), cc = new T3.Color();
  const put = (o, x, y, s, sy, col, rx) => { if (o.count >= o.instanceMatrix.count) return; d.position.set(x, heightAt(x, y) - 0.02, y); d.scale.set(s, sy, s); d.rotation.set(rx || 0, r() * 6.28, 0); d.updateMatrix(); o.setMatrixAt(o.count, d.matrix); o.setColorAt(o.count, cc.set(col)); o.count++; };
  const tuft = new T3.ConeGeometry(0.5, 1, 5); tuft.translate(0, 0.5, 0); const cap = new T3.SphereGeometry(1, 10, 5, 0, 6.283, 0, 1.57), stem = new T3.CylinderGeometry(0.3, 0.4, 1, 6); stem.translate(0, 0.5, 0);
  const grass = sc(tuft, 5000), flower = sc(new T3.SphereGeometry(1, 7, 5), 1600, new T3.MeshBasicMaterial({ color: 0xffffff })), peb = sc(new T3.DodecahedronGeometry(1), 900), mcap = sc(cap, 400), mstem = sc(stem, 400), lily = sc(new T3.CircleGeometry(1, 12), 220);
  peb.castShadow = true; mcap.castShadow = true;
  const FL = [0xff7ab0, 0xfff2d8, 0xffd24a, 0xc79bff, 0xff9a5a];
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) { const v = M.tiles0[idx(x, y)]; if (v !== GROUND && v !== SAND) continue; const gr = vnoise(x * 0.16 + 31, y * 0.16 + 7), rc = Math.hypot(x - CX, y - CY); if (rc < 16) continue;
    if (v === GROUND && gr > 0.5) for (let j = 0; j < 3; j++) put(grass, x + r(), y + r(), 0.16 + r() * 0.12, 0.28 + r() * 0.2, r() > 0.5 ? 0x7fae3a : 0x9cc24a);
    if (v === GROUND && gr > 0.56 && r() < 0.35) put(flower, x + r(), y + r(), 0.07 + r() * 0.05, 0.05, FL[(r() * FL.length) | 0]);
    if (r() < 0.07) put(peb, x + r(), y + r(), 0.12 + r() * 0.2, 0.1 + r() * 0.12, r() > 0.5 ? 0xb98a70 : 0x8a5e4e, r());
    let nearTree = false; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (inMap(x + dx, y + dy) && M.tiles0[idx(x + dx, y + dy)] === TREE) nearTree = true;
    if (nearTree && r() < 0.16) { const mx = x + 0.2 + r() * 0.6, my = y + 0.2 + r() * 0.6, ms = 0.12 + r() * 0.1; put(mstem, mx, my, ms * 0.5, ms * 1.6, 0xfff0dc); d.position.set(mx, heightAt(mx, my) + ms * 1.5, my); d.scale.set(ms, ms * 0.7, ms); d.rotation.set(0, 0, 0); d.updateMatrix(); mcap.setMatrixAt(mcap.count, d.matrix); mcap.setColorAt(mcap.count, cc.set(r() > 0.3 ? 0xe23b3b : 0xff9a3c)); mcap.count++; } }
  for (const pd of M.ponds) for (let j = 0; j < 22; j++) { const a = r() * 6.28, q = r() * pd.r * 0.85, x = pd.x + Math.cos(a) * q, y = pd.y + Math.sin(a) * q; if (heightAt(x, y) > WATER_Y - 0.15) continue; d.position.set(x, WATER_Y + 0.02, y); const s = 0.18 + r() * 0.2; d.scale.set(s, s, s); d.rotation.set(-Math.PI / 2, 0, r() * 6.28); d.updateMatrix(); lily.setMatrixAt(lily.count, d.matrix); lily.setColorAt(lily.count, cc.set(r() > 0.25 ? 0x5fa83a : 0xff8ac0)); lily.count++; }
  for (const o of [grass, flower, peb, mcap, mstem, lily]) { o.instanceMatrix.needsUpdate = true; if (o.instanceColor) o.instanceColor.needsUpdate = true; }
  // way-stones flank each gap between chambers
  M.marks.forEach((gp, k) => { { const sd = k % 2 ? 1 : -1, x = gp.x, y = gp.y, st = new T3.Group(); st.position.set(x, heightAt(x, y), y); st.rotation.y = r() * 6.28; P(st, 'box', 0x9a6a58, 0.9, 4.4, 0.7, 0, 2.1, 0, { rz: 0.06 * sd }); P(st, 'box', 0xb98470, 1.1, 0.5, 0.9, 0, 4.4, 0); P(st, 'box', 0xffb648, 0.14, 2.2, 0.72, 0.42, 2.4, 0, { e: 1 }); R3.scene.add(st); } });
  const glow = new T3.PointLight(0xff3d74, 1.2, 34); glow.position.set(CX, 5, CY); R3.scene.add(glow); R3.sinkGlow = glow;
}

/* ---------- structure models: one layout per type, three faction kits ---------- */
const PAL = { human: { a: 0x858c95, b: 0x565e6a, c: 0x2e343d, glow: 0xff9a3c, lite: 0x5ef2ff }, alien: { a: 0x5a8572, b: 0x3a5a52, c: 0x263c3e, glow: 0x9dff6a, lite: 0xb07cff }, robot: { a: 0xe6ebf0, b: 0x9aa6b4, c: 0x3c4450, glow: 0x5ef2ff, lite: 0x5ef2ff } };
function makeStruct(type, fac, col) {
  const g = new T3.Group(), u = g.userData, p = PAL[fac], H = fac === 'human', A = fac === 'alien'; u.type = type; u.spin = []; u.pulse = [];
  const pad = () => { if (H) { P(g, 'box', p.c, 1.96, 0.24, 1.96, 0, 0.12, 0); for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) P(g, 'box', p.b, 0.3, 0.34, 0.3, x * 0.84, 0.17, z * 0.84); }
    else if (A) { P(g, 'sph', p.c, 1.08, 0.3, 1.08, 0, 0.05, 0); for (let k = 0; k < 5; k++) P(g, 'sph', p.b, 0.3, 0.2, 0.3, Math.cos(k * 1.26) * 0.92, 0.1, Math.sin(k * 1.26) * 0.92); }
    else { P(g, 'cyl6', p.c, 1.08, 0.2, 1.08, 0, 0.1, 0); P(g, 'torus', p.glow, 1.0, 1.0, 1.0, 0, 0.21, 0, { e: 1, rx: Math.PI / 2 }); } };
  const team = y => P(g, H ? 'box' : A ? 'sph' : 'cyl6', col, 0.24, 0.24, 0.24, 0.78, y, 0.78);
  if (type === 'wall') {
    if (H) { P(g, 'box', p.a, 1.92, 1.5, 1.92, 0, 0.75, 0); P(g, 'box', p.b, 1.98, 0.22, 1.98, 0, 1.55, 0); for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) P(g, 'box', p.c, 0.34, 1.9, 0.34, x * 0.82, 0.95, z * 0.82); P(g, 'box', p.glow, 1.94, 0.1, 1.94, 0, 1.2, 0, { e: 1 }); P(g, 'box', col, 1.95, 0.2, 1.95, 0, 0.55, 0); }
    else if (A) { for (const [x, z, s] of [[-0.45, -0.4, 1], [0.5, -0.35, 0.85], [0, 0.45, 1.1], [-0.55, 0.5, 0.7], [0.6, 0.55, 0.75]]) { P(g, 'sph', p.a, 0.62 * s, 1.0 * s, 0.62 * s, x, 0.8 * s, z); P(g, 'cone', p.c, 0.16, 0.7, 0.16, x, 1.75 * s, z); } P(g, 'sph', p.glow, 0.2, 0.2, 0.2, 0, 1.2, -0.1, { e: 1 }); P(g, 'sph', col, 0.3, 0.3, 0.3, 0.1, 1.95, 0.3); }
    else { for (const x of [-0.8, 0.8]) for (const z of [-0.8, 0.8]) P(g, 'cyl6', p.c, 0.2, 1.8, 0.2, x, 0.9, z); P(g, 'box', p.a, 1.7, 1.3, 1.7, 0, 0.8, 0); P(g, 'box', p.glow, 1.74, 0.08, 1.74, 0, 1.2, 0, { e: 1 }); P(g, 'box', p.glow, 1.74, 0.08, 1.74, 0, 0.5, 0, { e: 1 }); P(g, 'box', col, 1.3, 0.14, 1.3, 0, 1.52, 0); }
  } else if (type === 'pulse') {
    pad(); team(0.4); P(g, H ? 'box' : 'cyl', p.b, H ? 0.7 : 0.34, 0.7, H ? 0.7 : 0.34, 0, 0.6, 0);
    const h = u.head = new T3.Group(); h.position.y = 1.3; g.add(h);
    if (H) { P(h, 'box', p.a, 0.9, 0.5, 0.8, 0, 0, 0); P(h, 'box', col, 0.4, 0.14, 0.82, -0.2, 0.3, 0); for (const z of [-0.2, 0.2]) P(h, 'cyl', p.c, 0.09, 1.0, 0.09, 0.7, 0, z, { rz: Math.PI / 2 }); P(h, 'box', p.glow, 0.1, 0.2, 0.5, 0.46, 0, 0, { e: 1 }); }
    else if (A) { P(h, 'sph', p.a, 0.5, 0.42, 0.5, 0, 0, 0); P(h, 'sph', p.glow, 0.26, 0.26, 0.26, 0.3, 0.05, 0, { e: 1 }); for (const z of [-0.25, 0, 0.25]) P(h, 'cone', p.c, 0.08, 0.8, 0.08, 0.6, 0.1, z, { rz: -Math.PI / 2 }); P(h, 'sph', col, 0.2, 0.16, 0.2, -0.2, 0.36, 0); }
    else { P(h, 'sph', p.a, 0.46, 0.46, 0.46, 0, 0, 0); P(h, 'torus', p.c, 0.52, 0.52, 0.8, 0, 0, 0, { ry: Math.PI / 2 }); P(h, 'cyl', p.c, 0.12, 0.8, 0.12, 0.6, 0, 0, { rz: Math.PI / 2 }); P(h, 'sph', p.glow, 0.14, 0.14, 0.14, 1.0, 0, 0, { e: 1 }); P(h, 'cyl', col, 0.3, 0.1, 0.3, 0, 0.44, 0); }
  } else if (type === 'lance') {
    pad(); team(0.4);
    if (H) { for (const [x, z] of [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]]) seg(g, x, 0.2, z, x * 0.4, 2.3, z * 0.4, 0.07, p.b); P(g, 'box', p.c, 0.6, 0.2, 0.6, 0, 1.2, 0); } else P(g, A ? 'cone' : 'cyl6', A ? p.a : p.b, A ? 0.6 : 0.26, 2.2, A ? 0.6 : 0.26, 0, 1.3, 0);
    const h = u.head = new T3.Group(); h.position.y = 2.6; g.add(h);
    if (H) { P(h, 'box', p.a, 0.8, 0.5, 0.6, -0.1, 0, 0); P(h, 'box', p.c, 2.0, 0.2, 0.24, 0.9, 0.05, 0); P(h, 'box', col, 0.3, 0.2, 0.62, -0.4, 0.3, 0); }
    else if (A) { P(h, 'sph', p.b, 0.5, 0.5, 0.5, 0, 0, 0); P(h, 'cone', p.c, 0.2, 1.9, 0.2, 0.95, 0, 0, { rz: -Math.PI / 2 }); P(h, 'sph', col, 0.2, 0.2, 0.2, -0.3, 0.4, 0); }
    else { P(h, 'octa', p.a, 0.5, 0.5, 0.5, 0, 0, 0); for (const z of [-0.18, 0.18]) P(h, 'box', p.b, 1.9, 0.08, 0.08, 0.95, 0, z); P(h, 'cyl', col, 0.2, 0.1, 0.2, 0, 0.5, 0); }
    u.core = P(h, 'cyl', A ? p.glow : p.lite, 0.06, 1.9, 0.06, 0.95, 0.05, 0, { rz: Math.PI / 2, e: 1 });
  } else if (type === 'stasis') {
    pad(); team(0.4); P(g, A ? 'cone' : 'cyl', p.b, A ? 0.4 : 0.16, 1.2, A ? 0.4 : 0.16, 0, 0.85, 0);
    if (A) for (let k = 0; k < 4; k++) seg(g, Math.cos(k * 1.57) * 0.7, 0.2, Math.sin(k * 1.57) * 0.7, Math.cos(k * 1.57) * 0.55, 1.9, Math.sin(k * 1.57) * 0.55, 0.06, p.c);
    u.crystal = P(g, A ? 'sph' : 'octa', 0xb28cff, 0.42, A ? 0.42 : 0.66, 0.42, 0, 2.15, 0, { e: 1 }); u.halo = P(g, 'torus', H ? p.glow : 0xb28cff, 0.8, 0.8, 0.8, 0, 2.15, 0, { e: 1, rx: Math.PI / 2 }); P(g, 'sph', col, 0.16, 0.16, 0.16, 0, 1.5, 0);
  } else if (type === 'mend') {
    pad(); team(0.4); P(g, 'cyl', p.b, 0.1, 1.4, 0.14, 0, 0.95, 0);
    const o = new T3.Group(); o.position.y = 2.0; g.add(o); u.spin.push([o, 1.2]); u.pulse.push(o);
    if (H) { P(o, 'dome', p.a, 0.6, 0.3, 0.6, 0, -0.1, 0, { rx: Math.PI }); P(o, 'box', 0x74f2a4, 0.8, 0.14, 0.14, 0, 0.12, 0, { e: 1 }); P(o, 'box', 0x74f2a4, 0.14, 0.14, 0.8, 0, 0.12, 0, { e: 1 }); }
    else if (A) { P(o, 'sph', p.a, 0.46, 0.56, 0.46, 0, 0, 0); P(o, 'sph', 0x74f2a4, 0.3, 0.3, 0.3, 0, 0.2, 0, { e: 1 }); }
    else { P(o, 'torus', p.a, 0.5, 0.5, 1.6, 0, 0, 0, { rx: Math.PI / 2 }); P(o, 'octa', 0x74f2a4, 0.22, 0.3, 0.22, 0, 0, 0, { e: 1 }); }
    P(g, 'sph', col, 0.16, 0.16, 0.16, 0, 1.55, 0);
  } else if (type === 'bay') {
    if (H) { P(g, 'box', p.c, 1.96, 0.2, 1.96, 0, 0.1, 0); P(g, 'box', p.a, 1.5, 1.0, 1.3, -0.15, 0.7, -0.25); P(g, 'cyl', p.b, 0.66, 1.5, 0.66, -0.15, 1.2, -0.25, { rz: Math.PI / 2 }); P(g, 'box', p.c, 0.08, 0.7, 0.8, 0.62, 0.55, -0.25); P(g, 'box', p.glow, 0.5, 0.08, 0.08, -0.15, 1.5, 0.42, { e: 1 }); P(g, 'box', col, 1.54, 0.16, 1.34, -0.15, 0.3, -0.25); seg(g, 0.75, 0.2, 0.75, 0.75, 1.7, 0.75, 0.05, p.b); P(g, 'box', col, 0.4, 0.26, 0.05, 0.55, 1.55, 0.75); }
    else if (A) { P(g, 'sph', p.c, 1.05, 0.3, 1.05, 0, 0.05, 0); P(g, 'sph', p.a, 0.85, 1.05, 0.85, -0.1, 0.6, -0.1); for (const [x, y, z] of [[0.55, 0.6, 0.3], [-0.2, 0.9, 0.7], [0.3, 1.2, -0.5]]) P(g, 'sph', p.c, 0.24, 0.24, 0.24, x, y, z); P(g, 'sph', p.glow, 0.16, 0.16, 0.16, 0.62, 0.6, 0.36, { e: 1 }); P(g, 'cone', p.b, 0.2, 0.8, 0.2, -0.1, 1.9, -0.1); P(g, 'sph', col, 0.26, 0.26, 0.26, -0.1, 2.3, -0.1); }
    else { P(g, 'cyl6', p.c, 1.08, 0.2, 1.08, 0, 0.1, 0); P(g, 'cyl6', p.b, 0.8, 0.5, 0.8, 0, 0.45, 0); P(g, 'dome', p.a, 0.72, 0.72, 0.72, 0, 0.7, 0); P(g, 'torus', p.glow, 0.82, 0.82, 0.82, 0, 0.72, 0, { e: 1, rx: Math.PI / 2 }); const an = new T3.Group(); an.position.y = 1.6; g.add(an); P(an, 'box', p.c, 0.9, 0.05, 0.08, 0, 0, 0); P(an, 'box', col, 0.2, 0.12, 0.2, 0, 0.05, 0); u.spin.push([an, 3]); }
  } else {
    if (H) { P(g, 'box', p.c, 1.96, 0.2, 1.96, 0, 0.1, 0); P(g, 'box', p.a, 1.6, 1.2, 1.6, 0, 0.8, 0); P(g, 'box', col, 1.64, 0.16, 1.64, 0, 1.05, 0); P(g, 'cyl', p.b, 0.26, 1.5, 0.32, -0.45, 2.0, -0.45); P(g, 'cyl', p.b, 0.18, 1.1, 0.22, 0.3, 1.9, -0.5); u.glow = P(g, 'box', p.glow, 0.7, 0.5, 0.06, 0.2, 0.7, 0.82, { e: 1 }); P(g, 'cyl', p.glow, 0.2, 0.06, 0.2, -0.45, 2.76, -0.45, { e: 1 }); }
    else if (A) { P(g, 'sph', p.c, 1.05, 0.3, 1.05, 0, 0.05, 0); P(g, 'sph', p.a, 0.9, 0.85, 0.9, 0, 0.8, 0); for (let k = 0; k < 5; k++) seg(g, Math.cos(k * 1.26) * 0.85, 0.3, Math.sin(k * 1.26) * 0.85, Math.cos(k * 1.26 + 0.5) * 0.3, 1.7, Math.sin(k * 1.26 + 0.5) * 0.3, 0.07, p.lite); u.glow = P(g, 'sph', p.lite, 0.36, 0.36, 0.36, 0, 1.75, 0, { e: 1 }); P(g, 'sph', col, 0.22, 0.22, 0.22, 0.7, 0.9, 0.5); }
    else { P(g, 'cyl6', p.c, 1.08, 0.2, 1.08, 0, 0.1, 0); P(g, 'cyl', p.a, 0.7, 1.5, 0.7, 0, 0.95, 0); u.glow = P(g, 'cyl', p.glow, 0.72, 0.3, 0.72, 0, 0.95, 0, { e: 1 }); P(g, 'cyl', p.c, 0.8, 0.14, 0.8, 0, 1.75, 0); for (let k = 0; k < 3; k++) P(g, 'box', p.b, 0.16, 1.9, 0.16, Math.cos(k * 2.09) * 0.82, 0.95, Math.sin(k * 2.09) * 0.82); P(g, 'cyl6', col, 0.3, 0.2, 0.3, 0, 1.92, 0); }
  }
  u.pips = [0, 1].map(k => { const m = P(g, 'box', 0xffd27a, 0.2, 0.2, 0.2, -0.25 + k * 0.5, 0.36, 1.0, { e: 1 }); m.visible = false; return m; });
  return g;
}
/* ---------- unit models ---------- */
const corrupt = c => { const o = new T3.Color(c); return new T3.Color(o.r * 0.45 + 0.12, o.g * 0.22, o.b * 0.28).getHex(); };
function makeBuilder(fac, col, husk) {
  const g = new T3.Group(), u = g.userData, p0 = PAL[fac], p = husk ? { a: corrupt(p0.a), b: corrupt(p0.b), c: corrupt(p0.c), glow: 0xff3d74, lite: 0xff3d74 } : p0, tc = husk ? 0x7a1028 : col; u.legs = [];
  const leg = (z, c) => { const lg = new T3.Group(); lg.position.set(0, 0.42, z); g.add(lg); P(lg, 'box', c, 0.18, 0.44, 0.16, 0, -0.2, 0); u.legs.push({ lg, ph: z > 0 ? 0 : Math.PI }); };
  if (fac === 'human') { leg(-0.15, p.c); leg(0.15, p.c); P(g, 'box', p.a, 0.42, 0.5, 0.52, 0, 0.7, 0); P(g, 'box', tc, 0.26, 0.44, 0.44, -0.3, 0.74, 0); for (const z of [-0.33, 0.33]) { P(g, 'box', p.glow, 0.26, 0.14, 0.2, 0, 0.94, z, { e: husk }); P(g, 'box', p.b, 0.14, 0.4, 0.14, 0.04, 0.62, z * 1.05); }
    P(g, 'sph', p.b, 0.22, 0.22, 0.22, 0, 1.15, 0); P(g, 'box', p.lite, 0.1, 0.1, 0.3, 0.18, 1.15, 0, { e: 1 }); seg(g, -0.3, 0.9, 0.15, -0.34, 1.5, 0.15, 0.02, p.c); }
  else if (fac === 'alien') { leg(-0.12, p.b); leg(0.12, p.b); P(g, 'sph', p.a, 0.26, 0.34, 0.24, 0, 0.62, 0); P(g, 'sph', p.a, 0.34, 0.3, 0.3, 0.06, 1.08, 0); for (const z of [-0.14, 0.14]) { P(g, 'sph', 0x101418, 0.1, 0.13, 0.08, 0.3, 1.1, z); seg(g, 0, 1.3, z, -0.12, 1.75, z * 1.8, 0.02, p.b); P(g, 'sph', p.glow, 0.06, 0.06, 0.06, -0.12, 1.77, z * 1.8, { e: 1 }); }
    P(g, 'cone', p.b, 0.12, 0.6, 0.12, -0.4, 0.5, 0, { rz: 1.2 }); P(g, 'sph', tc, 0.2, 0.12, 0.26, -0.05, 0.86, 0); for (let k = 0; k < 3; k++) P(g, 'sph', p.lite, 0.05, 0.05, 0.05, -0.1 - k * 0.08, 0.7 + k * 0.1, 0.22, { e: 1 }); }
  else { leg(-0.16, p.c); leg(0.16, p.c); P(g, 'box', p.a, 0.46, 0.46, 0.5, 0, 0.72, 0); P(g, 'box', tc, 0.48, 0.12, 0.52, 0, 0.56, 0); P(g, 'box', p.b, 0.3, 0.26, 0.34, 0.04, 1.1, 0); P(g, 'sph', p.glow, 0.09, 0.09, 0.09, 0.2, 1.12, 0, { e: 1 }); seg(g, -0.05, 1.2, 0.1, -0.05, 1.6, 0.1, 0.015, p.c); P(g, 'sph', p.glow, 0.04, 0.04, 0.04, -0.05, 1.62, 0.1, { e: 1 }); for (const z of [-0.34, 0.34]) { seg(g, 0, 0.84, z * 0.8, 0.26, 0.6, z, 0.045, p.c); P(g, 'box', p.b, 0.12, 0.1, 0.12, 0.3, 0.56, z); } }
  if (husk) { for (let k = 0; k < 5; k++) P(g, 'cone4', 0xff3d74, 0.07, 0.4, 0.07, -0.25 + (k % 2) * 0.2, 1.0 + (k % 3) * 0.12, (k - 2) * 0.13, { e: 1, rz: 0.9 }); P(g, 'sph', 0xff3d74, 0.13, 0.13, 0.13, 0.14, 0.74, 0, { e: 1 }); }
  g.userData.base = husk ? 2.1 : 1.5; return g;
}
function makeWorker(fac, col) {
  const g = new T3.Group(), u = g.userData, p = PAL[fac];
  if (fac === 'human') { for (const z of [-0.24, 0.24]) P(g, 'box', p.c, 0.66, 0.2, 0.14, 0, 0.1, z); P(g, 'box', p.a, 0.56, 0.24, 0.4, 0, 0.32, 0); P(g, 'box', col, 0.24, 0.26, 0.36, 0.2, 0.52, 0); P(g, 'box', p.glow, 0.05, 0.08, 0.2, 0.33, 0.56, 0, { e: 1 }); P(g, 'box', p.b, 0.34, 0.1, 0.38, -0.14, 0.48, 0); }
  else if (fac === 'alien') { for (let k = 0; k < 4; k++) P(g, 'sph', k % 2 ? p.b : p.a, 0.2 - k * 0.02, 0.18, 0.22 - k * 0.02, 0.24 - k * 0.2, 0.2, 0); P(g, 'sph', col, 0.14, 0.1, 0.16, 0.04, 0.36, 0); for (const z of [-0.08, 0.08]) P(g, 'sph', p.glow, 0.04, 0.04, 0.04, 0.4, 0.26, z, { e: 1 }); u.hover = 0; }
  else { const b = new T3.Group(); b.position.y = 0.7; g.add(b); u.float = b; P(b, 'cyl', p.a, 0.3, 0.14, 0.3, 0, 0, 0); P(b, 'sph', p.glow, 0.12, 0.1, 0.12, 0, -0.08, 0, { e: 1 }); P(b, 'cyl', col, 0.16, 0.08, 0.16, 0, 0.11, 0); const rt = new T3.Group(); rt.position.y = 0.2; b.add(rt); P(rt, 'box', p.c, 0.8, 0.02, 0.07, 0, 0, 0); P(rt, 'box', p.c, 0.07, 0.02, 0.8, 0, 0, 0); u.rotor = rt; }
  u.load = P(u.float || g, 'octa', 0x5ef2e0, 0.14, 0.24, 0.14, -0.1, u.float ? -0.3 : 0.75, 0, { e: 1 });
  u.base = 1.25; return g;
}
function legs(g, u, n, pal, x0, span, y, reach, r) { for (let i = 0; i < n; i++) for (const sd of [-1, 1]) { const lg = new T3.Group(); lg.position.set(x0 - i * (span / n), 0, 0); g.add(lg); seg(lg, 0, y, sd * 0.3, 0.05, y + 0.55, sd * reach * 0.65, r, pal); seg(lg, 0.05, y + 0.55, sd * reach * 0.65, 0.1, 0, sd * reach, r * 0.8, pal); u.legs.push({ lg, ph: i * 1.6 + (sd > 0 ? 0 : Math.PI) }); } }
function makeTitan(tk) {
  const g = new T3.Group(), u = g.userData; u.legs = []; u.orbit = []; u.pulse = [];
  if (tk === 'hollow') {
    u.ab = P(g, 'sph', 0x2a0d22, 1.0, 0.72, 0.85, -0.95, 0.95, 0); P(g, 'sph', 0x4a1638, 0.62, 0.52, 0.58, 0, 0.9, 0); P(g, 'sph', 0x2a0d22, 0.44, 0.4, 0.42, 0.8, 0.86, 0);
    for (let k = 0; k < 4; k++) P(g, 'cone4', 0x1a0814, 0.14, 0.6, 0.14, -0.5 - k * 0.35, 1.6 - k * 0.05, 0);
    for (const [x, y, z, s] of [[-1.1, 1.2, 0.45, 0.22], [-0.7, 1.3, -0.4, 0.18], [-1.4, 1.0, -0.3, 0.2], [-0.2, 1.25, 0.25, 0.14]]) u.pulse.push(P(g, 'sph', 0xff2a5c, s, s, s, x, y, z, { e: 1 }));
    for (const z of [-0.17, 0.17]) { P(g, 'sph', 0xff7aa0, 0.08, 0.08, 0.08, 1.14, 0.96, z, { e: 1 }); P(g, 'cone4', 0xe8d0da, 0.07, 0.45, 0.07, 1.22, 0.64, z * 0.8, { rz: -2.0 }); }
    legs(g, u, 4, 0x3a1230, 0.45, 1.2, 0.85, 1.6, 0.075); u.base = 1;
  } else if (tk === 'colossus') {
    for (const z of [-0.55, 0.55]) { const lg = new T3.Group(); lg.position.set(0, 1.5, z); g.add(lg); P(lg, 'box', 0x4a4f58, 0.5, 1.0, 0.5, 0, -0.5, 0); P(lg, 'box', 0x30343c, 0.62, 0.7, 0.62, 0.05, -1.15, 0); P(lg, 'box', 0x6b6252, 0.9, 0.22, 0.74, 0.12, -1.42, 0); u.legs.push({ lg, ph: z > 0 ? 0 : Math.PI, axis: 'z', amp: 0.35 }); }
    P(g, 'box', 0x3a3e46, 1.1, 0.5, 1.4, 0, 1.7, 0); P(g, 'box', 0x6b6252, 1.5, 1.4, 1.9, 0.05, 2.6, 0); P(g, 'box', 0x8a7a5a, 1.56, 0.3, 1.96, 0.05, 3.1, 0); u.pulse.push(P(g, 'sph', 0xffb648, 0.42, 0.42, 0.42, 0.72, 2.55, 0, { e: 1 })); P(g, 'torus', 0x30343c, 0.5, 0.5, 1.2, 0.74, 2.55, 0, { ry: Math.PI / 2 });
    for (const z of [-1.25, 1.25]) { P(g, 'cyl', 0x4a4f58, 0.46, 0.7, 0.46, 0, 3.0, z, { rx: Math.PI / 2 }); const arm = new T3.Group(); arm.position.set(0, 2.9, z); g.add(arm); P(arm, 'box', 0x5a5f68, 0.4, 1.3, 0.4, 0.1, -0.7, 0); P(arm, 'box', 0x30343c, 0.6, 0.6, 0.6, 0.2, -1.55, 0); u.legs.push({ lg: arm, ph: z > 0 ? Math.PI : 0, axis: 'z', amp: 0.25 }); }
    P(g, 'box', 0x30343c, 0.5, 0.4, 0.6, 0.3, 3.5, 0); P(g, 'box', 0xffb648, 0.1, 0.1, 0.44, 0.56, 3.52, 0, { e: 1 }); for (const z of [-0.6, 0.6]) P(g, 'cyl', 0x30343c, 0.1, 0.9, 0.1, -0.5, 3.6, z); u.base = 0.9; u.slowWalk = 1;
  } else if (tk === 'wraith') {
    const c = new T3.Group(); c.position.y = 1.9; g.add(c); u.core = c; P(c, 'octa', 0x9f8cff, 0.6, 1.1, 0.6, 0, 0, 0, { e: 1 }); P(c, 'octa', 0x2a1c5a, 0.85, 0.5, 0.85, 0, 0, 0); P(c, 'sph', 0xdfe0ff, 0.2, 0.2, 0.2, 0.42, 0.25, 0, { e: 1 });
    for (let k = 0; k < 7; k++) { const o = new T3.Group(); g.add(o); const m = P(o, k % 2 ? 'tetra' : 'octa', k % 3 ? 0x6a5cff : 0x4fd8ff, 0.2 + (k % 3) * 0.08, 0.5 + (k % 2) * 0.3, 0.2, 1.1 + (k % 3) * 0.3, 1.2 + (k % 4) * 0.45, 0, { e: k % 2 === 0 }); u.orbit.push([o, 0.6 + k * 0.17, k * 0.9, m]); }
    for (let k = 0; k < 4; k++) P(g, 'cone', 0x3a2c7a, 0.3 - k * 0.05, 0.7, 0.3 - k * 0.05, -0.15 * k, 1.0 - k * 0.28, 0, { rx: Math.PI }); u.base = 0.95; u.floaty = 1;
  } else {
    u.ab = P(g, 'sph', 0x3a4a2a, 1.25, 0.95, 1.05, -1.2, 1.1, 0); P(g, 'sph', 0x4f5a34, 0.7, 0.6, 0.66, 0.1, 1.0, 0); P(g, 'box', 0x3a4a2a, 0.9, 0.36, 0.5, 1.0, 0.95, 0); P(g, 'box', 0x2a3420, 0.7, 0.14, 0.44, 1.1, 0.7, 0);
    for (const z of [-0.2, 0.2]) { P(g, 'sph', 0xd8ff5a, 0.07, 0.07, 0.07, 1.2, 1.12, z, { e: 1 }); P(g, 'cone4', 0xe8e0c8, 0.06, 0.3, 0.06, 1.42, 0.74, z * 0.8, { rz: Math.PI }); }
    for (const [x, y, z, s] of [[-1.5, 1.85, 0.3, 0.26], [-1.0, 1.95, -0.35, 0.22], [-1.9, 1.5, -0.2, 0.24], [-0.6, 1.7, 0.4, 0.16], [-1.6, 1.3, 0.7, 0.18]]) u.pulse.push(P(g, 'sph', 0xb6ff3a, s, s, s, x, y, z, { e: 1 }));
    for (let k = 0; k < 5; k++) P(g, 'cone4', 0x2a3420, 0.16, 0.5, 0.16, 0.5 - k * 0.5, 1.6 + (k > 1 ? 0.3 : 0), 0);
    P(g, 'cone', 0x3a4a2a, 0.4, 1.4, 0.4, -2.6, 0.9, 0, { rz: Math.PI / 2 }); legs(g, u, 3, 0x2a3420, 0.5, 1.6, 0.9, 1.8, 0.1); u.base = 0.95;
  }
  return g;
}
function makeBrood() { const g = new T3.Group(), u = g.userData; u.legs = []; u.orbit = []; u.pulse = []; P(g, 'sph', 0x4f5a34, 0.3, 0.22, 0.26, -0.15, 0.3, 0); P(g, 'sph', 0x3a4a2a, 0.2, 0.18, 0.2, 0.22, 0.28, 0); P(g, 'sph', 0xb6ff3a, 0.1, 0.1, 0.1, -0.2, 0.46, 0, { e: 1 }); legs(g, u, 2, 0x2a3420, 0.2, 0.4, 0.25, 0.5, 0.03); u.base = 1.25; return g; }
function makeUnitModel(c) { const S = G.seats[c.seat]; return c.kind === 'builder' ? makeBuilder(S.fac, S.col) : c.kind === 'worker' ? makeWorker(S.fac, S.col) : c.kind === 'titan' ? makeTitan(c.tk) : c.kind === 'husk' ? makeBuilder(S.fac, S.col, true) : makeBrood(); }
const titanScale = a => Math.min(1.5, 0.84 + 0.03 * a.lvl);
const unitHeight = c => c.kind === 'titan' ? (c.tk === 'colossus' ? 4.2 : 3) * titanScale(c) : c.kind === 'husk' ? 3 : c.kind === 'builder' ? 2.3 : 1.3;
const unitRadius = c => c.kind === 'titan' ? 1.6 * titanScale(c) : c.kind === 'husk' ? 1.1 : c.kind === 'builder' ? 0.75 : 0.5;

/* ---------- effects ---------- */
function buildFx() {
  const s = R3.scene, basic = (col, op) => new T3.MeshBasicMaterial({ color: col, transparent: true, opacity: op === undefined ? 1 : op, depthWrite: false, side: T3.DoubleSide, fog: false });
  R3.basic = basic; R3.pMax = 800; R3.pPos = new Float32Array(R3.pMax * 3); R3.pCol = new Float32Array(R3.pMax * 3);
  const pg = new T3.BufferGeometry(); pg.setAttribute('position', new T3.BufferAttribute(R3.pPos, 3)); pg.setAttribute('color', new T3.BufferAttribute(R3.pCol, 3));
  R3.points = new T3.Points(pg, new T3.PointsMaterial({ size: 0.3, vertexColors: true, transparent: true, depthWrite: false })); R3.points.frustumCulled = false; s.add(R3.points);
  R3.pool = { beam: [], ring: [], shot: [], disc: [] };
  R3.get = (kind, k) => { const p = R3.pool[kind]; while (p.length <= k) { let m;
      if (kind === 'beam') m = new T3.Mesh(R3.geos.cyl6, basic(0xffffff)); else if (kind === 'ring') { m = new T3.Mesh(R3.geos.ring, basic(0xffffff)); m.rotation.x = -Math.PI / 2; } else if (kind === 'disc') { m = new T3.Mesh(R3.geos.disc, basic(0xffffff)); m.rotation.x = -Math.PI / 2; } else m = new T3.Mesh(R3.geos.sph, new T3.MeshBasicMaterial({ color: 0xffe1a6 }));
      m.renderOrder = 3; s.add(m); p.push(m); } const m = p[k]; m.visible = true; return m; };
  R3.used = { beam: 0, ring: 0, shot: 0, disc: 0 };
  R3.rangeRing = new T3.Mesh(new T3.RingGeometry(0.985, 1, 64), basic(0xffffff, 0.5)); R3.rangeRing.rotation.x = -Math.PI / 2; R3.rangeRing.renderOrder = 3; s.add(R3.rangeRing);
  R3.ghostMat = new T3.MeshBasicMaterial({ color: 0x74f2a4, transparent: true, opacity: 0.45, depthWrite: false }); R3.ghosts = {}; R3.jobs = [];
  R3.jobMat = new T3.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.3, depthWrite: false });
}
const V3 = T3 ? new T3.Vector3() : null, UPV = T3 ? new T3.Vector3(0, 1, 0) : null, DV = T3 ? new T3.Vector3() : null;
function beam3(x1, y1, h1, x2, y2, h2, col, w, op) {
  const m = R3.get('beam', R3.used.beam++), a = groundAt(x1, y1) + h1, b = groundAt(x2, y2) + h2;
  DV.set(x2 - x1, b - a, y2 - y1); const len = DV.length() || 0.01; m.scale.set(w, len, w); m.position.set((x1 + x2) / 2, (a + b) / 2, (y1 + y2) / 2); m.quaternion.setFromUnitVectors(UPV, DV.normalize()); m.material.color.set(col); m.material.opacity = op;
}
function ring3(x, y, r, col, op, lift) { const m = R3.get('ring', R3.used.ring++); m.position.set(x, groundAt(x, y) + (lift || 0.12), y); m.scale.set(r, r, 1); m.material.color.set(col); m.material.opacity = op; }
function disc3(x, y, r, col, op) { const m = R3.get('disc', R3.used.disc++); m.position.set(x, groundAt(x, y) + 0.1, y); m.scale.set(r, r, 1); m.material.color.set(col); m.material.opacity = op; }
function ghostFor(type, fac) { const k = type + fac; if (!R3.ghosts[k]) { const g = makeStruct(type, fac, '#ffffff'); g.traverse(o => { if (o.isMesh) { o.material = R3.ghostMat; o.castShadow = false; } }); g.visible = false; R3.scene.add(g); R3.ghosts[k] = g; } return R3.ghosts[k]; }

/* ---------- camera, projection, picking ---------- */
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 2); W = cv.clientWidth || 800; H = cv.clientHeight || 600; cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR); cam.zoom = clamp(cam.zoom, minZoom(), 80);
  if (R3.ok) { R3.renderer.setPixelRatio(W < 700 ? Math.min(DPR, 1.5) : DPR); R3.renderer.setSize(W, H, false); R3.camera.aspect = W / H; R3.camera.updateProjectionMatrix(); R3.renderer.shadowMap.enabled = W >= 700; }
}
function placeCamera() {
  const dist = (H / 2) / Math.tan(FOV * Math.PI / 360) / cam.zoom, ty = Math.max(0, heightAt(cam.x, cam.y)), c = R3.camera;
  c.position.set(cam.x, ty + Math.sin(PITCH) * dist, cam.y + Math.cos(PITCH) * dist); c.lookAt(cam.x, ty, cam.y); c.updateMatrixWorld(); c.matrixWorldInverse.copy(c.matrixWorld).invert();
  R3.sun.position.set(cam.x - 46, 38, cam.y + 20); R3.sun.target.position.set(cam.x, 0, cam.y); R3.sun.target.updateMatrixWorld();
  const sh = clamp(dist * 0.75, 30, 80), sc = R3.sun.shadow.camera; if (Math.abs(sc.right - sh) > 4) { sc.left = -sh; sc.right = sh; sc.top = sh; sc.bottom = -sh; sc.updateProjectionMatrix(); }
  R3.scene.fog.near = dist * 1.4; R3.scene.fog.far = dist * 3.4 + 70;
}
function w2s(wx, wy, h) { if (!R3.ok) return [W / 2, H / 2, 0]; V3.set(wx, groundAt(wx, wy) + (h || 0), wy).project(R3.camera); return [(V3.x + 1) / 2 * W, (1 - V3.y) / 2 * H, V3.z]; }
const unitShown = (c, team) => c.alive && (team < 0 || c.team === team || (canSee(c.x, c.y) && c.bBurrow <= 0));
/* Screen point -> ground point, plus the first unit or structure under the cursor (true raycast). */
function pickAt(sx, sy, noUnits) {
  if (!R3.ok) return { wx: CX, wy: CY, s: null, u: null, n: -1 };
  const c = R3.camera, o = c.position; V3.set(sx / W * 2 - 1, 1 - sy / H * 2, 0.5).unproject(c).sub(o).normalize();
  const dx = V3.x, dy = V3.y, dz = V3.z; if (dy > -0.05) return { wx: o.x + dx * 200, wy: o.z + dz * 200, s: null, u: null, n: -1 };
  let t = Math.max(0, (o.y - 6) / -dy), hit = null, hitT = 1e9, node = -1; const tEnd = (o.y + 1.5) / -dy;
  for (; t < tEnd; t += 0.12) {
    const x = o.x + dx * t, y = o.y + dy * t, z = o.z + dz * t, g = groundAt(x, z);
    if (G && x >= 0 && z >= 0 && x < MW && z < MH) { const ti = idx(x | 0, z | 0); if (!hit) { const s = G.struct[ti]; if (s && !s.dead && y <= g + DEFS[s.type].h + 0.2) { hit = s; hitT = t; } } if (node < 0 && !hit) { const v = M.tiles[ti]; if ((v === TREE && y <= g + 2.7) || ((v === CRYSTAL || v === VEIN) && y <= g + 1.8)) node = ti; } }
    if (y <= g) break;
  }
  let unit = null, ut = t + 0.5;
  if (G && !noUnits) { const team = App.phase === 'game' ? localTeam() : -1;
    for (const c of G.units) { if (!unitShown(c, team) || c.dormant) continue; const r = unitRadius(c) * 1.15 + 0.15, cy = groundAt(c.x, c.y) + unitHeight(c) * 0.42, px = c.x - o.x, py = cy - o.y, pz = c.y - o.z, tc = px * dx + py * dy + pz * dz; if (tc < 0 || tc > ut) continue;
      const qx = o.x + dx * tc - c.x, qy = (o.y + dy * tc - cy) * 0.6, qz = o.z + dz * tc - c.y; if (qx * qx + qy * qy + qz * qz < r * r) { ut = tc; unit = c; } } }
  if (unit && hit && hitT < ut - 1.2) unit = null;
  return { wx: o.x + dx * t, wy: o.z + dz * t, s: unit ? null : hit, u: unit, n: unit || hit ? -1 : node };
}
const s2w = (sx, sy) => { const p = pickAt(sx, sy, true); return [p.wx, p.wy]; };

/* ---------- vision: unexplored / explored / visible, for whoever is watching this screen ---------- */
const localSeat = () => (G && Local.seat >= 0 ? G.seats[Local.seat] : null);
const localTeam = () => { const S = localSeat(); return !S ? -1 : (S.role === 'titan' || S.dead ? 1 : 0); };
const localUnit = () => { const S = localSeat(); return S ? S.unit : null; };
const fog2d = document.createElement('canvas'); fog2d.width = MW; fog2d.height = MH; const fog2ctx = fog2d.getContext('2d'), fog2img = fog2ctx.createImageData(MW, MH), fogA = new Uint8Array(N);
function updVis() {
  const v = G.vis, ex = G.explored, team = App.phase === 'game' && !G.reveal ? localTeam() : -1;
  if (team !== G.visTeam) { G.visTeam = team; ex.fill(0); for (const s of G.structs) s._seen = false; }
  if (team < 0) { v.fill(1); ex.fill(1); } else {
    v.fill(0);
    const mark = (cx, cy, r) => { const r2 = r * r, x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(MW - 1, Math.ceil(cx + r)), y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(MH - 1, Math.ceil(cy + r));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const dx = x + .5 - cx, dy = y + .5 - cy; if (dx * dx + dy * dy <= r2) { v[y * MW + x] = 1; ex[y * MW + x] = 1; } } };
    for (const u of G.units) if (u.alive && u.team === team) mark(u.x, u.y, u.kind === 'titan' ? 14 : UNITS[u.kind].vision);
    if (team === 0) for (const s of G.structs) if (!s.dead && seatAlive(s.seat)) mark(s.x, s.y, s.type === 'lance' ? 13 : s.type === 'pulse' ? 9.5 : 7);
    else if (G.titan && G.titan.revealT > 0) for (const u of G.units) if (u.kind === 'builder' && u.alive) mark(u.x, u.y, 4);
  }
  for (const s of G.structs) if (v[idx(s.tx, s.ty)]) s._seen = true;
  for (let i = 0; i < N; i++) fogA[i] = v[i] ? 0 : ex[i] ? 120 : 165;   // unexplored land stays readable; only what moves on it is hidden
  const d = fog2img.data, f = R3.fogData;
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) { const i = y * MW + x; let s = fogA[i] * 2, n = 2; // soften edges with a small blur
    if (x > 0) { s += fogA[i - 1]; n++; } if (x < MW - 1) { s += fogA[i + 1]; n++; } if (y > 0) { s += fogA[i - MW]; n++; } if (y < MH - 1) { s += fogA[i + MW]; n++; }
    const a = s / n; d[i * 4] = 22; d[i * 4 + 1] = 13; d[i * 4 + 2] = 24; d[i * 4 + 3] = a; if (f) { f[i * 4] = f[i * 4 + 1] = f[i * 4 + 2] = a; f[i * 4 + 3] = 255; } }
  fog2ctx.putImageData(fog2img, 0, 0);
  if (R3.ok) { R3.fogTex.needsUpdate = true; M.nodes.forEach((ti, k) => { if (R3.nodeState[k] !== -2) setNode(k, v[ti] ? 2 : 1); }); flushNodes(); }
}
const canSee = (x, y) => inMap(x | 0, y | 0) && G.vis[idx(x | 0, y | 0)] === 1;
function updNav() {
  const d = R3.navData;
  for (let i = 0; i < N; i++) { const x = i % MW, y = (i / MW) | 0, w = M.walkT[i], s = G.struct[i]; let c = [255, 60, 60, 150];
    if (s) c = [255, 160, 40, 200]; else if (w) { const big = passVert(x, y, 0) === 0 || passVert(x + 1, y, 0) === 0 || passVert(x, y + 1, 0) === 0 || passVert(x + 1, y + 1, 0) === 0; c = M.h[i] > 0 && M.h[i] < TOP ? [80, 160, 255, 150] : big ? [60, 230, 120, 90] : [250, 230, 60, 170]; }
    else if (M.tiles[i] === WATER) c = [0, 0, 0, 0];
    d[i * 4] = c[0]; d[i * 4 + 1] = c[1]; d[i * 4 + 2] = c[2]; d[i * 4 + 3] = c[3]; }
  R3.navTex.needsUpdate = true;
}

/* ---------- effects state (plain data; drawn in render) ---------- */
function burst(x, y, col, n, sp, h) { if (!G || G.parts.length > 700) return; for (let i = 0; i < n; i++) { const a = Math.random() * 6.2832, v = sp * (0.3 + Math.random() * 0.7); G.parts.push({ x, y, h: h || 0.6, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vh: 2 + Math.random() * 5, life: 0.5 + Math.random() * 0.5, max: 1, col }); } }
function ring(x, y, r0, r1, col, life) { G.rings.push({ x, y, r0, r1, col, life: life || 0.45, max: life || 0.45 }); }
function floatText(x, y, text, col) { if (G.floats.length < 40) G.floats.push({ x, y, text, col, life: 1.2, max: 1.2 }); }
function structGone(s, destroyed) {
  if (Sel.struct === s) Sel.struct = null;
  const g = R3.ok && R3.structs.get(s.id); if (g) { R3.structs.delete(s.id); R3.dying.push({ g, t: 0.5, max: 0.5, sink: 1 }); }
  if (destroyed && canSee(s.x, s.y)) { burst(s.x, s.y, '#ffb648', 16, 5, 1); burst(s.x, s.y, '#8aa0b8', 14, 4, 1); ring(s.x, s.y, 0.5, 2.4, '#ffb648'); sfx('boom', s.x, s.y); }
}
function hpBar(g, x, y, w, f, col) { const h = Math.max(3, w * 0.1); g.fillStyle = 'rgba(0,0,0,0.75)'; g.fillRect(x - w / 2 - 1, y - 1, w + 2, h + 2); g.fillStyle = col; g.fillRect(x - w / 2, y, w * clamp(f, 0, 1), h); }

/* ---------- frame ---------- */
const mouse = { x: -1, y: -1, wx: 0, wy: 0, tx: -1, ty: -1, s: null, u: null, n: -1, has: false, box: null };
const anchorOf = () => [Math.round(mouse.wx) - 1, Math.round(mouse.wy) - 1];
let attractT = 0;
function syncModels(t, dt, team) {
  const seenS = new Set(), seenU = new Set();
  for (const s of G.structs) {
    if (s.dead || (team === 1 && !s._seen)) continue; seenS.add(s.id);
    let g = R3.structs.get(s.id); const S = G.seats[s.seat];
    if (!g) { g = makeStruct(s.type, S.fac, S.col); g.position.set(s.x, heightAt(s.x, s.y), s.y); R3.scene.add(g); R3.structs.set(s.id, g); }
    const u = g.userData, p = s.buildT > 0 ? 1 - s.buildT / s.buildTotal : 1, sh = s.flash > 0 ? (Math.random() - 0.5) * 0.08 : 0;
    g.scale.set(1, (0.2 + 0.8 * p) * (s.type === 'wall' ? 1 + 0.14 * s.lvl : 1), 1); g.position.x = s.x + sh; g.position.z = s.y + sh;
    if (u.head) { u.head.rotation.y = -s.aim; u.head.position.x = -Math.cos(s.aim) * s.recoil * 0.9; u.head.position.z = -Math.sin(s.aim) * s.recoil * 0.9; }
    if (u.core) u.core.scale.x = 0.02 + 0.05 * (1 - clamp(s.cd / DEFS.lance.rate, 0, 1));
    if (u.crystal) { u.crystal.rotation.y = t * (s.active ? 4 : 0.9); u.crystal.position.y = 2.15 + 0.08 * Math.sin(t * 2.5); u.halo.scale.setScalar(s.active ? 0.8 + 0.25 * Math.sin(t * 6) : 0.8); }
    for (const [o, sp] of u.spin) o.rotation.y = t * sp; for (const o of u.pulse) o.scale.setScalar(1 + 0.08 * Math.sin(t * 4));
    
    u.pips[0].visible = s.lvl >= 1; u.pips[1].visible = s.lvl >= 2;
  }
  for (const [id, g] of R3.structs) if (!seenS.has(id)) { R3.scene.remove(g); R3.structs.delete(id); }
  for (const c of G.units) {
    if (!unitShown(c, team)) continue; seenU.add(c.id);
    let g = R3.units.get(c.id);
    if (!g) { g = makeUnitModel(c); R3.scene.add(g); R3.units.set(c.id, g); }
    const u = g.userData, hy = groundAt(c.x, c.y), sc = (u.base || 1) * (c.kind === 'titan' ? titanScale(c) : 1) * (c.flash > 0 ? 1.06 : 1), sp = u.slowWalk ? 5 : 11;
    g.position.set(c.x, hy, c.y); g.rotation.y = -c.face; g.scale.setScalar(sc * (c.dormant ? 0.8 : 1));
    if (c.dormant) g.position.y = hy - 0.6; else if (c.bBurrow > 0) g.position.y = hy - 0.9 * sc; else if (u.floaty) g.position.y = hy + 0.5 + 0.25 * Math.sin(t * 2 + c.id);
    g.visible = !(c.bPhase > 0 && Math.sin(t * 40) > 0.2);
    if (u.legs) for (const l of u.legs) { const a = Math.sin(t * sp + l.ph) * (c.moving ? (l.amp || 0.3) : c.sieging ? 0.14 : 0.02); if (l.axis === 'z' || c.kind === 'builder' || c.kind === 'husk') l.lg.rotation.z = a * 1.6; else l.lg.rotation.y = a; }
    if (u.orbit) for (const [o, spd, ph] of u.orbit) { o.rotation.y = t * spd + ph; o.position.y = 0.2 * Math.sin(t * 1.7 + ph); }
    if (u.core) { u.core.rotation.y = t * 1.5; }
    if (u.pulse) for (let k = 0; k < u.pulse.length; k++) { const m = u.pulse[k], s0 = m.userData.s0 || (m.userData.s0 = m.scale.x); m.scale.setScalar(s0 * (1 + 0.18 * Math.sin(t * 4 + k))); }
    if (u.ab) { const y0 = u.ab.userData.y0 || (u.ab.userData.y0 = u.ab.scale.y); u.ab.scale.y = y0 * (1 + 0.05 * Math.sin(t * 3)); }
    if (u.load) u.load.visible = c.carry > 0; if (u.rotor) u.rotor.rotation.y = t * 25; if (u.float) u.float.position.y = 0.7 + 0.08 * Math.sin(t * 4 + c.id);
  }
  for (const [id, g] of R3.units) if (!seenU.has(id)) { R3.units.delete(id); const c = G.units.find(x => x.id === id); if (c && !c.alive && c.hp <= 0 && g.visible) R3.dying.push({ g, t: 0.7, max: 0.7, sink: 0 }); else R3.scene.remove(g); }
  for (const d of R3.dying) { d.t -= dt; const f = Math.max(0, d.t / d.max); if (d.sink) { d.g.scale.y *= 0.86; d.g.position.y -= dt * 1.5; } else { d.g.rotation.z = (1 - f) * 1.4; d.g.scale.multiplyScalar(0.97); } if (d.t <= 0) R3.scene.remove(d.g); }
  R3.dying = R3.dying.filter(d => d.t > 0);
}
function render(dt) {
  const t = performance.now() / 1000, running = App.phase === 'game', g = ctx;
  if (!running) { attractT += dt; cam.x = CX + Math.cos(attractT * 0.04 + 1.2) * 40; cam.y = CY + Math.sin(attractT * 0.04 + 1.2) * 40; cam.zoom = defaultZoom() * 0.7; }
  cam.x = clamp(cam.x, 2, MW - 2); cam.y = clamp(cam.y, 2, MH - 2);
  if (G.shake > 0.1) G.shake *= Math.pow(0.02, dt);
  g.setTransform(DPR, 0, 0, DPR, 0, 0); g.clearRect(0, 0, W, H);
  if (!R3.ok) { g.fillStyle = '#d9e7f3'; g.font = '600 15px "Chakra Petch",system-ui,sans-serif'; g.textAlign = 'center'; g.fillText('This game needs WebGL, which this browser or device is not offering.', W / 2, H - 40); if (running) updHud(); return; }
  placeCamera();
  if (G.shake > 0.1) { R3.camera.position.x += (Math.random() - 0.5) * G.shake * 0.03; R3.camera.position.y += (Math.random() - 0.5) * G.shake * 0.03; }
  const team = running && !G.reveal ? localTeam() : -1, mySeat = Local.seat, S = localSeat(), z = cam.zoom;
  syncModels(t, dt, team);
  R3.waterTex.offset.set(t * 0.006, t * 0.004); R3.sink.rotation.y = t * 0.05; R3.glow.material.opacity = 0.45 + 0.15 * Math.sin(t * 2.2); R3.sinkHalo.material.opacity = 0.4 + 0.15 * Math.sin(t * 1.6);
  const a = G.titan; R3.sinkGlow.intensity = 1.0 + 0.6 * Math.sin(t * (a && (a.dormant || Math.hypot(a.x - CX, a.y - CY) < SINK_R) ? 3 : 1.2));
  R3.fogMesh.visible = running && team >= 0;
  for (const k in R3.used) R3.used[k] = 0;
  for (const p of G.shots) { const m = R3.get('shot', R3.used.shot++); m.position.set(p.x, groundAt(p.x, p.y) + 1.3, p.y); m.scale.setScalar(0.16); m.material.color.set(p.fac === 'alien' ? 0xb6ff7a : p.fac === 'robot' ? 0x8ff6ff : 0xffd27a); }
  for (const b of G.beams) { b.life -= dt; const f = Math.max(0, b.life / b.max); beam3(b.x1, b.y1, b.h1, b.x2, b.y2, b.h2, b.col, b.w * (0.4 + 0.6 * f), f); }
  G.beams = G.beams.filter(b => b.life > 0);
  for (const r of G.rings) { r.life -= dt; const f = 1 - Math.max(0, r.life / r.max); ring3(r.x, r.y, Math.max(0.05, r.r0 + (r.r1 - r.r0) * f), r.col, 1 - f); }
  G.rings = G.rings.filter(r => r.life > 0);
  for (const p of G.pools) if (team < 0 || canSee(p.x, p.y)) { disc3(p.x, p.y, p.r, '#b6ff3a', 0.28 + 0.1 * Math.sin(t * 6)); ring3(p.x, p.y, p.r, '#d8ff5a', 0.7); }
  const selSet = new Set(Sel.units.map(u => u.id));
  if (running) for (const u of G.units) { if (!unitShown(u, team)) continue; const col = G.seats[u.seat].col;
    if (selSet.has(u.id)) ring3(u.x, u.y, unitRadius(u) * 1.25, u.team === localTeam() ? '#7dffb0' : '#ff6a6a', 0.95);
    if (u.beam) { const B = u.beam, bc = B.k === 3 ? COL.flux : B.k === 2 ? '#ffd27a' : B.k === 1 ? col : COL.lumen; beam3(u.x, u.y, u.kind === 'worker' ? 0.5 : 1.0, B.x, B.y, 0.9, bc, 0.05, 0.55 + 0.3 * Math.sin(t * 30)); if (Math.random() < 0.3) burst(B.x, B.y, bc, 1, 1.5, 0.9); }
    if (u.kind === 'titan' || u.kind === 'husk') { if (u.slowed > 0) ring3(u.x, u.y, 1.4 + 0.2 * Math.sin(t * 8), '#b28cff', 0.7); if (u.bReinf > 0) ring3(u.x, u.y, 1.9, '#ffd27a', 0.8, 0.5); if (u.bRegen > 0) ring3(u.x, u.y, 1.2 + ((t * 1.5) % 1), '#74f2a4', 0.6); if (u.bBurrow > 0 && u.team === team) ring3(u.x, u.y, 1.3, '#c8a27a', 0.6); } }
  if (running) for (const s of G.structs) if (!s.dead && s.type === 'mend' && s.tgt && !s.tgt.dead && seatAlive(s.seat) && (team !== 1 || canSee(s.x, s.y))) beam3(s.x, s.y, 2.0, s.tgt.x, s.tgt.y, 1, '#74f2a4', 0.04, 0.6);
  if (running) for (const u of Sel.units) { if (u.seat !== mySeat || G.view) continue; let px = u.x, py = u.y; for (const o of u.orders.slice(0, 6)) { const tx = o.x !== undefined ? o.x : o.tx !== undefined ? o.tx + (o.t === 'build' ? 1 : .5) : null; if (tx === null) continue; const ty = o.y !== undefined ? o.y : o.ty + (o.t === 'build' ? 1 : .5); beam3(px, py, 0.15, tx, ty, 0.15, o.t === 'amove' ? '#ff6a6a' : '#7dffb0', 0.025, 0.5); ring3(tx, ty, 0.3, o.t === 'amove' ? '#ff6a6a' : '#7dffb0', 0.7); px = tx; py = ty; } }
  // queued blueprints
  if (running && mouse.has && mouse.n >= 0 && team === 0 && ownSel().length) ring3((mouse.n % MW) + .5, ((mouse.n / MW) | 0) + .5, 0.75 + 0.06 * Math.sin(t * 8), M.tiles[mouse.n] === VEIN ? COL.flux : COL.lumen, 0.95);
  const jobs = running && team !== 1 ? allJobs() : [];
  while (R3.jobs.length < jobs.length) { const m = new T3.Mesh(R3.geos.box, R3.jobMat); m.renderOrder = 3; R3.scene.add(m); R3.jobs.push(m); }
  R3.jobs.forEach((m, k) => { const j = jobs[k]; m.visible = !!j; if (j) { const hh = DEFS[j.type].h * 0.7; m.scale.set(1.9, hh, 1.9); m.position.set(j.tx + 1, heightAt(j.tx + 1, j.ty + 1) + hh / 2, j.ty + 1); } });
  // selection ring for a structure, placement ghost, targeting ring
  const sel = running && Sel.struct && !Sel.struct.dead ? Sel.struct : null; R3.rangeRing.visible = false;
  if (sel) { ring3(sel.x, sel.y, 1.6, sel.seat === mySeat ? '#7dffb0' : G.seats[sel.seat].role === 'builder' && team === 0 ? '#ffe27a' : '#ff6a6a', 0.95); const d = DEFS[sel.type]; if (d.range) { R3.rangeRing.visible = true; R3.rangeRing.position.set(sel.x, heightAt(sel.x, sel.y) + 0.14, sel.y); R3.rangeRing.scale.set(d.range, d.range, 1); } }
  let why = null, gx = 0, gy = 0; for (const k in R3.ghosts) R3.ghosts[k].visible = false;
  if (running && G.placing && mouse.has && S && S.role === 'builder') { const [ax, ay] = anchorOf(), d = DEFS[G.placing], gh = ghostFor(G.placing, S.fac); why = placeBlock(S, G.placing, ax, ay); gx = ax + 1; gy = ay + 1; const hy = heightAt(gx, gy);
    gh.visible = true; gh.position.set(gx, hy, gy); R3.ghostMat.color.set(why ? 0xff3d74 : 0x5ef2c0); disc3(gx, gy, 1.42, why ? '#ff3d74' : '#5ef2c0', 0.25);
    if (d.range) { R3.rangeRing.visible = true; R3.rangeRing.position.set(gx, hy + 0.14, gy); R3.rangeRing.scale.set(d.range, d.range, 1); } }
  const au = Sel.units[0];
  if (running && G.aim && au && au.alive) { const A = G.aim === 'dash' ? { range: DASH_R, aim: 'point' } : G.aim === 'amove' ? null : TITANS[au.tk].abil[G.aim];
    if (A) { R3.rangeRing.visible = true; R3.rangeRing.position.set(au.x, groundAt(au.x, au.y) + 0.14, au.y); R3.rangeRing.scale.set(A.range, A.range, 1);
      if (mouse.has) { const dx = mouse.wx - au.x, dy = mouse.wy - au.y, d = Math.hypot(dx, dy) || 1, k = Math.min(1, A.range / d), ex = au.x + dx * k, ey = au.y + dy * k; if (A.aim === 'line') beam3(au.x, au.y, 0.3, ex, ey, 0.3, '#ffffff', 0.3, 0.3); else ring3(ex, ey, 1.2, '#ffffff', 0.8); } } }
  let pn = 0; for (const p of G.parts) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.h = Math.max(0, p.h + p.vh * dt); p.vh -= 12 * dt; p.vx *= 0.95; p.vy *= 0.95;
    if (pn < R3.pMax && p.life > 0) { R3.pPos[pn * 3] = p.x; R3.pPos[pn * 3 + 1] = groundAt(p.x, p.y) + p.h; R3.pPos[pn * 3 + 2] = p.y; if (!p.c3) p.c3 = new T3.Color(p.col); const f = clamp(p.life / p.max * 1.5, 0, 1); R3.pCol[pn * 3] = p.c3.r * f; R3.pCol[pn * 3 + 1] = p.c3.g * f; R3.pCol[pn * 3 + 2] = p.c3.b * f; pn++; } }
  G.parts = G.parts.filter(p => p.life > 0); R3.points.geometry.setDrawRange(0, pn); R3.points.geometry.attributes.position.needsUpdate = true; R3.points.geometry.attributes.color.needsUpdate = true;
  for (const k in R3.pool) for (let i = R3.used[k]; i < R3.pool[k].length; i++) R3.pool[k][i].visible = false;
  R3.renderer.render(R3.scene, R3.camera);

  // ---- 2D overlay: bars, names, marquee ----
  if (running) {
    const onScr = p => p[2] < 1 && p[0] > -40 && p[0] < W + 40 && p[1] > -40 && p[1] < H + 40;
    for (const s of G.structs) { if (s.dead || (team === 1 && !s._seen)) continue; const building = s.buildT > 0; if (!building && s.hp >= s.maxHp - 1 && s !== sel) continue; const p = w2s(s.x, s.y, DEFS[s.type].h + 0.6); if (!onScr(p)) continue;
      if (building) hpBar(g, p[0], p[1], z * 1.7, 1 - s.buildT / s.buildTotal, COL.lumen); else hpBar(g, p[0], p[1], z * 1.7, s.hp / s.maxHp, s.hp / s.maxHp > 0.4 ? COL.ok : '#ff8a5c'); }
    g.textAlign = 'center';
    for (const u of G.units) { if (!unitShown(u, team) || u.dormant) continue; const Sx = G.seats[u.seat], p = w2s(u.x, u.y, unitHeight(u) + 0.3); if (!onScr(p)) continue; const picked = selSet.has(u.id);
      if (u.kind === 'worker' || u.kind === 'brood') { if (u.hp < u.maxHp || picked) hpBar(g, p[0], p[1], z * 0.8, u.hp / u.maxHp, u.team ? COL.husk : COL.ok); continue; }
      const big = u.kind === 'titan', label = big ? TITANS[u.tk].name.toUpperCase() + '  LV ' + u.lvl : Sx.name;
      if (big || u.hp < u.maxHp || picked) hpBar(g, p[0], p[1], z * (big ? 3.2 : 1.3), u.hp / u.maxHp, u.team ? COL.threat : COL.ok);
      g.font = `${big ? 700 : 600} ${Math.max(10, z * (big ? 0.42 : 0.38))}px "Chakra Petch",system-ui,sans-serif`; g.strokeStyle = 'rgba(0,0,0,0.8)'; g.lineWidth = 3; g.strokeText(label, p[0], p[1] - 5); g.fillStyle = big ? '#fff' : u.kind === 'husk' ? '#ff9ab0' : Sx.col; g.fillText(label, p[0], p[1] - 5); }
    if (why) { const p = w2s(gx, gy, 0); g.font = '600 13px "Chakra Petch",system-ui,sans-serif'; g.strokeStyle = 'rgba(0,0,0,0.85)'; g.lineWidth = 3; g.strokeText(why, p[0], p[1] + z * 1.4); g.fillStyle = '#ffd0dc'; g.fillText(why, p[0], p[1] + z * 1.4); }
    for (const f of G.floats) { f.life -= dt; const p = w2s(f.x, f.y, 2 + (1 - f.life / f.max) * 1.6); g.globalAlpha = clamp(f.life / f.max * 1.5, 0, 1); g.font = `700 ${Math.max(12, z * 0.42)}px "JetBrains Mono",monospace`; g.strokeStyle = 'rgba(0,0,0,0.85)'; g.lineWidth = 3; g.strokeText(f.text, p[0], p[1]); g.fillStyle = f.col; g.fillText(f.text, p[0], p[1]); }
    g.globalAlpha = 1; G.floats = G.floats.filter(f => f.life > 0);
    if (mouse.box) { const b = mouse.box; g.strokeStyle = '#7dffb0'; g.lineWidth = 1.5; g.fillStyle = 'rgba(125,255,176,0.10)'; g.fillRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0); g.strokeRect(b.x0 + .5, b.y0 + .5, b.x1 - b.x0, b.y1 - b.y0); }
    const me = localUnit();
    if (me && me.alive && me.kind === 'builder' && me.hp < me.maxHp * 0.6) { const f = 1 - me.hp / (me.maxHp * 0.6), vg = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75); vg.addColorStop(0, 'rgba(255,61,116,0)'); vg.addColorStop(1, `rgba(255,61,116,${0.45 * f})`); g.fillStyle = vg; g.fillRect(0, 0, W, H); }
    drawMini(team); updHud();
  }
}
/* ---------- minimap: flat, north up, same fog rules ---------- */
const mini = $('mini'), mctx = mini.getContext('2d');
function paintMiniBase() {
  const g = R3.miniBase.getContext('2d'); g.clearRect(0, 0, MW, MH);
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) { const i = idx(x, y), v = M.tiles[i]; if (v === WATER) continue; const hh = M.h[i];
    let c = v === SAND ? '#e6c58e' : v === TREE ? '#5f9a2c' : v === CRYSTAL ? '#5ef2e0' : v === ROCK ? '#8a5e4e' : v === NEST ? '#7a1c40' : v === VEIN ? '#ff7ad1' : hh === TOP ? '#dba968' : hh ? '#e6c58e' : '#c08552';
    if (hh === TOP && v === GROUND) for (const [dx, dy] of [[0, 1], [1, 0], [-1, 0], [0, -1]]) { const nx = x + dx, ny = y + dy; if (inMap(nx, ny) && M.h[idx(nx, ny)] === 0) c = '#8a5e4e'; }
    g.fillStyle = c; g.fillRect(x, y, 1, 1); }
}
R3.miniBase = document.createElement('canvas'); R3.miniBase.width = MW; R3.miniBase.height = MH; paintMiniBase();
function drawMini(team) {
  const g = mctx, S = mini.width, k = S / MW;
  g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#2f8f9c'; g.fillRect(0, 0, S, S);
  g.imageSmoothingEnabled = false; g.drawImage(R3.miniBase, 0, 0, S, S);
  for (const s of G.structs) { if (s.dead || (team === 1 && !s._seen)) continue; g.fillStyle = G.seats[s.seat].dead ? '#5a6878' : G.seats[s.seat].col; g.fillRect(s.tx * k, s.ty * k, 2 * k, 2 * k); }
  g.imageSmoothingEnabled = true; if (team >= 0) g.drawImage(fog2d, 0, 0, S, S);
  for (const u of G.units) { if (!unitShown(u, team) || u.dormant) continue;
    if (u.kind === 'worker' || u.kind === 'brood') { g.fillStyle = u.team ? COL.threat : G.seats[u.seat].col; g.fillRect(u.x * k - 1.5, u.y * k - 1.5, 3, 3); continue; }
    const r = u.kind === 'titan' ? k * 2.4 * (1 + 0.3 * Math.sin(performance.now() / 120)) : k * 1.5;
    g.fillStyle = '#fff'; g.beginPath(); g.arc(u.x * k, u.y * k, r + 1.5, 0, 6.2832); g.fill(); g.fillStyle = u.team ? COL.threat : G.seats[u.seat].col; g.beginPath(); g.arc(u.x * k, u.y * k, r, 0, 6.2832); g.fill(); }
  const c = [s2w(0, 0), s2w(W, 0), s2w(W, H), s2w(0, H)];
  g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 2; g.beginPath(); c.forEach((p, i) => { const x = clamp(p[0], -20, MW + 20) * k, y = clamp(p[1], -20, MH + 20) * k; i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); g.stroke();
}
/* ---------- portraits, build icons and menu previews: the real models, rendered small ---------- */
function shot(model, canvas, hh, rot, dist) {
  if (!R3.ok) return;
  if (!R3.icon) { const r = new T3.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); r.setSize(160, 160, false); const sc = new T3.Scene(); sc.add(new T3.HemisphereLight(0xcfe6ff, 0x26303c, 1.0)); const l = new T3.DirectionalLight(0xfff0dc, 0.9); l.position.set(-3, 6, 4); sc.add(l); const l2 = new T3.DirectionalLight(0x4fd8ff, 0.35); l2.position.set(4, 2, -3); sc.add(l2); R3.icon = { r, sc, c: new T3.PerspectiveCamera(30, 1, 0.1, 80) }; }
  const I = R3.icon; I.sc.add(model); model.rotation.y = rot || 0; if (model.userData.head) model.userData.head.rotation.y = -0.4;
  const d = dist || (3.2 + hh * 1.9); I.c.position.set(d * 0.55, hh * 0.55 + d * 0.5, d * 0.75); I.c.lookAt(0, hh * 0.48, 0);
  I.r.render(I.sc, I.c); I.sc.remove(model);
  const g = canvas.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, canvas.width, canvas.height); g.drawImage(I.r.domElement, 0, 0, canvas.width, canvas.height);
}
function structIcon(type, fac, col, canvas) { if (R3.ok) shot(makeStruct(type, fac, col), canvas, DEFS[type].h, 0.5); }
function unitPortrait(c, canvas) { if (!R3.ok) return; const m = makeUnitModel(c); m.scale.setScalar(m.userData.base || 1); const hh = c.kind === 'titan' ? (c.tk === 'colossus' ? 4.2 : c.tk === 'wraith' ? 3.2 : 2.6) : c.kind === 'husk' ? 3 : c.kind === 'builder' ? 2.2 : 1.2; shot(m, canvas, hh, -0.5); }
initGL();
