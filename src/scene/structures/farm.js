import * as THREE from 'three';
import { jitterColor } from '../flora.js';
import { palette, pick, at, box, cyl, beam, gable, pile, triGeo, faceFrame, windowAt, doorAt } from './kit.js';
import { boat } from './harbor.js';

// Хозяйство (категория C каталога docs/changes/structures-library/catalog.md).
// СК объекта: фасад к +Z, начало на земле в центре; boathouse — у воды (начало на кромке, вода в +Z).

const WOOD = 0x8f7a62, DARK = 0x5c4a3a, IRON = 0x2b2b2b, ROPE = 0xc9b48a, WATER = 0x5f8fa8, SEABED = -3.2;
const LOG = 0xa07a52, HAY = 0xd9bf6a, CANVAS = 0xeee6d4;

// Стена сарая по стилю: south — камень/штукатурка, north — фалунский красный, atlantic — серая обшивка
const shedWall = (s, p, rng) => jitterColor(s === 'south' ? pick([p.stone, p.wall[1]], rng) : s === 'north' ? p.wall[0] : 0xa8a49a, rng, 0.5);

// Колесо в плоскости YZ: обод, ступица, три спицы-перекладины
function wheel(b, base, x, y, z, r = 0.6) {
  b.add(new THREE.TorusGeometry(r - 0.05, 0.05, 4, 12), DARK, at(base, x, y, z, 1, 1, 1, 0, Math.PI / 2, 0));
  cyl(b, at(base, x, y, z, 1, 1, 1, 0, 0, Math.PI / 2), IRON, 0, -0.1, 0, 0.09, 0.09, 0.2, 6);
  for (let i = 0; i < 3; i++) box(b, at(base, x, y, z, 1, 1, 1, (i / 3) * Math.PI, 0, 0), WOOD, 0, -(r - 0.05), 0, 0.04, 2 * (r - 0.05), 0.05);
}

// Крыло мельницы: от ступицы m (повёрнута на угол крыла) вдоль локальной X, длина L, полотно с одной стороны
function sail(b, m, L, cloth, frame) {
  box(b, m, frame, L / 2, -0.06, 0, L, 0.12, 0.12);
  box(b, m, cloth, L * 0.58, 0.06, 0.04, L * 0.78, 1.1, 0.03);
  for (let i = 0; i < 4; i++) box(b, m, frame, L * 0.22 + i * L * 0.25, 0.06, 0.07, 0.05, 1.15, 0.04);
}

function shed(b, base, o, rng) {
  const s = o.style ?? 'atlantic', p = palette(s), W = 4, D = 3, H = 2.3, wall = shedWall(s, p, rng);
  const roof = s === 'north' ? pick([p.roof[0], p.roof[2]], rng) : pick(p.roof, rng);
  if (o.variant === 1) { // односкатный: высокая сторона — фасад
    box(b, base, wall, 0, 0, 0, W, H - 0.5, D);
    box(b, base, wall, 0, H - 0.5, D / 2 - 0.08, W, 0.85, 0.16);
    // боковые клинья под скатом (в обе стороны обхода — видны с любой стороны)
    for (const x of [-W / 2, W / 2]) {
      const t = [[x, H - 0.5, -D / 2], [x, H - 0.5, D / 2], [x, H + 0.35, D / 2]];
      b.add(triGeo([t, [t[0], t[2], t[1]]]), wall, base);
    }
    beam(b, base, roof, [0, H + 0.45, D / 2 + 0.3], [0, H - 0.5, -D / 2 - 0.3], W + 0.4, 0.1);
  } else {
    box(b, base, wall, 0, 0, 0, W, H, D);
    gable(b, base, { w: W, d: D, y: H, h: 1.1, over: 0.25, t: 0.08, roof, wall });
  }
  if (s === 'atlantic') for (let y = 0.3; y < H; y += 0.3) box(b, base, jitterColor(wall, rng, 0.4).offsetHSL(0, 0, -0.05), 0, y, 0, W + 0.04, 0.04, D + 0.04);
  const f = faceFrame(base, '+z', D / 2);
  doorAt(b, f, -0.6, { w: 1.3, h: 1.9, color: s === 'north' ? 0x6e4a30 : WOOD, frame: s === 'south' ? p.trim : p.trim });
  beam(b, f, p.trim, [-1.2, 0.1, 0.09], [0, 1.9, 0.09], 0.02, 0.08); // раскос на воротах
  windowAt(b, faceFrame(base, '+x', W / 2), 0, 1.4, { ww: 0.5, wh: 0.5, frame: p.trim, glass: p.glass, sill: false, mullion: false });
}

