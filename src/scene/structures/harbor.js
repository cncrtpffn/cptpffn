import * as THREE from 'three';
import { jitterColor } from '../flora.js';
import {
  palette, pick, at, box, cyl, beam, gable, hip, spire, pile, glow, triGeo,
  faceFrame, windowAt, windowRow, doorAt,
} from './kit.js';

// Причалы и порт (категории D–E каталога docs/changes/structures-library/catalog.md).
// Объекты у воды (water: true): начало — на кромке берега, вода в сторону +Z, уровень воды y = 0,
// дно у берега уходит до −3 м. Сваи забиты до −3.2 м.

const WOOD = 0x8f7a62, PILE = 0x5c4a3a, TAR = 0x2f2a26, IRON = 0x2b2b2b, ROPE = 0xc9b48a, RED = 0xc23b2e;
const SEABED = -3.2;

// Настил из досок поперёк Z: ширина w, от z0 до z1, верх на y
function deck(b, base, rng, w, z0, z1, y, { cx = 0, plank = 0.45, gap = 0.04, t = 0.08, color = WOOD } = {}) {
  const n = Math.max(1, Math.round((z1 - z0) / plank)), step = (z1 - z0) / n;
  for (let i = 0; i < n; i++) box(b, base, jitterColor(color, rng, 0.7), cx, y - t, z0 + (i + 0.5) * step, w, t, step - gap);
}

// Кнехт: kind 'iron' — чугунный «гриб», 'wood' — дубовый пал с железной шапкой
export function bollardAt(b, base, x, y, z, kind = 'iron') {
  if (kind === 'wood') {
    cyl(b, base, PILE, x, y, z, 0.17, 0.19, 0.8, 7);
    cyl(b, base, IRON, x, y + 0.8, z, 0.19, 0.19, 0.06, 7);
    return;
  }
  cyl(b, base, IRON, x, y, z, 0.22, 0.24, 0.06, 8);
  cyl(b, base, IRON, x, y + 0.06, z, 0.12, 0.15, 0.38, 8);
  cyl(b, base, IRON, x, y + 0.44, z, 0.2, 0.15, 0.1, 8);
}

// Скат из двух брусьев-направляющих и шпал: от (z0, y0) до (z1, y1), ширина w
function ramp(b, base, rng, z0, y0, z1, y1, w, { sleeper = 1.0, color = PILE } = {}) {
  for (const x of [-w / 2 + 0.2, w / 2 - 0.2]) beam(b, base, color, [x, y0, z0], [x, y1, z1], 0.25, 0.22);
  const len = Math.hypot(z1 - z0, y1 - y0), a = Math.atan2(y0 - y1, z1 - z0), n = Math.floor(len / sleeper);
  for (let i = 0; i <= n; i++) {
    const t = i / n, z = z0 + (z1 - z0) * t, y = y0 + (y1 - y0) * t;
    b.add(new THREE.BoxGeometry(w, 0.14, 0.22), jitterColor(color, rng, 0.6), at(base, 0, y - 0.18, z, 1, 1, 1, a, 0, 0));
    // над водой скат лежит на сваях до дна (у берега дно круче ската)
    if (i % 2 === 0 && y < 0 && z > 0) for (const x of [-w / 2 + 0.2, w / 2 - 0.2]) pile(b, base, PILE, x, z, SEABED, y - 0.25, 0.1);
  }
}

// Фонарь на столбе с огнём (extras)
function lampPost(b, base, x, y, z, h = 2.6) {
  cyl(b, base, IRON, x, y, z, 0.06, 0.1, h, 6);
  cyl(b, base, IRON, x, y + h, z, 0.2, 0.14, 0.06, 6);
  spire(b, base, IRON, x, y + h + 0.5, z, 0.24, 0.25, 6);
  return glow(base, new THREE.CylinderGeometry(0.16, 0.12, 0.44, 6), x, y + h + 0.28, z);
}

// --- D. Причалы --------------------------------------------------------------

function jettySmall(b, base, o, rng) {
  const L = o.length, W = 1.5, y = 0.8;
  deck(b, base, rng, W, -0.5, L, y);
  for (const x of [-0.55, 0.55]) box(b, base, PILE, x, y - 0.3, (L - 0.5) / 2, 0.14, 0.22, L + 0.5);
  const rows = [-0.3];
  for (let z = 1.5; z < L - 0.5; z += 2) rows.push(z);
  rows.push(L - 0.2);
  rows.forEach((z, i) => {
    const end = i === rows.length - 1;
    for (const x of [-0.65, 0.65]) pile(b, base, jitterColor(PILE, rng, 0.5), x, z, z < 0 ? -0.5 : SEABED, end ? y + 0.9 : y - 0.08, 0.12);
    box(b, base, PILE, 0, y - 0.45, z, W + 0.3, 0.16, 0.16);
  });
}

