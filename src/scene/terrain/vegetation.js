import * as THREE from 'three';
import { MAT } from './heightfield.js';
import { PropBatch, propMaterial, addTree, addBush, addGrass, addRock, mat, LEAF_COLORS, TRUNK_COLORS } from '../flora.js';
import { mulberry32 } from './noise.js';
import { ZONES } from './biomes.js';

// Растительность и камни по зонам и влажности (шаг 3 карты «Архипелаг»).
// Расстановка: сетка 4 м со сдвигом точки в клетке; в клетке независимо пробуются дерево, куст, трава, камень
// с вероятностью по зоне (DENSITY) и влажности. Вид — по биому точки (bio.pickBiome: куртины в смешанных областях).
// Занятые постройками и дорогами клетки (occ) пропускаются.
// Рендер: InstancedMesh на вид × вариант в ячейке cell×cell м; разброс — поворот, масштаб, instanceColor.
// LOD по ячейкам: вблизи полная модель, дальше упрощённая (low), за far вид не рисуется.
// update(camera.position, lod) — переключение, звать перед рендером.

// вид: full — модель в PropBatch (rng — вариант), low — упрощённая, near/far — дальности LOD (м), shadow — тень
const sub = (b, color, geo, m) => b.add(geo, color, m);
const KINDS = {
  pine: { variants: 3, scale: [0.8, 1.35], shadow: true, near: 260, far: Infinity,
    full: (b, rng) => addTree(b, 'pine', new THREE.Matrix4(), { leaf: rng() < 0.5 ? 'green' : 'deep' }, rng),
    low: (b) => { sub(b, TRUNK_COLORS.brown, new THREE.CylinderGeometry(0.2, 0.3, 2, 4), mat(0, 1)); sub(b, LEAF_COLORS.deep, new THREE.ConeGeometry(1.5, 4.6, 6), mat(0, 3.9)); } },
  oak: { variants: 3, scale: [0.8, 1.3], shadow: true, near: 260, far: Infinity,
    full: (b, rng) => addTree(b, 'oak', new THREE.Matrix4(), { leaf: rng() < 0.5 ? 'fresh' : 'green' }, rng),
    low: (b) => { sub(b, TRUNK_COLORS.brown, new THREE.CylinderGeometry(0.2, 0.32, 2.4, 4), mat(0, 1.2)); sub(b, LEAF_COLORS.fresh, new THREE.IcosahedronGeometry(1, 0), mat(0, 3.4, 0, 1.9, 1.5, 1.9)); } },
  olive: { variants: 3, scale: [0.6, 0.85], shadow: true, near: 260, far: Infinity,
    full: (b, rng) => addTree(b, 'oak', new THREE.Matrix4(), { leaf: 'olive', trunk: 'dark' }, rng),
    low: (b) => { sub(b, TRUNK_COLORS.dark, new THREE.CylinderGeometry(0.2, 0.32, 2.4, 4), mat(0, 1.2)); sub(b, LEAF_COLORS.olive, new THREE.IcosahedronGeometry(1, 0), mat(0, 3.4, 0, 1.9, 1.4, 1.9)); } },
  cypress: { variants: 2, scale: [0.85, 1.3], shadow: true, near: 260, far: Infinity,
    full: (b, rng) => addTree(b, 'cypress', new THREE.Matrix4(), {}, rng),
    low: (b) => sub(b, LEAF_COLORS.deep, new THREE.ConeGeometry(0.85, 6.2, 5), mat(0, 3.3)) },
  palm: { variants: 2, scale: [0.85, 1.25], shadow: true, near: 260, far: Infinity,
    full: (b, rng) => addTree(b, 'palm', new THREE.Matrix4(), {}, rng),
    low: (b) => { sub(b, TRUNK_COLORS.palm, new THREE.CylinderGeometry(0.15, 0.2, 4.5, 4), mat(0.3, 2.25, 0, 1, 1, 1, 0, 0, -0.12)); sub(b, LEAF_COLORS.lime, new THREE.ConeGeometry(2, 0.8, 6), mat(0.6, 4.5)); } },
  maquis: { variants: 2, scale: [0.7, 1.3], shadow: true, near: 200, far: 520,
    full: (b, rng) => addBush(b, new THREE.Matrix4(), { color: 'olive', flowers: rng() < 0.5 ? 0xf4f1e8 : null }, rng),
    low: (b) => sub(b, LEAF_COLORS.olive, new THREE.IcosahedronGeometry(0.7, 0), mat(0, 0.45, 0, 1, 0.7, 1)) },
  shrub: { variants: 2, scale: [0.7, 1.3], shadow: true, near: 200, far: 520,
    full: (b, rng) => addBush(b, new THREE.Matrix4(), { color: rng() < 0.5 ? 'fresh' : 'green' }, rng),
    low: (b) => sub(b, LEAF_COLORS.fresh, new THREE.IcosahedronGeometry(0.7, 0), mat(0, 0.45, 0, 1, 0.7, 1)) },
  heather: { variants: 2, scale: [0.5, 0.9], shadow: false, near: 200, far: 520,
    full: (b, rng) => addBush(b, new THREE.Matrix4(), { color: 0x7d6a5a, flowers: 0xb06aa8 }, rng),
    low: (b) => sub(b, 0x8a6a78, new THREE.IcosahedronGeometry(0.7, 0), mat(0, 0.4, 0, 1, 0.6, 1)) },
  grass: { variants: 2, scale: [0.8, 1.5], shadow: false, near: 160, far: 160,
    full: (b, rng) => addGrass(b, new THREE.Matrix4(), { color: rng() < 0.5 ? 'green' : 'lush' }, rng) },
  grassDry: { variants: 2, scale: [0.8, 1.5], shadow: false, near: 160, far: 160,
    full: (b, rng) => addGrass(b, new THREE.Matrix4(), { color: 'dry' }, rng) },
  rock: { variants: 3, scale: [0.4, 1.6], shadow: true, near: 600, far: 600,
    full: (b, rng) => addRock(b, new THREE.Matrix4(), { color: rng() < 0.5 ? 'gray' : 'grayBrown', cluster: rng() < 0.4 }, rng) },
  rockRed: { variants: 3, scale: [0.4, 1.6], shadow: true, near: 600, far: 600,
    full: (b, rng) => addRock(b, new THREE.Matrix4(), { color: rng() < 0.5 ? 'sandstone' : 0xa8735a, cluster: rng() < 0.4 }, rng) },
};