// Лодочный сарай: вариант 0 — на сваях над водой, 1 — на берегу со скатом в воду.
// north — фалунский красный, south — камень с аркой ворот, atlantic — серая обшивка.
function boathouse(b, base, o, rng) {
  const s = o.style ?? 'atlantic', p = palette(s), W = 5, D = 8, H = 3.2, wall = shedWall(s, p, rng);
  const roof = s === 'north' ? pick([p.roof[0], p.roof[2]], rng) : pick(p.roof, rng);
  const onPiles = o.variant !== 1, zc = onPiles ? 1.5 : -D / 2 - 0.5, y0 = onPiles ? 0.6 : 0;
  if (onPiles) {
    for (const x of [-W / 2 + 0.2, W / 2 - 0.2]) for (let z = zc - D / 2 + 0.3; z <= zc + D / 2; z += 2.5) pile(b, base, DARK, x, z, SEABED, y0, 0.14);
    // мостки вдоль боков внутри, середина — вода для лодки
    for (const x of [-W / 2 + 0.55, W / 2 - 0.55]) box(b, base, WOOD, x, y0 - 0.1, zc, 0.9, 0.1, D);
  } else box(b, base, p.stone, 0, -0.2, zc, W + 0.2, 0.3, D + 0.2);
  // стены: боковые и задняя, фронтон над воротами
  for (const k of [-1, 1]) box(b, base, wall, k * (W / 2 - 0.08), y0, zc, 0.16, H, D);
  box(b, base, wall, 0, y0, zc - D / 2 + 0.08, W, H, 0.16);
  box(b, base, wall, 0, y0 + 2.6, zc + D / 2 - 0.08, W, H - 2.6, 0.16);
  gable(b, base, { z: zc, w: D, d: W, y: y0 + H, h: 2.2, over: 0.3, roof, wall, ry: Math.PI / 2 });
  if (s === 'atlantic') for (let y = y0 + 0.3; y < y0 + H; y += 0.32) box(b, base, jitterColor(wall, rng, 0.4).offsetHSL(0, 0, -0.05), 0, y, zc, W + 0.04, 0.04, D + 0.04);
  const zf = zc + D / 2;
  if (s === 'south') { // каменная арка над воротами
    b.add(new THREE.CylinderGeometry(1.75, 1.75, 0.3, 10, 1, false, -Math.PI / 2, Math.PI), p.trim, at(base, 0, y0 + 2.0, zf, 1, 1, 1, -Math.PI / 2, 0, 0));
    b.add(new THREE.CylinderGeometry(1.5, 1.5, 0.34, 10, 1, false, -Math.PI / 2, Math.PI), 0x2a2622, at(base, 0, y0 + 2.0, zf, 1, 1, 1, -Math.PI / 2, 0, 0));
  } else for (const k of [-1, 1]) box(b, base, s === 'north' ? 0xf4f1e8 : DARK, k * 1.6, y0, zf + 0.05, 0.12, 2.6, 0.12); // наличник ворот
  windowAt(b, faceFrame(base, '+x', W / 2, 0, zc), 0, y0 + 1.8, { ww: 0.6, wh: 0.5, frame: p.trim, glass: p.glass, sill: false, mullion: false });
  if (onPiles) boat(b, at(base, 0, 0.12, zc + 0.5), rng, { L: 4.4, B: 1.4, D: 0.6 });
  else { // скат и лодка на нём
    const z0 = zf, z1 = 6;
    for (const x of [-0.8, 0.8]) beam(b, base, DARK, [x, 0, z0 - D + 1], [x, -1.6, z1], 0.2, 0.18);
    for (let z = z0 - D + 1.5; z < z1; z += 1.2) box(b, base, DARK, 0, -1.6 * Math.max(0, (z - z0 + D - 1) / (z1 - z0 + D - 1)) - 0.12, z, 2.0, 0.1, 0.2);
    boat(b, at(base, 0, 0.35, zc + 1, 1, 1, 1, 0.05, 0, 0), rng, { L: 4.4, B: 1.4, D: 0.6 });
  }
}