function pierWood(b, base, o, rng) {
  const L = o.length, W = o.width, tee = o.tee > 0, y = 1.2;
  const zMain = tee ? L - 4 : L, TW = Math.max(10, W * 2.5);
  deck(b, base, rng, W, -0.5, zMain, y, { plank: 0.6 });
  if (tee) deck(b, base, rng, TW, zMain, L, y, { plank: 0.6 });
  // сваи рядами через 3 м, ригели и прогоны
  const xs = W > 3 ? [-W / 2 + 0.25, 0, W / 2 - 0.25] : [-W / 2 + 0.25, W / 2 - 0.25];
  const rowsZ = [];
  for (let z = 0; z < zMain - 0.5; z += 3) rowsZ.push(z);
  for (const z of rowsZ) {
    for (const x of xs) pile(b, base, jitterColor(PILE, rng, 0.5), x, z, z < 0.5 ? -0.6 : SEABED, y - 0.08, 0.16);
    box(b, base, PILE, 0, y - 0.42, z, W + 0.3, 0.26, 0.26);
  }
  for (const x of xs) box(b, base, PILE, x, y - 0.3, zMain / 2 - 0.25, 0.2, 0.22, zMain + 0.5);
  // раскосы по бортам через пролёт
  for (let i = 1; i < rowsZ.length - 1; i += 2) {
    for (const x of [xs[0], xs[xs.length - 1]]) beam(b, base, PILE, [x, -1.4, rowsZ[i]], [x, y - 0.5, rowsZ[i + 1]], 0.12);
  }
  if (tee) {
    for (let x = -TW / 2 + 0.3; x <= TW / 2 - 0.3 + 1e-6; x += (TW - 0.6) / Math.round((TW - 0.6) / 3)) {
      for (const z of [zMain + 0.3, L - 0.3]) pile(b, base, jitterColor(PILE, rng, 0.5), x, z, SEABED, y - 0.08, 0.16);
    }
    for (const z of [zMain + 0.3, L - 0.3]) box(b, base, PILE, 0, y - 0.42, z, TW + 0.3, 0.26, 0.26);
  }
  // колесоотбойные брусья по краям и палы
  box(b, base, PILE, -W / 2 + 0.1, y, zMain / 2, 0.2, 0.18, zMain);
  box(b, base, PILE, W / 2 - 0.1, y, zMain / 2, 0.2, 0.18, zMain);
  for (let z = 6; z < zMain - 1; z += 6) for (const x of [-W / 2 + 0.25, W / 2 - 0.25]) bollardAt(b, base, x, y, z, 'wood');
  const extras = [];
  if (tee) {
    for (const x of [-TW / 2 + 0.4, TW / 2 - 0.4]) bollardAt(b, base, x, y, L - 0.4, 'wood');
    extras.push(lampPost(b, base, 0, y, L - 0.6));
    // трап к воде на торце
    for (const x of [2.2, 2.9]) beam(b, base, IRON, [x, y + 0.6, L + 0.05], [x, -1.5, L + 0.05], 0.05);
    for (let k = 0; k < 7; k++) box(b, base, IRON, 2.55, y - 0.3 - k * 0.4, L + 0.05, 0.7, 0.04, 0.04);
  } else {
    extras.push(lampPost(b, base, W / 2 - 0.3, y, L - 0.4));
  }
  return { extras };
}

function pierStone(b, base, o, rng) {
  const p = palette(o.style), L = o.length, W = 6, top = 1.5, bot = -3.5, SEG = 2.5;
  // тело мола блоками по 2.5 м (разный тон — видны швы)
  for (let z = -1; z < L; z += SEG) {
    const d = Math.min(SEG, L - z);
    box(b, base, jitterColor(p.stone, rng, 1.2), 0, bot, z + d / 2, W, top - bot, d - 0.02);
    box(b, base, jitterColor(p.stone, rng, 0.8).offsetHSL(0, 0, 0.04), 0, top, z + d / 2, W - 1.2, 0.05, d - 0.1);
  }
  // голова мола и бортовой камень
  cyl(b, base, jitterColor(p.stone, rng, 0.8), 0, bot, L, W / 2 + 0.6, W / 2 + 0.8, top - bot, 14);
  cyl(b, base, jitterColor(p.stone, rng, 0.6).offsetHSL(0, 0, 0.06), 0, top, L, W / 2 + 0.7, W / 2 + 0.7, 0.25, 14);
  for (const x of [-W / 2 + 0.3, W / 2 - 0.3]) box(b, base, jitterColor(p.stone, rng, 0.5).offsetHSL(0, 0, 0.06), x, top, L / 2 - 0.5, 0.7, 0.25, L + 1);
  // парапет с морской стороны (−X)
  if (o.parapet > 0) box(b, base, jitterColor(p.stone, rng, 0.6), -W / 2 + 0.35, top + 0.25, L / 2 - 1, 0.7, 1.0, L - 2);
  for (let z = 4; z < L - 3; z += 8) bollardAt(b, base, W / 2 - 0.6, top + 0.25, z);
  const head = harborLight(b, at(base, 0, top + 0.25, L), { variant: 0 }, rng);
  return { extras: head.extras };
}

function quayWall(b, base, o, rng) {
  const p = palette(o.style), W = 10, D = 4, top = 1.2, bot = -3.5;
  box(b, base, p.stone, 0, bot, -D / 2, W, top - bot, D);
  // облицовка лицевой стены рядами блоков
  const rows = 5, cols = 5, rh = (top - bot - 0.25) / rows;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const off = (j % 2) * 0.5, x0 = -W / 2 + (i + off) * (W / cols), x1 = Math.min(W / 2, x0 + W / cols);
      if (x1 - x0 < 0.3) continue;
      box(b, base, jitterColor(p.stone, rng, 1.4), (x0 + x1) / 2, bot + j * rh, 0.04, x1 - x0 - 0.04, rh - 0.04, 0.08);
    }
    if (j % 2) box(b, base, jitterColor(p.stone, rng, 1.4), -W / 2 + 0.25, bot + j * rh, 0.04, 0.46, rh - 0.04, 0.08);
  }
  box(b, base, jitterColor(p.stone, rng, 0.5).offsetHSL(0, 0, 0.07), 0, top - 0.25, -0.35, W, 0.3, 0.9);
  for (const x of [-3, 3]) bollardAt(b, base, x, top + 0.05, -0.7);
  // отбойные брусья
  for (const x of [-4.2, -1.6, 1.6, 4.2]) box(b, base, TAR, x, -1.5, 0.18, 0.28, top - 0.1 + 1.5, 0.2);
  if (o.variant === 1) { // скоб-трап
    for (const x of [-0.3, 0.3]) box(b, base, IRON, x, -2, 0.15, 0.05, top + 2, 0.05);
    for (let k = 0; k < 8; k++) box(b, base, IRON, 0, -1.8 + k * 0.38, 0.17, 0.6, 0.04, 0.04);
  }
}

