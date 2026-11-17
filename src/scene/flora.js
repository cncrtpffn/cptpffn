import * as THREE from 'three';

// Параметрические объекты для островов: деревья, кусты, трава, скалы.
// Все строятся в PropBatch — один меш с цветами вершин на остров, чтобы не плодить draw call'ы.
// Размер задаётся `scale`, цвета — опциями (hex или имя из палитры ниже).

export const LEAF_COLORS = {
  green: 0x3f7d4e, fresh: 0x5e9a52, deep: 0x2f6544, olive: 0x7a8f45, lime: 0x8fb04a, autumn: 0xc9813a, red: 0xb5523b,
};
export const ROCK_COLORS = {
  gray: 0x9a9a92, grayBrown: 0x8c7f70, sandstone: 0xc4a47c, dark: 0x6d6e6a, white: 0xd8d4c8,
};
export const TRUNK_COLORS = { brown: 0x8a5a3c, dark: 0x5e3f2a, palm: 0xa3845c, birch: 0xe8e2d4 };
export const GRASS_COLORS = { green: 0x7fb069, lush: 0x5f9a4a, dry: 0xb8b46a };
export const FLOWER_COLORS = [0xf2c14e, 0xe9553b, 0xf4f1e8, 0xc77dce];

const resolve = (c, palette) => (typeof c === 'string' ? palette[c] : c);

// Цвет с небольшим разбросом по тону/насыщенности/яркости.
export function jitterColor(hex, rng, amount = 1) {
  return new THREE.Color(hex).offsetHSL(
    (rng() - 0.5) * 0.03 * amount, (rng() - 0.5) * 0.12 * amount, (rng() - 0.5) * 0.1 * amount);
}

const _e = new THREE.Euler(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
export function mat(x = 0, y = 0, z = 0, sx = 1, sy = sx, sz = sx, rx = 0, ry = 0, rz = 0) {
  return new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
}

export class PropBatch {
  constructor() { this.pos = []; this.col = []; }

  // geo — любая BufferGeometry; color — hex/Color; m — матрица в СК батча; faceJitter — разброс цвета по граням.
  add(geo, color, m, rng = null, faceJitter = 0) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const p = g.attributes.position;
    const v = new THREE.Vector3();
    const base = color instanceof THREE.Color ? color : new THREE.Color(color);
    let c = base;
    for (let i = 0; i < p.count; i++) {
      if (faceJitter && rng && i % 3 === 0) c = base.clone().offsetHSL(0, 0, (rng() - 0.5) * 0.08 * faceJitter);
      v.fromBufferAttribute(p, i).applyMatrix4(m);
      this.pos.push(v.x, v.y, v.z);
      this.col.push(c.r, c.g, c.b);
    }
  }

  toMesh(material) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    geo.computeVertexNormals();
    return new THREE.Mesh(geo, material);
  }
}

export const propMaterial = () => new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });

// --- деревья ---------------------------------------------------------------
// opts: { scale = 1, leaf, trunk }; base — матрица установки (позиция на земле, поворот).

function pine(b, base, o, rng) {
  const leaf = resolve(o.leaf ?? 'green', LEAF_COLORS), trunk = resolve(o.trunk ?? 'brown', TRUNK_COLORS);
  b.add(new THREE.CylinderGeometry(0.16, 0.26, 1.8, 5), jitterColor(trunk, rng), base.clone().multiply(mat(0, 0.9)));
  const tiers = 3 + (rng() < 0.4 ? 1 : 0);
  for (let i = 0; i < tiers; i++) {
    const k = i / tiers;
    const r = 1.55 * (1 - k * 0.55), h = 2.1 * (1 - k * 0.3);
    const c = jitterColor(leaf, rng, 0.6).offsetHSL(0, 0, -0.04 + k * 0.05);
    b.add(new THREE.ConeGeometry(r, h, 7), c, base.clone().multiply(mat(0, 1.6 + i * 1.15 + h / 2, 0, 1, 1, 1, 0, rng() * 3)));
  }
}