// вероятность в клетке 4×4 м: [дерево, куст, трава, камень]; трава в лугах и дюнах пробуется дважды
const DENSITY = {
  forest: [0.85, 0.2, 0.25, 0.01],
  scrub: [0.22, 0.6, 0.35, 0.03],
  meadow: [0.04, 0.06, 0.9, 0.005],
  dune: [0.012, 0.12, 0.6, 0.005],
  beach: [0.004, 0.01, 0.04, 0.012],
  rock: [0.03, 0.08, 0.12, 0.2],
  peak: [0, 0.05, 0.35, 0.14],
  settle: [0.03, 0.05, 0.5, 0],
};
const DOUBLE_GRASS = new Set(['meadow', 'dune']);
// пальмы на южных пляжах и дюнах растут рощами: шанс дерева там ×PALM_GROVE (у других биомов — прежний);
// на южной низине у берега (ниже PALM_H м) половина деревьев — пальмы
const PALM_H = 7, PALM_GROVE = 10, SHORE = new Set(['beach', 'dune']);
// деревья по биому и зоне ([вид, вес]); other — для всех прочих зон
const TREES = {
  south: { forest: [['cypress', 3], ['olive', 4], ['pine', 2]], scrub: [['olive', 3], ['cypress', 1]], dune: [['palm', 1]], beach: [['palm', 1]], other: [['olive', 2], ['cypress', 1]] },
  north: { forest: [['pine', 9], ['oak', 1]], other: [['pine', 1]] },
  atlantic: { forest: [['oak', 5], ['pine', 3]], scrub: [['oak', 1], ['pine', 1]], other: [['oak', 2], ['pine', 1]] },
};
const BUSH = { south: 'maquis', north: 'shrub', atlantic: 'heather' };