function slipway(b, base, o, rng) {
  ramp(b, base, rng, -2, 0.3, 12, -2.6, 4);
  deck(b, base, rng, 4.6, -4, -2, 0.12, { color: 0x8a7a66 }); // площадка
  // лебёдка: две стойки, барабан, рукояти, трос к скату
  for (const x of [-0.7, 0.7]) box(b, base, PILE, x, 0.12, -5, 0.15, 1.2, 0.6);
  b.add(new THREE.CylinderGeometry(0.25, 0.25, 1.3, 8), PILE, at(base, 0, 1.0, -5, 1, 1, 1, 0, 0, Math.PI / 2));
  for (const k of [-1, 1]) {
    box(b, base, IRON, k * 0.85, 0.95, -5.2, 0.05, 0.05, 0.45);
    box(b, base, IRON, k * 0.85, 0.95, -5.42, 0.05, 0.45, 0.05);
  }
  beam(b, base, ROPE, [0, 1.0, -4.75], [0, 0.0, 2.5], 0.03);
  for (const x of [-2.6, 2.6]) bollardAt(b, base, x, 0.12, -3.2, 'wood');
}

function stepsWater(b, base, o, rng) {
  // площадка вровень с берегом, марши уходят под воду (с лодки можно выйти при любой воде)
  const p = palette(o.style), top = 0.3, n = 8, rise = 0.3, run = 0.45, w = 2;
  box(b, base, p.stone, 0, -3, -1.5, w + 1, top + 3, 3); // площадка
  for (let i = 0; i < n; i++) {
    const t = top - rise * (i + 1), z = i * run + run / 2;
    box(b, base, jitterColor(p.stone, rng, 1), 0, -3, z, w, t + 3, run);
    for (const k of [-1, 1]) box(b, base, jitterColor(p.stone, rng, 0.6), k * (w / 2 + 0.25), -3, z, 0.5, t + 3.5, run);
  }
  for (const k of [-1, 1]) box(b, base, p.stone, k * (w / 2 + 0.25), top, -0.75, 0.5, 0.5, 1.5);
  for (const k of [-1, 1]) bollardAt(b, base, k * 1.2, top, -2.4);
}

function bollard(b, base, o) {
  bollardAt(b, base, 0, 0, 0, o.variant === 1 ? 'wood' : 'iron');
}

// --- E. Порт -------------------------------------------------------------------

function warehouse(b, base, o, rng) {
  const p = palette(o.style), W = 12, D = 20, H = 7;
  const wall = o.style === 'north' ? p.brick : o.style === 'south' ? p.stone : 0xa8a49a;
  const rise = { north: 6, south: 2.8, atlantic: 4.5 }[o.style] ?? 4.5;
  // кирпич под красной черепицей сливается — на севере пакгауз под тёмной кровлей
  const roof = o.style === 'north' ? pick([p.roof[0], p.roof[2]], rng) : pick(p.roof, rng), trim = p.trim;
  box(b, base, jitterColor(wall, rng, 0.5).offsetHSL(0, 0, -0.08), 0, 0, 0, W + 0.2, 0.7, D + 0.2); // цоколь
  box(b, base, jitterColor(wall, rng, 0.5), 0, 0.7, 0, W, H - 0.7, D);
  if (o.style === 'atlantic') for (let y = 1.0; y < H; y += 0.5) box(b, base, jitterColor(wall, rng, 0.4).offsetHSL(0, 0, -0.04), 0, y, 0, W + 0.04, 0.05, D + 0.04);
  if (o.style === 'north') box(b, base, p.trim, 0, H - 0.5, 0, W + 0.1, 0.2, D + 0.1); // поясок
  gable(b, base, { w: D, d: W, y: H, h: rise, over: 0.4, roof, wall: jitterColor(wall, rng, 0.5), ry: Math.PI / 2 });
  const opts = { ww: 0.7, wh: 0.9, frame: trim, glass: p.glass, shutter: o.style === 'south' ? pick(p.shutter, rng) : undefined };
  // фасад (+Z): ворота, грузовая дверь над ними, балка подъёмника в фронтоне, окна по сторонам
  const f = faceFrame(base, '+z', D / 2);
  doorAt(b, f, 0, { w: 3.2, h: 3.6, color: p.wood, frame: trim, y0: 0.2 });
  b.add(new THREE.BoxGeometry(0.06, 3.5, 0.03), trim, f.clone().multiply(new THREE.Matrix4().makeTranslation(0, 2.0, 0.1)));
  doorAt(b, f, 0, { w: 1.6, h: 2.0, color: p.wood, frame: trim, y0: 4.3 });
  box(b, base, PILE, 0, H + rise * 0.55, D / 2 + 0.6, 0.3, 0.3, 1.6);
  beam(b, base, ROPE, [0, H + rise * 0.55, D / 2 + 1.3], [0, 4.3, D / 2 + 1.3], 0.03);
  windowRow(b, f, W, 4, [2.2, 5.2], opts, (i) => i === 1 || i === 2);
  // бока: два ряда окон, задний фасад — дверь
  // по бокам без ставен: 28 окон со ставнями — лишняя тысяча треугольников
  for (const face of ['+x', '-x']) windowRow(b, faceFrame(base, face, W / 2), D, 7, [2.4, 5.2], { ...opts, shutter: undefined });
  doorAt(b, faceFrame(base, '-z', D / 2), 0, { w: 1.4, h: 2.4, color: p.wood, frame: trim, y0: 0.2 });
  // погрузочная платформа вдоль +X
  deck(b, base, rng, 2.2, -D / 2 + 1, D / 2 - 1, 1.05, { cx: W / 2 + 1.1, plank: 0.6 });
  for (let z = -D / 2 + 1.5; z < D / 2 - 1; z += 3) pile(b, base, PILE, W / 2 + 2.0, z, 0, 0.97, 0.1);
  box(b, base, p.roof[0], W / 2 + 1.2, 3.6, 0, 2.6, 0.12, D - 1.5); // навес над платформой
  for (let z = -D / 2 + 1.5; z < D / 2 - 1; z += 4.5) pile(b, base, PILE, W / 2 + 2.3, z, 1.05, 3.6, 0.07);
}