// Ветряная мельница. south — каменная башня с шатром и полотняными крыльями; north, atlantic — козловая деревянная.
function windmill(b, base, o, rng) {
  const s = o.style ?? 'atlantic', p = palette(s), ang = rng() * Math.PI / 2;
  let hub;
  if (s === 'south') {
    const H = 7, r0 = 2.6, r1 = 2.0;
    cyl(b, base, jitterColor(p.wall[3], rng, 0.4), 0, 0, 0, r1, r0, H, 12);
    cyl(b, base, p.stone, 0, H - 0.2, 0, r1 + 0.15, r1 + 0.15, 0.25, 12);
    b.add(new THREE.ConeGeometry(r1 + 0.3, 2.2, 12), 0x7a6a50, at(base, 0, H + 1.1, 0));
    doorAt(b, faceFrame(base, '+z', r0 - 0.05), 0, { w: 0.9, h: 1.9, color: p.door, frame: p.stone });
    for (const y of [3.2, 5.4]) windowAt(b, faceFrame(base, '+z', r0 - (r0 - r1) * y / H - 0.05), 0.8, y, { ww: 0.4, wh: 0.55, frame: p.stone, glass: p.glass, sill: false, mullion: false });
    hub = [0, H + 0.7, r1 + 0.5];
    beam(b, base, DARK, [0, H + 0.7, 0], hub, 0.25, 0.25);
  } else {
    const W = 3.2, D = 4.2, y0 = 2.6, H = 4.0, wall = jitterColor(s === 'north' ? p.wall[0] : 0xa8a49a, rng, 0.4);
    cyl(b, base, DARK, 0, 0, 0, 0.25, 0.3, y0, 8); // стояк
    for (const [x, z] of [[-1.6, 0], [1.6, 0], [0, -1.6], [0, 1.6]]) beam(b, base, DARK, [x, 0.3, z], [0, 1.7, 0], 0.18, 0.18);
    box(b, base, DARK, 0, 0, 0, 3.4, 0.3, 0.3); box(b, base, DARK, 0, 0, 0, 0.3, 0.3, 3.4); // крестовина
    box(b, base, wall, 0, y0, 0, W, H, D);
    gable(b, base, { w: D, d: W, y: y0 + H, h: 1.3, over: 0.2, t: 0.08, roof: p.roof[0], wall, ry: Math.PI / 2 });
    doorAt(b, faceFrame(base, '-z', D / 2), 0, { w: 0.8, h: 1.7, y0: y0 + 0.2, color: p.door, frame: p.trim });
    beam(b, base, DARK, [-0.4, y0 + 0.2, -D / 2], [-0.4, 0, -D / 2 - 2.6], 0.12, 0.08); // лестница
    beam(b, base, DARK, [0.4, y0 + 0.2, -D / 2], [0.4, 0, -D / 2 - 2.6], 0.12, 0.08);
    beam(b, base, DARK, [0, y0 + 0.6, -D / 2], [0, 0.4, -D / 2 - 3.6], 0.18, 0.18); // хвостовой рычаг
    hub = [0, y0 + H - 0.6, D / 2 + 0.4];
  }
  cyl(b, at(base, ...hub, 1, 1, 1, Math.PI / 2, 0, 0), DARK, 0, -0.3, 0, 0.25, 0.25, 0.5, 8);
  const L = s === 'south' ? 5.2 : 4.4, cloth = s === 'south' ? CANVAS : jitterColor(0xe6dcc3, rng, 0.5);
  for (let i = 0; i < 4; i++) sail(b, at(base, hub[0], hub[1], hub[2] + 0.25, 1, 1, 1, 0, 0, ang + i * Math.PI / 2), L, cloth, s === 'south' ? DARK : 0xd8cfbf);
}