const pickW = (table, u) => {
  let t = u * table.reduce((a, e) => a + e[1], 0);
  for (const [id, w] of table) if ((t -= w) < 0) return id;
  return table[0][0];
};

// геометрия вида из PropBatch: position, color, normal
function protoGeometry(fn, rng) {
  const b = new PropBatch();
  fn(b, rng);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 3));
  g.computeVertexNormals();
  return g;
}

// bare — индексы островов (map.islands) без деревьев и кустов: голые скалы (камни рифов — всегда без них)
export function buildVegetation(hf, bio, occ, { density = 1, cell = 300, seed = 7, bare = new Set() } = {}) {
  const t0 = performance.now();
  const rng = mulberry32(seed);
  const [x0, z0, size] = hf.bounds, st = hf.step, W = hf.size, G = 4;
  const NC = Math.ceil(size / cell);
  // прототипы: по каждому виду variants полных и одна упрощённая
  const protos = {};
  for (const [id, k] of Object.entries(KINDS)) {
    const prng = mulberry32(seed * 31 + id.length * 7 + id.charCodeAt(0));
    protos[id] = {
      full: Array.from({ length: k.variants }, () => protoGeometry(k.full, prng)),
      low: k.low ? protoGeometry(k.low, prng) : null,
    };
  }
  // экземпляры: cells[ci][`${вид}:${вариант}`] = { m: [16 × n], c: [3 × n] }
  const cells = Array.from({ length: NC * NC }, () => ({}));
  const counts = {};
  const m4 = new THREE.Matrix4(), col = new THREE.Color();
  function add(id, x, y, z) {
    const k = KINDS[id], v = Math.floor(rng() * k.variants), s = k.scale[0] + rng() * (k.scale[1] - k.scale[0]);
    m4.makeRotationY(rng() * Math.PI * 2).scale(new THREE.Vector3(s, s * (0.9 + rng() * 0.2), s)).setPosition(x, y, z);
    const l = 0.88 + rng() * 0.22;
    col.setRGB(l * (1 + (rng() - 0.5) * 0.08), l, l * (1 + (rng() - 0.5) * 0.08));
    const ci = Math.min(NC - 1, Math.floor((z - z0) / cell)) * NC + Math.min(NC - 1, Math.floor((x - x0) / cell));
    const key = `${id}:${v}`, bin = cells[ci][key] ?? (cells[ci][key] = { id, v, m: [], c: [] });
    bin.m.push(...m4.elements);
    bin.c.push(col.r, col.g, col.b);
    counts[id] = (counts[id] ?? 0) + 1;
  }

  const n = Math.floor(size / G);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const cx = x0 + i * G, cz = z0 + j * G;
      // грубая проверка: суша в углу клетки или рядом
      const hc = hf.sample(cx + G / 2, cz + G / 2);
      if (hc < 0.2) continue;
      const k = Math.round((cz + G / 2 - z0) / st) * W + Math.round((cx + G / 2 - x0) / st);
      const zone = ZONES[bio.zone[k]], D = DENSITY[zone];
      if (!D) continue;
      const m = bio.moist[k] / 255;
      const tries = [
        [0, Math.min(0.95, D[0] * (0.45 + 1.1 * m) * (SHORE.has(zone) ? PALM_GROVE : 1)) * density, 0.75],
        [1, D[1] * density, 1.0],
        [2, D[2] * density, 1.3],
        [3, D[3] * density, 9],
      ];
      if (DOUBLE_GRASS.has(zone)) tries.push([2, D[2] * density, 1.3]);
      for (const [type, p, maxSlope] of tries) {
        if (rng() >= p) continue;
        const x = cx + rng() * G, z = cz + rng() * G, h = hf.sample(x, z);
        if (h < 0.35 || occ.at(x, z)) continue;
        if (maxSlope < 9 && hf.slope(x, z, 2) > maxSlope) continue;
        let biome = bio.pickBiome(x, z, rng());
        if (!TREES[biome]) biome = 'atlantic';
        if (type === 0 && SHORE.has(zone) && biome !== 'south' && rng() * PALM_GROVE >= 1) continue;
        let id;
        if (type < 2 && (bare.has(hf.owner[k]) || hf.material[k] === MAT.rock)) continue; // и камни рифов над водой
        if (type === 0) {
          if (h < 1.2 && zone !== 'beach' && zone !== 'dune') continue;
          const t = TREES[biome];
          id = biome === 'south' && h < PALM_H && zone !== 'forest' && rng() < 0.5 ? 'palm' : pickW(t[zone] ?? t.other, rng());
        } else if (type === 1) id = biome === 'atlantic' && zone === 'forest' ? 'shrub' : BUSH[biome];
        else if (type === 2) id = biome === 'south' || zone === 'dune' || zone === 'peak' ? 'grassDry' : 'grass';
        else id = biome === 'south' ? 'rockRed' : 'rock';
        add(id, x, h - (type === 0 ? 0.25 : type === 3 ? 0.3 : 0.05), z);
      }
    }
  }

  // меши: на ячейку и вид×вариант пара near/far с общими матрицами и цветами
  const group = new THREE.Group();
  const material = propMaterial();
  const cellList = [];
  let instances = 0, fullTris = 0;
  cells.forEach((bins, ci) => {
    const keys = Object.keys(bins);
    if (!keys.length) return;
    const cg = new THREE.Group(), meshes = [];
    for (const key of keys) {
      const { id, v, m, c } = bins[key], k = KINDS[id], cnt = c.length / 3;
      const near = new THREE.InstancedMesh(protos[id].full[v], material, cnt);
      near.instanceMatrix.array.set(m);
      near.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(c), 3);
      near.castShadow = k.shadow;
      near.receiveShadow = true;
      near.computeBoundingSphere();
      cg.add(near);
      let far = null;
      if (protos[id].low) {
        far = new THREE.InstancedMesh(protos[id].low, material, cnt);
        far.instanceMatrix = near.instanceMatrix;
        far.instanceColor = near.instanceColor;
        far.castShadow = k.shadow;
        far.receiveShadow = true;
        far.boundingSphere = near.boundingSphere;
        far.visible = false;
        cg.add(far);
      }
      meshes.push({ k, near, far });
      instances += cnt;
      fullTris += cnt * protos[id].full[v].attributes.position.count / 3;
    }
    const cx = x0 + (ci % NC + 0.5) * cell, cz = z0 + (Math.floor(ci / NC) + 0.5) * cell;
    cellList.push({ cx, cz, meshes });
    group.add(cg);
  });

  // LOD: расстояние от камеры до прямоугольника ячейки (с высотой камеры)
  const half = cell / 2;
  function update(cam, lod = true) {
    for (const c of cellList) {
      const d = Math.hypot(Math.max(0, Math.abs(cam.x - c.cx) - half), Math.max(0, Math.abs(cam.z - c.cz) - half), cam.y);
      for (const { k, near, far } of c.meshes) {
        if (!lod) { near.visible = true; if (far) far.visible = false; continue; }
        near.visible = d < k.near;
        if (far) far.visible = d >= k.near && d < k.far;
      }
    }
  }

  const tris = (id) => protos[id].full.reduce((a, g) => a + g.attributes.position.count / 3, 0) / protos[id].full.length;
  const protoTris = Object.fromEntries(Object.keys(KINDS).map((id) => [id, [Math.round(tris(id)), protos[id].low ? protos[id].low.attributes.position.count / 3 : null]]));
  return { group, update, counts, protoTris, stats: { instances, fullTris, cells: cellList.length, meshes: cellList.reduce((a, c) => a + c.meshes.length, 0), ms: performance.now() - t0 } };
}