function oak(b, base, o, rng) {
  const leaf = resolve(o.leaf ?? 'fresh', LEAF_COLORS), trunk = resolve(o.trunk ?? 'brown', TRUNK_COLORS);
  b.add(new THREE.CylinderGeometry(0.2, 0.34, 2.2, 6), jitterColor(trunk, rng), base.clone().multiply(mat(0, 1.1)));
  const lean = (rng() - 0.5) * 0.8;
  b.add(new THREE.CylinderGeometry(0.08, 0.13, 1.2, 5), jitterColor(trunk, rng),
    base.clone().multiply(mat(0.35, 2.0, 0, 1, 1, 1, 0, lean, -0.8)));
  const blobs = 4 + Math.floor(rng() * 3);
  for (let i = 0; i < blobs; i++) {
    const a = (i / blobs) * Math.PI * 2 + rng();
    const rr = i === 0 ? 0 : 0.7 + rng() * 0.5;
    const s = i === 0 ? 1.5 : 0.9 + rng() * 0.5;
    b.add(new THREE.IcosahedronGeometry(1, 0), jitterColor(leaf, rng, 0.8),
      base.clone().multiply(mat(Math.cos(a) * rr, 3.1 + (i === 0 ? 0.4 : rng() * 0.9), Math.sin(a) * rr, s, s * 0.85, s, rng() * 3, rng() * 3, 0)));
  }
}

function palm(b, base, o, rng) {
  const leaf = resolve(o.leaf ?? 'lime', LEAF_COLORS), trunk = resolve(o.trunk ?? 'palm', TRUNK_COLORS);
  const seg = 6, segH = 0.75;
  const bend = 0.06 + rng() * 0.08;
  let x = 0, y = 0, ang = 0;
  for (let i = 0; i < seg; i++) {
    const r0 = 0.2 - i * 0.015;
    const cx = x + Math.sin(ang) * segH / 2, cy = y + Math.cos(ang) * segH / 2;
    b.add(new THREE.CylinderGeometry(r0 - 0.02, r0, segH * 1.05, 5), jitterColor(trunk, rng, 0.6).offsetHSL(0, 0, (i % 2) * 0.04),
      base.clone().multiply(mat(cx, cy, 0, 1, 1, 1, 0, 0, -ang)));
    x += Math.sin(ang) * segH; y += Math.cos(ang) * segH;
    ang += bend;
  }
  const fronds = 7 + Math.floor(rng() * 3);
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * Math.PI * 2 + rng() * 0.4;
    const droop = 0.5 + rng() * 0.5;
    // лист: сплюснутый конус, вершиной наружу и вниз
    const m = base.clone().multiply(mat(x, y, 0, 1, 1, 1, 0, a, 0)).multiply(mat(0, 0, 0, 1, 1, 1, 0, 0, -Math.PI / 2 - droop * 0.6))
      .multiply(mat(0, 1.1, 0, 0.08, 1.2, 0.42));
    b.add(new THREE.ConeGeometry(1, 2, 4), jitterColor(leaf, rng, 0.7), m);
  }
  for (let i = 0; i < 3; i++) {
    const a = i * 2.1 + rng();
    b.add(new THREE.IcosahedronGeometry(0.13, 0), 0x6e4a2b, base.clone().multiply(mat(x + Math.cos(a) * 0.18, y - 0.15, Math.sin(a) * 0.18)));
  }
}

function cypress(b, base, o, rng) {
  const leaf = resolve(o.leaf ?? 'deep', LEAF_COLORS), trunk = resolve(o.trunk ?? 'dark', TRUNK_COLORS);
  b.add(new THREE.CylinderGeometry(0.12, 0.2, 1.2, 5), jitterColor(trunk, rng), base.clone().multiply(mat(0, 0.6)));
  const h = 4.2 + rng() * 1.2;
  b.add(new THREE.IcosahedronGeometry(1, 1), jitterColor(leaf, rng, 0.6), base.clone().multiply(mat(0, 0.9 + h / 2, 0, 0.75, h / 2, 0.75)), rng, 0.8);
  b.add(new THREE.ConeGeometry(0.45, 1.0, 6), jitterColor(leaf, rng, 0.6).offsetHSL(0, 0, 0.03), base.clone().multiply(mat(0, 0.9 + h + 0.2)));
}

export const TREE_KINDS = { pine, oak, palm, cypress };

export function addTree(batch, kind, base, opts = {}, rng = Math.random) {
  const s = opts.scale ?? 1;
  TREE_KINDS[kind](batch, base.clone().multiply(mat(0, 0, 0, s)), opts, rng);
}

// --- кусты, трава, скалы ---------------------------------------------------