// Колодец. south — каменный сруб с воротом; north — журавль; atlantic — ворот под двускатной крышей.
function well(b, base, o, rng) {
  const s = o.style ?? 'atlantic', p = palette(s);
  const windlass = (y) => {
    cyl(b, at(base, 0, y, 0, 1, 1, 1, 0, 0, Math.PI / 2), WOOD, 0, -0.75, 0, 0.1, 0.1, 1.5, 6);
    beam(b, base, IRON, [0.8, y, 0], [0.85, y - 0.35, 0], 0.04, 0.04);
    beam(b, base, ROPE, [0, y, 0], [0, y - 0.9, 0], 0.02, 0.02);
    cyl(b, base, WOOD, 0, y - 1.15, 0, 0.16, 0.13, 0.25, 6); // ведро
  };
  if (s === 'south') {
    cyl(b, base, jitterColor(p.stone, rng, 0.5), 0, 0, 0, 0.85, 0.9, 0.85, 10);
    cyl(b, base, p.trim, 0, 0.85, 0, 0.92, 0.92, 0.08, 10);
    cyl(b, base, WATER, 0, 0.9, 0, 0.7, 0.7, 0.02, 10);
    for (const k of [-1, 1]) box(b, base, p.stone, k * 0.8, 0.85, 0, 0.25, 1.15, 0.3);
    box(b, base, p.stone, 0, 2.0, 0, 1.9, 0.15, 0.35);
    windlass(1.6);
  } else if (s === 'north') { // журавль: сруб, рогатина, шест с противовесом
    for (let i = 0; i < 4; i++) {
      const y = i * 0.2;
      box(b, base, jitterColor(LOG, rng), 0, y, 0.5, 1.2, 0.2, 0.18); box(b, base, jitterColor(LOG, rng), 0, y, -0.5, 1.2, 0.2, 0.18);
      box(b, base, jitterColor(LOG, rng), 0.5, y + 0.1, 0, 0.18, 0.2, 1.2); box(b, base, jitterColor(LOG, rng), -0.5, y + 0.1, 0, 0.18, 0.2, 1.2);
    }
    box(b, base, WATER, 0, 0.7, 0, 0.82, 0.02, 0.82);
    const px = -2.2, py = 2.8;
    cyl(b, base, DARK, px, 0, 0, 0.12, 0.15, py, 6);
    for (const k of [-1, 1]) beam(b, base, DARK, [px, py - 0.1, 0], [px, py + 0.3, k * 0.25], 0.08, 0.08);
    const a = [px - 1.6, py - 1.0, 0], e = [px + 2.3, py + 1.45, 0];
    beam(b, base, LOG, a, e, 0.09, 0.09);
    box(b, base, p.stone, a[0], a[1] - 0.45, 0, 0.45, 0.45, 0.4); // противовес
    beam(b, base, LOG, e, [e[0], 1.3, 0], 0.04, 0.04);
    cyl(b, base, WOOD, e[0], 1.05, 0, 0.16, 0.13, 0.25, 6);
  } else {
    box(b, base, WOOD, 0, 0, 0, 1.2, 0.8, 1.2);
    box(b, base, WATER, 0, 0.78, 0, 0.9, 0.02, 0.9);
    for (const k of [-1, 1]) box(b, base, WOOD, k * 0.65, 0, 0, 0.12, 2.1, 0.12);
    gable(b, base, { w: 1.6, d: 1.4, y: 2.1, h: 0.55, over: 0.1, t: 0.06, roof: pick(p.roof, rng) });
    windlass(1.55);
  }
}