function crane(b, base, o, rng) {
  box(b, base, jitterColor(0x9a9a92, rng), 0, 0, 0, 3, 0.6, 3);
  cyl(b, base, IRON, 0, 0.6, 0, 1.0, 1.0, 0.2, 10);
  const m = at(base, 0, 0.8, 0, 1, 1, 1, 0, o.angle * Math.PI / 180, 0);
  box(b, m, PILE, 0, 0, 0, 0.45, 6, 0.45); // мачта
  box(b, m, IRON, 0, 6, 0, 0.55, 0.12, 0.55);
  beam(b, m, WOOD, [0, 1.2, 0.3], [0, 7.2, 5.6], 0.3, 0.3); // стрела
  beam(b, m, IRON, [0, 5.9, 0.2], [0, 7.3, 5.5], 0.05); // тяга
  beam(b, m, PILE, [0, 3.0, 0.2], [0, 3.9, 2.4], 0.16); // подкос
  beam(b, m, ROPE, [0, 7.15, 5.75], [0, 2.6, 5.75], 0.03); // гак
  box(b, m, IRON, 0, 2.3, 5.75, 0.18, 0.35, 0.12);
  box(b, m, jitterColor(WOOD, rng), 0, 1.4, 5.75, 0.9, 0.8, 0.9); // ящик на гаке
  // лебёдка у основания мачты, противовес сзади
  for (const x of [-0.5, 0.5]) box(b, m, PILE, x, 0, -0.7, 0.1, 1.1, 0.6);
  b.add(new THREE.CylinderGeometry(0.2, 0.2, 0.9, 8), PILE, m.clone().multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2).setPosition(0, 0.9, -0.7)));
  for (const k of [-1, 1]) box(b, m, IRON, k * 0.62, 0.65, -0.7, 0.05, 0.5, 0.05);
  box(b, m, 0x7a7a72, 0, 0, -1.2, 1.0, 0.8, 0.5);
}

function harborLight(b, base, o) {
  if (o.variant === 1) { // решётчатый створный знак с треугольником
    const leg = (sx, sz) => beam(b, base, 0xe8e2d4, [sx * 0.9, 0, sz * 0.9], [sx * 0.3, 5, sz * 0.3], 0.1);
    for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) leg(sx, sz);
    for (const y of [1.5, 3.2]) {
      const r = 0.9 - 0.6 * y / 5;
      for (const [x0, z0, x1, z1] of [[-r, -r, r, -r], [r, -r, r, r], [r, r, -r, r], [-r, r, -r, -r]]) beam(b, base, 0xe8e2d4, [x0, y, z0], [x1, y, z1], 0.07);
    }
    box(b, base, 0xe8e2d4, 0, 5, 0, 0.8, 0.1, 0.8);
    const tri = new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(-0.8, 0), new THREE.Vector2(0.8, 0), new THREE.Vector2(0, 1.4)]), { depth: 0.06, bevelEnabled: false });
    b.add(tri, RED, at(base, 0, 5.1, -0.03));
    return { extras: [glow(base, new THREE.CylinderGeometry(0.12, 0.12, 0.25, 6), 0, 6.65, 0, 0xffd0c0, 0xff5a3a)] };
  }
  cyl(b, base, 0x9a9a92, 0, 0, 0, 0.8, 0.9, 0.4, 8);
  cyl(b, base, RED, 0, 0.4, 0, 0.35, 0.55, 1.6, 8);
  cyl(b, base, 0xf4f1e8, 0, 2.0, 0, 0.3, 0.35, 0.8, 8);
  cyl(b, base, RED, 0, 2.8, 0, 0.28, 0.3, 1.0, 8);
  cyl(b, base, IRON, 0, 3.8, 0, 0.6, 0.6, 0.08, 10);
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; cyl(b, base, IRON, Math.cos(a) * 0.55, 3.88, Math.sin(a) * 0.55, 0.02, 0.02, 0.5, 4); }
  spire(b, base, IRON, 0, 4.5, 0, 0.42, 0.45, 8);
  cyl(b, base, IRON, 0, 4.95, 0, 0.05, 0.08, 0.25, 6);
  return { extras: [glow(base, new THREE.CylinderGeometry(0.28, 0.28, 0.62, 8), 0, 4.19, 0, 0xffd8c8, 0xff6040)] };
}