// opts: { scale = 1, color, flowers: hex | true | null }
export function addBush(batch, base, opts = {}, rng = Math.random) {
  const s = opts.scale ?? 1;
  const color = resolve(opts.color ?? 'fresh', LEAF_COLORS);
  const m0 = base.clone().multiply(mat(0, 0, 0, s));
  const blobs = 2 + Math.floor(rng() * 3);
  const centers = [];
  for (let i = 0; i < blobs; i++) {
    const a = rng() * Math.PI * 2, rr = i ? 0.35 + rng() * 0.25 : 0;
    const r = 0.45 + rng() * 0.3;
    const c = [Math.cos(a) * rr, r * 0.6, Math.sin(a) * rr, r];
    centers.push(c);
    batch.add(new THREE.IcosahedronGeometry(1, 0), jitterColor(color, rng, 0.8), m0.clone().multiply(mat(c[0], c[1], c[2], r, r * 0.75, r, rng() * 3, rng() * 3, 0)));
  }
  if (opts.flowers) {
    const fc = opts.flowers === true ? FLOWER_COLORS[Math.floor(rng() * FLOWER_COLORS.length)] : opts.flowers;
    for (let i = 0; i < 6; i++) {
      const c = centers[Math.floor(rng() * centers.length)];
      const a = rng() * Math.PI * 2, el = rng() * 1.2;
      batch.add(new THREE.IcosahedronGeometry(0.07, 0), fc,
        m0.clone().multiply(mat(c[0] + Math.cos(a) * Math.cos(el) * c[3], c[1] + Math.sin(el) * c[3] * 0.75, c[2] + Math.sin(a) * Math.cos(el) * c[3])));
    }
  }
}

// opts: { scale = 1, color }
export function addGrass(batch, base, opts = {}, rng = Math.random) {
  const s = opts.scale ?? 1;
  const color = resolve(opts.color ?? 'green', GRASS_COLORS);
  const blades = 4 + Math.floor(rng() * 4);
  for (let i = 0; i < blades; i++) {
    const a = rng() * Math.PI * 2, h = (0.35 + rng() * 0.35) * s;
    const tilt = 0.15 + rng() * 0.35;
    const m = base.clone().multiply(mat(Math.cos(a) * 0.12 * s, 0, Math.sin(a) * 0.12 * s, 1, 1, 1, 0, -a, 0))
      .multiply(mat(0, 0, 0, 1, 1, 1, tilt, 0, 0)).multiply(mat(0, h / 2, 0, s, 1, s));
    batch.add(new THREE.ConeGeometry(0.05, h, 3, 1, true), jitterColor(color, rng, 1.2), m);
  }
}

// Неровный камень: додекаэдр/икосаэдр со смещёнными вершинами (совпадающие вершины смещаются одинаково).
function rockGeometry(rng, detail) {
  const g = detail ? new THREE.IcosahedronGeometry(1, 1) : new THREE.DodecahedronGeometry(1, 0);
  const p = g.attributes.position;
  const offs = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!offs.has(key)) offs.set(key, 0.75 + rng() * 0.45);
    const k = offs.get(key);
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
  }
  return g;
}

// opts: { scale = 1, color, flat = 0.65 (сплюснутость по высоте), cluster = false }
export function addRock(batch, base, opts = {}, rng = Math.random) {
  const s = opts.scale ?? 1;
  const color = resolve(opts.color ?? 'gray', ROCK_COLORS);
  const flat = opts.flat ?? 0.65;
  const pieces = opts.cluster ? 2 + Math.floor(rng() * 3) : 1;
  for (let i = 0; i < pieces; i++) {
    const r = i === 0 ? 1 : 0.35 + rng() * 0.35;
    const a = rng() * Math.PI * 2, d = i === 0 ? 0 : 0.9 + rng() * 0.5;
    const m = base.clone().multiply(mat(Math.cos(a) * d * s, r * flat * s * 0.35, Math.sin(a) * d * s,
      r * s * (0.9 + rng() * 0.4), r * s * flat, r * s * (0.9 + rng() * 0.4), (rng() - 0.5) * 0.4, rng() * 6, (rng() - 0.5) * 0.4));
    batch.add(rockGeometry(rng, rng() < 0.4), jitterColor(color, rng, 0.7), m, rng, 1);
  }
}

// Отдельный меш одного объекта — например, для расстановки вручную.
// kind: 'pine' | 'oak' | 'palm' | 'cypress' | 'bush' | 'grass' | 'rock'
export function createProp(kind, opts = {}, rng = Math.random) {
  const b = new PropBatch();
  const base = new THREE.Matrix4();
  if (TREE_KINDS[kind]) addTree(b, kind, base, opts, rng);
  else if (kind === 'bush') addBush(b, base, opts, rng);
  else if (kind === 'grass') addGrass(b, base, opts, rng);
  else if (kind === 'rock') addRock(b, base, opts, rng);
  const mesh = b.toMesh(propMaterial());
  mesh.castShadow = kind !== 'grass';
  return mesh;
}