// Сушилка сетей: стойки через 2 м, две жерди, сети и поплавки. params.length
function netRack(b, base, o, rng) {
  const L = o.length ?? 6, n = Math.max(2, Math.round(L / 2));
  for (let i = 0; i <= n; i++) pile(b, base, DARK, -L / 2 + i * L / n, 0, 0, 2.4, 0.07, 5);
  for (const y of [1.5, 2.3]) box(b, base, LOG, 0, y, 0, L + 0.3, 0.08, 0.08);
  for (let i = 0; i < n; i++) {
    const x = -L / 2 + (i + 0.5) * L / n, w = L / n - 0.3 - rng() * 0.3, h = 1.2 + rng() * 0.6;
    box(b, base, jitterColor(0x6b5a45, rng, 1.2), x, 2.3 - h, 0.06, w, h, 0.03);
    for (let k = 0; k < 3; k++) box(b, base, 0xc9a24a, x - w / 2 + (k + 0.5) * w / 3, 2.15, 0.1, 0.12, 0.1, 0.06);
  }
}

// Поленница: ряды поленьев, торцы, колья; вариант 1 — под навесом
function woodpile(b, base, o, rng) {
  const L = 3, H = 1.4;
  for (let y = 0; y < H; y += 0.2) box(b, base, jitterColor(LOG, rng, 1.2), 0, y, 0, L - rng() * 0.2, 0.2, 0.8);
  for (let i = 0; i < 7; i++) {
    cyl(b, at(base, -L / 2 + 0.3 + rng() * (L - 0.6), 0.1 + Math.floor(rng() * 7) * 0.2, 0.4, 1, 1, 1, Math.PI / 2, 0, 0), 0xd8b585, 0, 0, 0, 0.1, 0.1, 0.04, 6);
  }
  for (const k of [-1, 1]) pile(b, base, DARK, k * (L / 2 + 0.06), 0, 0, H + 0.1, 0.05, 5);
  if (o.variant === 1) {
    for (const k of [-1, 1]) { pile(b, base, DARK, k * (L / 2 + 0.1), 0.55, 0, 2.0, 0.06, 5); pile(b, base, DARK, k * (L / 2 + 0.1), -0.55, 0, 1.75, 0.06, 5); }
    beam(b, base, WOOD, [0, 2.05, 0.75], [0, 1.75, -0.75], L + 0.6, 0.06);
  }
}

// Ограда, сегмент 4 м вдоль X. south — каменная кладка; north — жерди; atlantic — белый штакетник. Вариант 1 — калитка.
function fence(b, base, o, rng) {
  const s = o.style ?? 'atlantic', p = palette(s), gate = o.variant === 1;
  const spans = gate ? [[-2, -0.55], [0.55, 2]] : [[-2, 2]];
  for (const [x0, x1] of spans) {
    const w = x1 - x0, cx = (x0 + x1) / 2;
    if (s === 'south') {
      for (const [y, h] of [[0, 0.5], [0.5, 0.45]]) {
        const n = Math.max(1, Math.round(w / 0.7));
        for (let i = 0; i < n; i++) box(b, base, jitterColor(p.stone, rng, 1.2), x0 + (i + 0.5) * w / n + (y ? 0.1 : 0), y, 0, w / n - 0.03, h, 0.45);
      }
      box(b, base, jitterColor(p.stone, rng, 0.5).offsetHSL(0, 0, -0.06), cx, 0.95, 0, w + 0.05, 0.1, 0.55);
    } else if (s === 'north') {
      const n = Math.max(1, Math.round(w / 1.3));
      for (let i = 0; i <= n; i++) for (const z of [-0.08, 0.08]) pile(b, base, DARK, x0 + i * w / n, z, 0, 1.3, 0.04, 5);
      for (let i = 0; i < n; i++) for (const y of [0.4, 0.75, 1.1]) {
        const xa = x0 + i * w / n, xb = xa + w / n;
        beam(b, base, jitterColor(0x9a8a72, rng), [xa, y - 0.12, 0], [xb, y + 0.12, 0], 0.06, 0.06);
      }
    } else {
      for (const y of [0.3, 0.85]) box(b, base, 0xf4f1e8, cx, y, -0.04, w, 0.08, 0.04);
      const n = Math.round(w / 0.2);
      for (let i = 0; i < n; i++) box(b, base, 0xffffff, x0 + (i + 0.5) * w / n, 0.05, 0, 0.09, 1.05, 0.025);
      for (const x of [x0 + 0.05, x1 - 0.05]) box(b, base, 0xf4f1e8, x, 0, -0.04, 0.12, 1.2, 0.12);
    }
  }
  if (gate) { // столбы и створка
    for (const k of [-1, 1]) box(b, base, s === 'south' ? p.stone : s === 'north' ? DARK : 0xf4f1e8, k * 0.6, 0, 0, 0.18, 1.3, 0.18);
    const c = s === 'south' ? IRON : s === 'north' ? 0x9a8a72 : 0xffffff;
    for (const y of [0.25, 0.9]) box(b, base, c, 0, y, 0, 1.0, 0.07, 0.04);
    for (const x of [-0.45, 0, 0.45]) box(b, base, c, x, 0.15, 0, 0.06, 0.9, 0.03);
    beam(b, base, c, [-0.45, 0.28, 0.02], [0.45, 0.88, 0.02], 0.03, 0.06);
  }
}