const FLAG_COLORS = [0xc23b2e, 0xf2c14e, 0x2f5fa8, 0xf4f1e8, 0x1f1f1f, 0x2f8a4a];
function signalMast(b, base, o, rng) {
  box(b, base, 0x9a9a92, 0, 0, 0, 1.2, 0.6, 1.2);
  cyl(b, base, 0xf4f1e8, 0, 0.6, 0, 0.09, 0.16, 11.4, 7);
  b.add(new THREE.SphereGeometry(0.2, 6, 4), IRON, at(base, 0, 12.1, 0));
  beam(b, base, 0xf4f1e8, [-2.2, 9, 0], [2.2, 9, 0], 0.09); // рей
  beam(b, base, 0xf4f1e8, [0, 7.2, 0], [0, 8.6, -2.4], 0.07); // гафель
  for (const [x, z] of [[-3, -2.5], [3, -2.5], [0, 3.5]]) beam(b, base, 0x3a3a3a, [0, 10.5, 0], [x, 0.05, z], 0.025);
  // сигнальные флаги на фалах ноков рея
  for (const x of [-2, 2]) {
    const n = 2 + Math.floor(rng() * 2);
    beam(b, base, 0x3a3a3a, [x, 9, 0], [x, 9 - n * 0.6 - 0.2, 0], 0.015);
    for (let k = 0; k < n; k++) box(b, base, pick(FLAG_COLORS, rng), x + 0.32, 8.75 - k * 0.6, 0, 0.6, 0.42, 0.02);
  }
  const pen = new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(0, -0.2), new THREE.Vector2(0, 0.2), new THREE.Vector2(-1.2, 0)]), { depth: 0.02, bevelEnabled: false });
  b.add(pen, RED, at(base, 0, 8.4, -2.4, 1, 1, 1, 0, Math.PI / 2, 0));
}

function pilotStation(b, base, o, rng) {
  const p = palette(o.style), wall = pick(p.wall, rng), roof = pick(p.roof, rng);
  box(b, base, wall, 0, 0, 0, 4.5, 3, 4.5);
  gable(b, base, { w: 4.5, d: 4.5, y: 3, h: 1.8, roof, wall });
  const opts = { ww: 0.7, wh: 0.9, frame: p.trim, glass: p.glass, shutter: o.style === 'atlantic' ? pick(p.shutter, rng) : undefined };
  doorAt(b, faceFrame(base, '+z', 2.25), -0.9, { color: p.door, frame: p.trim });
  windowAt(b, faceFrame(base, '+z', 2.25), 1.0, 1.6, opts);
  windowAt(b, faceFrame(base, '-x', 2.25), 0, 1.6, opts);
  // смотровая башня в заднем углу: остеклённая будка, шатёр, флагшток
  const tx = 1.3, tz = -1.3;
  box(b, base, wall, tx, 0, tz, 2.2, 6.4, 2.2);
  box(b, base, p.trim, tx, 6.4, tz, 2.6, 0.15, 2.6);
  box(b, base, p.glass, tx, 6.55, tz, 2.0, 1.5, 2.0);
  for (const [cx, cz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) box(b, base, p.trim, tx + cx * 1.0, 6.55, tz + cz * 1.0, 0.14, 1.5, 0.14);
  for (const face of ['+z', '-z', '+x', '-x']) {
    const ff = faceFrame(base, face, 1.0, tx, tz);
    b.add(new THREE.BoxGeometry(0.08, 1.5, 0.03), p.trim, ff.clone().multiply(new THREE.Matrix4().makeTranslation(0, 7.3, 0.02)));
  }
  hip(b, base, { x: tx, z: tz, w: 2.2, d: 2.2, y: 8.05, h: 1.1, over: 0.3, roof });
  cyl(b, base, 0xf4f1e8, tx, 9.1, tz, 0.04, 0.06, 2.2, 5);
  box(b, base, RED, tx + 0.35, 10.7, tz, 0.6, 0.4, 0.02);
  for (const face of ['+z', '+x']) windowAt(b, faceFrame(base, face, 1.1, tx, tz), 0, 4.2, { ...opts, ww: 0.5, wh: 0.7 });
}

// Корпус гребной лодки: обшивка снаружи и изнутри (видна в открытой лодке), транец на корме (−Z).
// L — длина, B — ширина, D — высота борта. Начало: киль в середине длины.
export function hullGeometry(L = 4.6, B = 1.5, D = 0.62, n = 10) {
  const outer = [], st = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, z = -L / 2 + L * t;
    const w = (B / 2) * Math.pow(Math.sin(Math.PI * (0.18 + 0.82 * t)), 0.7) * (t === 1 ? 0 : 1);
    const yk = 0.18 * Math.pow(2 * t - 1, 2) * (t > 0.5 ? 1.6 : 0.6); // подъём днища к носу
    const sheer = D + 0.18 * Math.pow(2 * t - 1, 2);
    st.push({ z, k: [0, yk, z], c: [w * 0.82, yk + (sheer - yk) * 0.3, z], g: [w, sheer, z] });
  }
  const quad = (a, b2, c, d) => { outer.push([a, b2, c], [a, c, d]); };
  for (const s of [1, -1]) {
    for (let i = 0; i < n; i++) {
      const A = st[i], Bn = st[i + 1], fx = (p) => [p[0] * s, p[1], p[2]];
      if (s > 0) { quad(fx(A.k), fx(Bn.k), fx(Bn.c), fx(A.c)); quad(fx(A.c), fx(Bn.c), fx(Bn.g), fx(A.g)); }
      else { quad(fx(A.k), fx(A.c), fx(Bn.c), fx(Bn.k)); quad(fx(A.c), fx(A.g), fx(Bn.g), fx(Bn.c)); }
    }
  }
  // правим обход: нормаль наружу — от точки над осью лодки
  const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nn = new THREE.Vector3(), c = new THREE.Vector3();
  for (const tri of outer) {
    e1.set(...tri[1]).sub(new THREE.Vector3(...tri[0])); e2.set(...tri[2]).sub(new THREE.Vector3(...tri[0]));
    nn.crossVectors(e1, e2);
    c.set(0, 0, 0); for (const v of tri) c.add(new THREE.Vector3(...v)); c.divideScalar(3);
    if (nn.dot(new THREE.Vector3(c.x, c.y - 1.5 * D, 0)) < 0) [tri[1], tri[2]] = [tri[2], tri[1]];
  }
  const s0 = st[0];
  const transom = [[[-s0.c[0], s0.c[1], s0.z], s0.k, [s0.c[0], s0.c[1], s0.z]], [[-s0.g[0], s0.g[1], s0.z], [-s0.c[0], s0.c[1], s0.z], [s0.c[0], s0.c[1], s0.z]],
    [[-s0.g[0], s0.g[1], s0.z], [s0.c[0], s0.c[1], s0.z], [s0.g[0], s0.g[1], s0.z]]];
  // транец смотрит в −Z: обход по часовой, если смотреть с +Z
  for (const tri of transom) { e1.set(...tri[1]).sub(new THREE.Vector3(...tri[0])); e2.set(...tri[2]).sub(new THREE.Vector3(...tri[0])); if (nn.crossVectors(e1, e2).z > 0) [tri[1], tri[2]] = [tri[2], tri[1]]; }
  const inner = [...outer, ...transom].map((tri) => [tri[0], tri[2], tri[1]].map(([x, y, z]) => [x * 0.93, y + 0.04, z * 0.98]));
  return { outer: triGeo([...outer, ...transom]), inner: triGeo(inner), stations: st };
}

