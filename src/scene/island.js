import * as THREE from 'three';
import {
  PropBatch, propMaterial, mat, addTree, addBush, addGrass, addRock,
  LEAF_COLORS, ROCK_COLORS, GRASS_COLORS,
} from './flora.js';
import { createStructure } from './structures/index.js';

// Остров: процедурный рельеф (неровный берег, пляж, холм со смещённой вершиной, бугры),
// раскраска граней по высоте и уклону, растительность и скалы из flora.js.
//
// Поля def (все, кроме x, z, r, h, необязательны):
//   trees       — число деревьев;  treeKinds — веса видов { pine: 2, oak: 1, palm: 0, cypress: 0 }
//   leaf        — цвета листвы (hex или имена LEAF_COLORS), каждое дерево берёт случайный;
//                 можно по видам: { oak: ['fresh', 'autumn'], pine: ['deep'] }
//   treeScale   — [min, max] масштаба деревьев
//   bushes, grass, rocks — количество; bushColor, grassColor, flowers (доля кустов с цветами)
//   rockColor   — цвета скал (hex или имена ROCK_COLORS), rockScale — [min, max]
//   groundColor, sandColor, cliffColor — цвета рельефа;  lighthouse — маяк на вершине (true или стиль south | north | atlantic, см. structures/houses.js)

const DEFAULTS = {
  treeKinds: { pine: 2, oak: 1 },
  leaf: ['green', 'fresh'],
  treeScale: [0.8, 1.3],
  bushColor: ['fresh', 'green', 'olive'],
  grassColor: ['green', 'lush'],
  flowers: 0.3,
  rockColor: ['gray'],
  rockScale: [0.6, 2.2],
  groundColor: 0x7fb069,
  sandColor: 0xe9dcb2,
  cliffColor: 0x9a948a,
};

const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];
const range = ([a, b], rng) => a + (b - a) * rng();
const asList = (v) => (Array.isArray(v) ? v : [v]);
const named = (c, palette) => (typeof c === 'string' ? palette[c] : c);

function pickWeighted(weights, rng) {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  let t = rng() * entries.reduce((s, [, w]) => s + w, 0);
  for (const [k, w] of entries) { if ((t -= w) <= 0) return k; }
  return entries[0][0];
}

// Рельеф в локальной СК острова.
function makeTerrain(def, rng) {
  const R = def.r, H = def.h;
  const ph = Array.from({ length: 12 }, () => rng() * Math.PI * 2);
  const ang = (a, o = 0) => 0.5 * Math.sin(2 * a + ph[o]) + 0.3 * Math.sin(3 * a + ph[o + 1]) + 0.2 * Math.sin(5 * a + ph[o + 2]);
  const noise = (x, z) => (Math.sin(x * 0.11 + ph[6]) * Math.sin(z * 0.13 + ph[7]) + 0.5 * Math.sin(x * 0.27 + z * 0.21 + ph[8])
    + 0.5 * Math.sin(-x * 0.23 + z * 0.31 + ph[9]) + 0.25 * Math.sin(x * 0.61 + ph[10]) * Math.sin(z * 0.57 + ph[11])) / 2.25;
  // вершина холма смещена от центра
  const peak = new THREE.Vector2((rng() - 0.5) * R * 0.3, (rng() - 0.5) * R * 0.3);
  const shoreAt = (a) => R * (0.9 + 0.05 * ang(a));

  function height(x, z) {
    const a = Math.atan2(z, x);
    const t = Math.hypot(x, z) / shoreAt(a);
    if (t >= 1) return -Math.min(4, (t - 1) * R * 0.35);
    // пляж узкой полосой у воды, за ним низина, поднимающаяся к холму
    const beach = 1.0 * smooth(1, 0.86, t) + 1.4 * smooth(0.88, 0.45, t);
    const ph2 = Math.atan2(z - peak.y, x - peak.x);
    const th = Math.hypot(x - peak.x, z - peak.y) / (R * 0.78 * (1 + 0.15 * ang(ph2, 3)));
    const hillK = Math.max(0, 1 - th);
    const hill = H * (0.55 * Math.pow(hillK, 1.6) + 0.45 * smooth(0, 1, hillK)); // округлая вершина
    const bumps = 0.6 * noise(x, z) * smooth(1, 0.75, t) + 0.1 * H * noise(x * 2.1, z * 2.1) * hillK;
    return beach + hill + bumps;
  }

  return { height, shoreAt, peak, R, H };
}