// Телега: два колеса, кузов с бортами, оглобли на земле, подпорка. Вариант 1 — с грузом (сено или мешки).
function cart(b, base, o, rng) {
  const y = 0.75;
  for (const k of [-1, 1]) wheel(b, base, k * 0.85, 0.6, -0.2);
  box(b, base, IRON, 0, 0.55, -0.2, 1.8, 0.08, 0.08); // ось
  box(b, base, WOOD, 0, y, -0.2, 1.4, 0.1, 2.4);
  for (const k of [-1, 1]) box(b, base, jitterColor(WOOD, rng), k * 0.67, y + 0.1, -0.2, 0.06, 0.35, 2.4);
  box(b, base, WOOD, 0, y + 0.1, -1.37, 1.4, 0.35, 0.06);
  for (const k of [-1, 1]) beam(b, base, DARK, [k * 0.45, y, 0.6], [k * 0.35, 0.08, 2.6], 0.08, 0.08);
  beam(b, base, DARK, [0, y, -1.3], [0, 0, -1.5], 0.07, 0.07);
  if (o.variant === 1) {
    if (rng() < 0.5) {
      b.add(new THREE.SphereGeometry(1, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2), jitterColor(HAY, rng), at(base, 0, y + 0.1, -0.2, 0.75, 0.75, 1.3));
    } else for (let i = 0; i < 5; i++) {
      b.add(new THREE.SphereGeometry(0.3, 6, 4), jitterColor(0xc9b48a, rng, 1.2), at(base, (i % 2 - 0.5) * 0.6, y + 0.35 + (i === 4 ? 0.35 : 0), -1 + Math.floor(i / 2) * 0.7, 1, 0.75, 1.3));
    }
  }
}

export const FARM = {
  shed: { name: 'Сарай', category: 'farm', styles: true, variants: 2, footprint: { w: 4.5, d: 3.6 }, build: shed },
  boathouse: { name: 'Лодочный сарай', category: 'farm', water: true, styles: true, variants: 2, footprint: { w: 5.6, d: 10 }, build: boathouse },
  windmill: { name: 'Ветряная мельница', category: 'farm', styles: true, footprint: { w: 6, d: 9 }, build: windmill },
  well: { name: 'Колодец', category: 'farm', styles: true, footprint: { w: 2, d: 2 }, build: well },
  'net-rack': { name: 'Сушилка сетей', category: 'farm', footprint: { w: 6.4, d: 1 },
    params: { length: { min: 4, max: 10, value: 6, label: 'длина, м' } }, build: netRack },
  woodpile: { name: 'Поленница', category: 'farm', variants: 2, footprint: { w: 3.4, d: 1.6 }, build: woodpile },
  fence: { name: 'Ограда', category: 'farm', styles: true, variants: 2, footprint: { w: 4, d: 0.5 }, build: fence },
  cart: { name: 'Телега', category: 'farm', variants: 2, footprint: { w: 1.9, d: 4.2 }, build: cart },
};