const HULL_COLORS = [0xf4f1e8, 0x3f6f8f, 0x2f5f3f, 0x8a3a2a];
// Лодка в батч: m — матрица, paint — цвет бортов
export function boat(b, m, rng, { L = 4.6, B = 1.5, D = 0.62, paint, oars = false } = {}) {
  const h = hullGeometry(L, B, D);
  b.add(h.outer, paint ?? pick(HULL_COLORS, rng), m);
  b.add(h.inner, 0xb08a5a, m);
  const mid = h.stations[Math.round(h.stations.length * 0.45)], aft = h.stations[2];
  for (const s of [mid, aft]) b.add(new THREE.BoxGeometry(s.g[0] * 1.8, 0.05, 0.25), 0xa07a4a, m.clone().multiply(new THREE.Matrix4().makeTranslation(0, s.g[1] - 0.18, s.z)));
  if (oars) for (const k of [-1, 1]) b.add(new THREE.BoxGeometry(0.06, 0.05, L * 0.6), 0xc8a878, m.clone().multiply(new THREE.Matrix4().makeTranslation(k * 0.3, mid.g[1] - 0.1, 0.2)));
}

function boatBeached(b, base, o, rng) {
  const paint = pick(HULL_COLORS, rng);
  if (o.variant === 1) { // на боку
    boat(b, at(base, 0, 0.75, 0, 1, 1, 1, 0, 0, 1.25), rng, { paint });
  } else if (o.variant === 2) { // на ровном киле, на чурбаках, с вёслами
    for (const z of [-1.2, 1.0]) box(b, base, PILE, 0, 0, z, 0.9, 0.18, 0.3);
    boat(b, at(base, 0, 0.17, 0, 1, 1, 1, 0, 0, 0.06), rng, { paint, oars: true });
  } else { // вверх дном
    boat(b, at(base, 0, 0.8, 0, 1, 1, 1, 0, 0, Math.PI), rng, { paint });
  }
}