function buildTerrainMesh(terrain, def, rng, colors) {
  const NR = 22, NS = 56, TMAX = 1.14;
  const pts = [];
  for (let i = 0; i <= NR; i++) {
    const row = [];
    const t = TMAX * Math.pow(i / NR, 0.85);
    for (let j = 0; j < NS; j++) {
      const a = (j / NS) * Math.PI * 2 + (i % 2) * (Math.PI / NS); // шахматный сдвиг — меньше «спиц»
      const d = t * terrain.shoreAt(a);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      row.push(new THREE.Vector3(x, terrain.height(x, z), z));
      if (i === 0) break;
    }
    pts.push(row);
  }
  const pos = [], col = [];
  const n = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  const c = new THREE.Color(), grassDark = new THREE.Color(colors.ground).offsetHSL(0.01, 0, -0.07);
  const grassDry = new THREE.Color(colors.ground).offsetHSL(-0.04, -0.05, 0.06);
  const wetSand = new THREE.Color(colors.sand).offsetHSL(0, -0.05, -0.12);
  const tri = (a, b, d) => {
    // грань лицом вверх (CCW сверху)
    e1.subVectors(b, a); e2.subVectors(d, a); n.crossVectors(e1, e2).normalize();
    if (n.y < 0) { n.negate(); [b, d] = [d, b]; }
    const cy = (a.y + b.y + d.y) / 3;
    const cx = (a.x + b.x + d.x) / 3, cz = (a.z + b.z + d.z) / 3;
    const patch = Math.sin(cx * 0.21 + cz * 0.17) * Math.sin(cz * 0.19 - cx * 0.08);
    if (cy < -0.15) c.copy(wetSand);
    else if (cy < 0.9) c.set(colors.sand);
    else if (n.y < 0.62 || (terrain.H > 22 && cy > terrain.H * 0.8)) c.set(colors.cliff);
    else c.set(colors.ground).lerp(patch > 0 ? grassDark : grassDry, Math.abs(patch) * 0.8);
    c.offsetHSL(0, 0, (rng() - 0.5) * 0.05);
    for (const p of [a, b, d]) { pos.push(p.x, p.y, p.z); col.push(c.r, c.g, c.b); }
  };
  for (let j = 0; j < NS; j++) tri(pts[0][0], pts[1][(j + 1) % NS], pts[1][j]);
  for (let i = 1; i < NR; i++) {
    const A = pts[i], B = pts[i + 1], off = i % 2;
    for (let j = 0; j < NS; j++) {
      const j1 = (j + 1) % NS;
      // ряды сдвинуты на полшага: соединяем зигзагом
      if (off) { tri(A[j], A[j1], B[j1]); tri(A[j], B[j1], B[j]); }
      else { tri(A[j], A[j1], B[j]); tri(A[j1], B[j1], B[j]); }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, propMaterial());
  mesh.receiveShadow = true;
  return mesh;
}

export function makeIsland(defIn, rng) {
  const def = { ...DEFAULTS, ...defIn };
  const g = new THREE.Group();
  g.position.set(def.x, 0, def.z);
  const terrain = makeTerrain(def, rng);
  g.add(buildTerrainMesh(terrain, def, rng, { ground: def.groundColor, sand: def.sandColor, cliff: def.cliffColor }));
  // для карты берега (shore-map.js): рельеф в мировых координатах и следы прибрежных скал
  const shore = { x: def.x, z: def.z, R: def.r, height: (wx, wz) => terrain.height(wx - def.x, wz - def.z), rocks: [] };
  g.userData.shore = shore;

  const keepOut = [];
  if (def.lighthouse) {
    const lh = createStructure('lighthouse', { style: def.lighthouse === true ? 'atlantic' : def.lighthouse });
    lh.position.set(terrain.peak.x, terrain.height(terrain.peak.x, terrain.peak.y) - 0.5, terrain.peak.y);
    g.add(lh);
    keepOut.push({ x: terrain.peak.x, z: terrain.peak.y, r: 4 });
  }

  // точка на острове: доля радиуса берега [t0, t1], максимальный уклон, минимальная высота
  const slope = (x, z) => {
    const e = 0.7;
    const hx = terrain.height(x + e, z) - terrain.height(x - e, z);
    const hz = terrain.height(x, z + e) - terrain.height(x, z - e);
    return Math.hypot(hx, hz) / (2 * e);
  };
  function spot(t0, t1, maxSlope = 0.8, minY = 1.2, maxY = Infinity) {
    for (let k = 0; k < 40; k++) {
      const a = rng() * Math.PI * 2;
      const t = Math.sqrt(t0 * t0 + (t1 * t1 - t0 * t0) * rng());
      const d = t * terrain.shoreAt(a);
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      const y = terrain.height(x, z);
      if (y < minY || y > maxY || slope(x, z) > maxSlope) continue;
      if (keepOut.some((o) => Math.hypot(x - o.x, z - o.z) < o.r)) continue;
      return { x, y, z };
    }
    return null;
  }
  const place = (p, sink = 0.15) => mat(p.x, p.y - sink, p.z, 1, 1, 1, 0, rng() * Math.PI * 2, 0);

  const props = new PropBatch();
  const grass = new PropBatch();
  const area = (def.r / 50) ** 2;
  const leafFor = (kind) => {
    const v = Array.isArray(def.leaf) || typeof def.leaf !== 'object' ? def.leaf : def.leaf[kind];
    return v === undefined ? undefined : pick(asList(v), rng);
  };

  // деревья: пальмы ближе к пляжу, остальные — выше
  for (let i = 0; i < def.trees; i++) {
    const kind = pickWeighted(def.treeKinds, rng);
    const p = kind === 'palm' ? spot(0.5, 0.86, 0.6, 0.9) : spot(0.05, 0.78, 0.7, 1.4);
    if (!p) continue;
    addTree(props, kind, place(p, 0.2), { scale: range(def.treeScale, rng), leaf: kind === 'palm' ? undefined : leafFor(kind) }, rng);
  }
  const bushes = def.bushes ?? Math.round(70 * area);
  const bushColors = asList(def.bushColor).map((c) => named(c, LEAF_COLORS));
  for (let i = 0; i < bushes; i++) {
    const p = spot(0.1, 0.88, 0.8, 1.0);
    if (p) addBush(props, place(p), { scale: 0.9 + rng() * 1.1, color: pick(bushColors, rng), flowers: rng() < def.flowers }, rng);
  }
  const tufts = def.grass ?? Math.round(450 * area);
  const grassColors = asList(def.grassColor).map((c) => named(c, GRASS_COLORS));
  for (let i = 0; i < tufts; i++) {
    const p = spot(0.15, 0.9, 0.7, 1.05);
    if (p) addGrass(grass, place(p, 0.05), { scale: 1.1 + rng() * 1.0, color: pick(grassColors, rng) }, rng);
  }
  // скалы: на склонах и у воды, часть наполовину в воде
  const rocks = def.rocks ?? Math.round(14 * area);
  const rockColors = asList(def.rockColor).map((c) => named(c, ROCK_COLORS));
  for (let i = 0; i < rocks; i++) {
    const coastal = i % 2 === 0;
    const p = coastal ? spot(0.92, 1.08, 2, -1.5, 0.8) : spot(0.1, 0.9, 2, 0.5);
    if (!p) continue;
    const s = range(def.rockScale, rng) * (coastal ? 1.2 : 1);
    // порядок вызовов rng прежний — расстановка не меняется
    const base = place(p, s * 0.25), color = pick(rockColors, rng), cluster = rng() < 0.4;
    addRock(props, base, { scale: s, color, cluster }, rng);
    // след на уровне воды: камень — эллипсоид с центром ~p.y и полувысотой ~0.6s (см. addRock);
    // у кучки обломки лежат до ~1.4s от центра; утонувшие камни пены не дают
    const cy = (p.y - 0.02 * s) / (0.6 * s);
    if (coastal && cy > -0.9) shore.rocks.push({ x: def.x + p.x, z: def.z + p.z, r: Math.max(0.5, s * (cluster ? 1.2 : 0.9) * Math.sqrt(1 - Math.min(1, cy * cy))) });
  }

  const propMesh = props.toMesh(propMaterial());
  propMesh.castShadow = true; propMesh.receiveShadow = true;
  const grassMesh = grass.toMesh(propMaterial());
  grassMesh.receiveShadow = true;
  grassMesh.userData.noReflect = true; // в отражении на половинном разрешении травы не видно
  g.add(propMesh, grassMesh);
  return g;
}