function shipyard(b, base, o, rng) {
  // стапель с уклоном к воде, на кильблоках — остов шлюпа
  const a = Math.atan2(2.1, 14), m = at(base, 0, 0.5, -1, 1, 1, 1, a, 0, 0);
  ramp(b, base, rng, -8, 0.3, 9, -2.2, 3.4);
  const L = 10, B = 3.2, D = 1.8;
  for (let z = -L / 2 + 0.6; z < L / 2; z += 1.5) box(b, m, jitterColor(PILE, rng), 0, 0, z, 0.8, 0.45, 0.35);
  box(b, m, WOOD, 0, 0.45, 0, 0.25, 0.3, L);
  beam(b, m, WOOD, [0, 0.6, L / 2], [0, 0.6 + D + 0.5, L / 2 + 0.6], 0.22); // форштевень
  beam(b, m, WOOD, [0, 0.6, -L / 2], [0, 0.6 + D + 0.3, -L / 2 - 0.3], 0.22); // ахтерштевень
  const frames = [];
  for (let z = -L / 2 + 0.6; z <= L / 2 - 0.6; z += 0.6) {
    const t = (z + L / 2) / L, w = (B / 2) * Math.pow(Math.sin(Math.PI * (0.12 + 0.82 * t)), 0.8);
    const k = [0, 0.75, z], c = [w * 0.85, 0.75 + D * 0.35, z], g = [w, 0.75 + D, z];
    frames.push({ k, c, g });
    for (const s of [1, -1]) {
      beam(b, m, WOOD, k, [c[0] * s, c[1], z], 0.12);
      beam(b, m, WOOD, [c[0] * s, c[1], z], [g[0] * s, g[1], z], 0.12);
    }
  }
  // вариант 1: нижние пояса обшивки уже набраны
  if (o.variant === 1) {
    for (let f = 0; f < frames.length - 1; f++) {
      const A = frames[f], Bf = frames[f + 1];
      for (const s of [1, -1]) {
        for (const u of [0.25, 0.55, 0.85]) {
          const pa = A.k.map((v, i) => v + (A.c[i] - v) * u), pb = Bf.k.map((v, i) => v + (Bf.c[i] - v) * u);
          beam(b, m, jitterColor(0x9a7a56, rng, 0.6), [pa[0] * s, pa[1], pa[2]], [pb[0] * s, pb[1], pb[2]], 0.05, 0.32);
        }
      }
    }
  }
  // леса и брёвна на берегу
  for (const x of [-2.6, 2.6]) for (const z of [-4, 0, 4]) pile(b, m, PILE, x, z, -0.5, 2.8, 0.08);
  for (const x of [-2.6, 2.6]) box(b, m, WOOD, x, 1.6, 0, 0.5, 0.06, 8.6);
  for (let i = 0; i < 5; i++) b.add(new THREE.CylinderGeometry(0.15, 0.15, 5, 6), jitterColor(0x9a7a56, rng), at(base, -4.2 + (i % 3) * 0.32, 0.15 + Math.floor(i / 3) * 0.27, -6, 1, 1, 1, Math.PI / 2, 0, 0));
}

function cargo(b, base, o, rng) {
  const v = o.variant;
  const barrel = (x, y, z, lying) => {
    const m = lying ? at(base, x, y + 0.32, z, 1, 1, 1, 0, rng() * 0.3, Math.PI / 2) : at(base, x, y + 0.45, z, 1, 1, 1, 0, rng() * 3, 0);
    const col = jitterColor(0x8a5a3c, rng, 0.8);
    b.add(new THREE.CylinderGeometry(0.34, 0.28, 0.45, 8), col, m.clone().multiply(new THREE.Matrix4().makeTranslation(0, -0.225, 0)));
    b.add(new THREE.CylinderGeometry(0.28, 0.34, 0.45, 8), col, m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.225, 0)));
    for (const hy of [-0.32, 0.32]) b.add(new THREE.CylinderGeometry(0.315, 0.315, 0.05, 8), IRON, m.clone().multiply(new THREE.Matrix4().makeTranslation(0, hy, 0)));
  };
  const crate = (x, y, z, s = 0.8) => {
    const ry = (rng() - 0.5) * 0.3;
    box(b, base, jitterColor(0xb08a5a, rng, 0.9), x, y, z, s, s, s, ry);
    box(b, base, 0x7a5a3a, x, y + s * 0.45, z, s + 0.02, 0.08, s + 0.02, ry);
    box(b, base, 0x7a5a3a, x, y + s * 0.1, z, s + 0.02, 0.08, s + 0.02, ry);
  };
  if (v === 1) { // бочки: два ряда лёжа пирамидкой и стоячие
    for (let i = 0; i < 3; i++) barrel(-1 + i * 0.66, 0, 0, true);
    for (let i = 0; i < 2; i++) barrel(-0.67 + i * 0.66, 0.6, 0, true);
    barrel(-0.34, 1.18, 0, true);
    for (let i = 0; i < 3; i++) barrel(1.2 + (i % 2) * 0.7, 0, -0.6 + i * 0.6, false);
    return;
  }
  if (v === 2) { // ящики штабелем
    for (let i = 0; i < 4; i++) crate(-0.9 + (i % 2) * 0.85, 0, -0.45 + Math.floor(i / 2) * 0.85);
    for (let i = 0; i < 2; i++) crate(-0.9 + i * 0.85, 0.8, -0.05);
    crate(-0.5, 1.6, -0.05);
    crate(1.2, 0, 0.3, 1.0);
    return;
  }
  // смесь: бочки, ящики, тюки, бухта каната, якорь
  barrel(-1.1, 0, -0.5, false); barrel(-0.45, 0, -0.65, false); barrel(-0.8, 0, 0.1, true);
  crate(0.4, 0, -0.6); crate(0.4, 0.8, -0.6, 0.7); crate(1.2, 0, -0.5, 0.7);
  for (let i = 0; i < 2; i++) {
    box(b, base, jitterColor(0xc8b68a, rng, 0.8), 0.9, i * 0.55, 0.55, 1.0, 0.55, 0.6, 0.1);
    for (const x of [0.6, 1.2]) box(b, base, 0x6a5a40, x, i * 0.55 + 0.27, 0.55, 0.04, 0.57, 0.62, 0.1);
  }
  b.add(new THREE.TorusGeometry(0.35, 0.1, 4, 10), ROPE, at(base, -0.2, 0.1, 0.8, 1, 1, 1, Math.PI / 2, 0, 0));
  b.add(new THREE.TorusGeometry(0.3, 0.09, 4, 10), ROPE, at(base, -0.2, 0.27, 0.8, 1, 1, 1, Math.PI / 2, 0, 0));
  // якорь Адмиралтейского типа, прислонён к ящику
  const am = at(base, 1.9, 0, 0.6, 1, 1, 1, 0.35, -0.4, 0);
  box(b, am, IRON, 0, 0.1, 0, 0.1, 1.5, 0.1);
  beam(b, am, IRON, [0, 0.25, 0], [0.55, 0.55, 0], 0.09); beam(b, am, IRON, [0, 0.25, 0], [-0.55, 0.55, 0], 0.09);
  beam(b, am, PILE, [0, 1.45, -0.6], [0, 1.45, 0.6], 0.1); // шток
  b.add(new THREE.TorusGeometry(0.1, 0.03, 4, 8), IRON, at(base, 1.9, 1.75, 0.6));
}

function lifeboatStation(b, base, o, rng) {
  const p = palette(o.style), wall = pick(p.wall, rng), roof = pick(p.roof, rng);
  const W = 6, D = 9, H = 4.2, zc = -5.5;
  box(b, base, wall, 0, 0, zc, W, H, D);
  gable(b, base, { z: zc, w: D, d: W, y: H, h: 2.4, roof, wall, ry: Math.PI / 2 });
  const f = faceFrame(base, '+z', D / 2, 0, zc);
  doorAt(b, f, 0, { w: 3.6, h: 3.6, color: 0x2a2622, frame: p.trim }); // ворота открыты — проём тёмный
  box(b, base, RED, 0, H + 0.6, zc + D / 2 + 0.05, 3.2, 0.5, 0.06); // табличка станции
  for (const face of ['+x', '-x']) windowRow(b, faceFrame(base, face, W / 2, 0, zc), D, 3, [2.2], { ww: 0.8, wh: 1.0, frame: p.trim, glass: p.glass });
  // колокол на кронштейне и флагшток
  box(b, base, p.wood, W / 2 + 0.3, 2.9, zc + D / 2 - 0.4, 0.6, 0.08, 0.08);
  b.add(new THREE.CylinderGeometry(0.1, 0.18, 0.25, 8), 0xb08a3a, at(base, W / 2 + 0.5, 2.7, zc + D / 2 - 0.4));
  cyl(b, base, 0xf4f1e8, -W / 2 - 1, 0, zc + D / 2 - 1, 0.05, 0.08, 7, 5);
  box(b, base, RED, -W / 2 - 0.6, 6.5, zc + D / 2 - 1, 0.8, 0.5, 0.02);
  // скат от ворот в воду и спасательная шлюпка на нём
  ramp(b, base, rng, zc - D / 2 + 1, 0.3, 10, -2.4, 3.2);
  const a = Math.atan2(2.7, 10 - (zc - D / 2 + 1));
  boat(b, at(base, 0, 0.45, 0.2, 1, 1, 1, a, 0, 0), rng, { L: 6.2, B: 1.9, D: 0.85, paint: 0x2f5fa8 });
}

export const HARBOR = {
  // D. Причалы
  'jetty-small': { name: 'Мостки', category: 'piers', water: true, footprint: { w: 1.5, d: 8 },
    params: { length: { min: 4, max: 12, value: 8, label: 'длина, м' } }, build: jettySmall },
  'pier-wood': { name: 'Деревянный пирс', category: 'piers', water: true, footprint: { w: 10, d: 30 },
    params: { length: { min: 10, max: 40, value: 30, label: 'длина, м' }, width: { min: 3, max: 6, step: 0.5, value: 4, label: 'ширина, м' },
      tee: { min: 0, max: 1, value: 1, label: 'Т-оголовок' } }, build: pierWood },
  'pier-stone': { name: 'Каменный мол', category: 'piers', water: true, styles: true, footprint: { w: 8, d: 40 },
    params: { length: { min: 20, max: 60, value: 40, label: 'длина, м' }, parapet: { min: 0, max: 1, value: 1, label: 'парапет' } }, build: pierStone },
  'quay-wall': { name: 'Набережная стенка', category: 'piers', water: true, styles: true, variants: 2, footprint: { w: 10, d: 4 }, build: quayWall },
  slipway: { name: 'Слип', category: 'piers', water: true, footprint: { w: 6, d: 18 }, build: slipway },
  'steps-water': { name: 'Лестница к воде', category: 'piers', water: true, styles: true, footprint: { w: 3, d: 6.6 }, build: stepsWater },
  bollard: { name: 'Кнехт', category: 'piers', variants: 2, footprint: { w: 0.6, d: 0.6 }, build: bollard },
  // E. Порт
  warehouse: { name: 'Пакгауз', category: 'port', styles: true, footprint: { w: 16.5, d: 20.4 }, build: warehouse },
  crane: { name: 'Портовый кран', category: 'port', footprint: { w: 3, d: 3 },
    params: { angle: { min: -180, max: 180, step: 5, value: 30, label: 'поворот, °' } }, build: crane },
  'harbor-light': { name: 'Малый маяк', category: 'port', variants: 2, footprint: { w: 2, d: 2 }, build: harborLight },
  'signal-mast': { name: 'Сигнальная мачта', category: 'port', footprint: { w: 6, d: 6 }, build: signalMast },
  'pilot-station': { name: 'Лоцманская станция', category: 'port', styles: true, footprint: { w: 5, d: 5 }, build: pilotStation },
  shipyard: { name: 'Стапель с остовом', category: 'port', water: true, variants: 2, footprint: { w: 6, d: 17 }, build: shipyard },
  cargo: { name: 'Груз', category: 'port', variants: 3, footprint: { w: 4, d: 2.5 }, build: cargo },
  'boat-beached': { name: 'Лодка на берегу', category: 'port', variants: 3, footprint: { w: 1.6, d: 5 }, build: boatBeached },
  'lifeboat-station': { name: 'Спасательная станция', category: 'port', water: true, styles: true, footprint: { w: 8, d: 20 }, build: lifeboatStation },
};
