import * as THREE from 'three';
import { jitterColor } from '../flora.js';
import { palette, pick, at, box, cyl, beam, spire, glow } from './kit.js';

// Городская среда (категория G каталога docs/changes/structures-library/catalog.md).
// СК объекта: лицевая сторона к +Z, начало на земле в центре.

const IRON = 0x2b2b2b, GREEN_IRON = 0x2f4a3a, WOOD = 0x8f7a62, DARK = 0x5c4a3a;
const STONE = 0xd9d2c0, BRONZE = 0x5f7a5a, WATER = 0x6fa8c0, RED = 0xb8322a;

// Фонарь: стеклянный корпус светится (extras), колпак — шатёр
function lantern(b, base, x, y, z) {
  box(b, base, IRON, x, y - 0.05, z, 0.34, 0.06, 0.34);
  spire(b, base, IRON, x, y + 0.42, z, 0.3, 0.28, 4);
  return glow(base, new THREE.BoxGeometry(0.26, 0.42, 0.26), x, y + 0.21, z);
}

// Фонарь: вариант 0 — на чугунном столбе, 1 — настенный на кронштейне (стена в плоскости z = 0, кронштейн к +Z)
function streetLamp(b, base, o) {
  if (o.variant === 1) {
    box(b, base, IRON, 0, 2.8, 0.02, 0.2, 0.5, 0.04);
    beam(b, base, IRON, [0, 3.2, 0.03], [0, 3.2, 0.7], 0.05, 0.05);
    beam(b, base, IRON, [0, 2.85, 0.03], [0, 3.2, 0.5], 0.03, 0.03);
    return { extras: [lantern(b, base, 0, 2.75, 0.7)] };
  }
  cyl(b, base, IRON, 0, 0, 0, 0.16, 0.2, 0.5, 8);
  cyl(b, base, IRON, 0, 0.5, 0, 0.06, 0.1, 2.7, 6);
  box(b, base, IRON, 0, 2.6, 0, 0.5, 0.04, 0.04); // перекладина для лестницы фонарщика
  return { extras: [lantern(b, base, 0, 3.2, 0)] };
}

// Скамья: вариант 0 — со спинкой, 1 — без
function bench(b, base, o, rng) {
  for (const k of [-1, 1]) {
    box(b, base, IRON, k * 0.75, 0, 0, 0.06, 0.45, 0.5);
    if (o.variant !== 1) beam(b, base, IRON, [k * 0.75, 0.45, -0.22], [k * 0.75, 0.88, -0.32], 0.06, 0.05);
  }
  for (let i = 0; i < 3; i++) box(b, base, jitterColor(WOOD, rng, 0.8), 0, 0.45, -0.17 + i * 0.17, 1.8, 0.05, 0.14);
  if (o.variant !== 1) for (const y of [0.62, 0.8]) box(b, base, jitterColor(WOOD, rng, 0.8), 0, y, -0.27 - (y - 0.62) * 0.25, 1.8, 0.12, 0.04, 0);
}

// Афишная тумба: цоколь, ствол, афиши по кругу, карниз, купол со шпилем
function advertColumn(b, base, o, rng) {
  cyl(b, base, GREEN_IRON, 0, 0, 0, 0.66, 0.72, 0.3, 12);
  cyl(b, base, GREEN_IRON, 0, 0.3, 0, 0.58, 0.58, 2.4, 12);
  const posters = [0xf2e6c4, 0xc23b2e, 0xf2c14e, 0x2f5fa8, 0xeee6d4, 0x3f7f4f];
  let a = rng() * Math.PI;
  for (let i = 0; i < 4; i++) {
    const len = 1.0 + rng() * 0.6, h = 0.9 + rng() * 0.8;
    b.add(new THREE.CylinderGeometry(0.6, 0.6, h, 6, 1, true, a, len), pick(posters, rng), at(base, 0, 0.6 + h / 2 + rng() * (2.0 - h), 0));
    a += len + 0.1;
  }
  cyl(b, base, GREEN_IRON, 0, 2.7, 0, 0.7, 0.62, 0.15, 12);
  b.add(new THREE.SphereGeometry(0.62, 12, 3, 0, Math.PI * 2, 0, Math.PI / 2), GREEN_IRON, at(base, 0, 2.85, 0, 1, 0.7, 1));
  cyl(b, base, GREEN_IRON, 0, 3.25, 0, 0.03, 0.06, 0.3, 5);
}

// Телеграфный столб: две траверсы с изоляторами; вариант 1 — провода с провисом на полпролёта (15 м) в обе стороны по X
function telegraphPole(b, base, o) {
  cyl(b, base, DARK, 0, 0, 0, 0.1, 0.14, 7, 6);
  const ins = [];
  for (const [y, w] of [[6.6, 1.2], [6.1, 0.8]]) {
    box(b, base, WOOD, 0, y, 0, 0.1, 0.1, w);
    for (const z of [-w / 2 + 0.08, w / 2 - 0.08]) { cyl(b, base, 0x6fa88a, 0, y + 0.1, z, 0.03, 0.05, 0.12, 5); ins.push([0, y + 0.22, z]); }
  }
  beam(b, base, WOOD, [0, 6.0, 0], [0, 6.55, 0.5], 0.05, 0.05);
  if (o.variant !== 1) return;
  for (const [x, y, z] of ins) for (const k of [-1, 1]) {
    let prev = [x, y, z];
    for (let i = 1; i <= 4; i++) {
      const t = i / 4, sag = 0.5 * 4 * (t * 0.5) * (1 - t * 0.5); // половина параболы до середины пролёта
      const pt = [k * 15 * t, y - sag, z];
      beam(b, base, IRON, prev, pt, 0.015, 0.015);
      prev = pt;
    }
  }
}

// Фонтан. south — ярусный: восьмигранная чаша, две чаши на стволе; north, atlantic — чугунная колонка с корытом.
function fountain(b, base, o, rng) {
  const s = o.style ?? 'atlantic', p = palette(s);
  if (s === 'south') {
    const st = jitterColor(p.stone, rng, 0.4), r8 = Math.PI / 8;
    cyl(b, base, st, 0, 0, 0, 2.0, 2.05, 0.6, 8, r8);
    cyl(b, base, WATER, 0, 0.5, 0, 1.8, 1.8, 0.02, 8, r8);
    cyl(b, base, st, 0, 0.5, 0, 0.22, 0.3, 1.1, 8);
    cyl(b, base, st, 0, 1.6, 0, 0.9, 0.3, 0.35, 10);
    cyl(b, base, WATER, 0, 1.92, 0, 0.82, 0.82, 0.02, 10);
    cyl(b, base, st, 0, 1.9, 0, 0.12, 0.16, 0.6, 8);
    cyl(b, base, st, 0, 2.5, 0, 0.45, 0.15, 0.2, 8);
    cyl(b, base, WATER, 0, 2.68, 0, 0.4, 0.4, 0.02, 8);
    cyl(b, base, st, 0, 2.7, 0, 0.04, 0.1, 0.25, 6);
    cyl(b, base, 0xa8d0e0, 0, 2.95, 0, 0.03, 0.05, 0.25, 5); // струя
    return;
  }
  const iron = s === 'north' ? GREEN_IRON : IRON;
  box(b, base, p.stone, 0, 0, -0.4, 0.7, 0.2, 0.7);
  cyl(b, base, iron, 0, 0.2, -0.4, 0.13, 0.17, 1.5, 8);
  cyl(b, base, iron, 0, 1.7, -0.4, 0.2, 0.14, 0.15, 8);
  b.add(new THREE.SphereGeometry(0.14, 8, 4), iron, at(base, 0, 1.92, -0.4));
  beam(b, base, iron, [0, 1.6, -0.25], [0, 1.25, 0.15], 0.06, 0.04); // носик
  beam(b, base, iron, [0.12, 1.55, -0.4], [0.55, 1.95, -0.4], 0.04, 0.04); // рычаг
  const trough = s === 'north' ? p.stone : WOOD;
  box(b, base, trough, 0, 0, 0.6, 1.6, 0.5, 0.8);
  box(b, base, WATER, 0, 0.46, 0.6, 1.4, 0.02, 0.6);
}

// Памятник: вариант 0 — фигура на постаменте, 1 — обелиск
function monument(b, base, o, rng) {
  const st = jitterColor(STONE, rng, 0.4);
  box(b, base, st, 0, 0, 0, 3, 0.3, 3);
  box(b, base, st, 0, 0.3, 0, 2.2, 0.3, 2.2);
  if (o.variant === 1) {
    box(b, base, st, 0, 0.6, 0, 1.2, 1.0, 1.2);
    box(b, base, BRONZE, 0, 1.0, 0.61, 0.6, 0.4, 0.02); // доска
    cyl(b, base, st, 0, 1.6, 0, 0.3, 0.48, 3.6, 4, Math.PI / 4);
    spire(b, base, st, 0, 5.2, 0, 0.3, 0.45, 4);
    return;
  }
  box(b, base, st, 0, 0.6, 0, 1.1, 1.6, 1.1);
  box(b, base, st, 0, 2.2, 0, 1.3, 0.15, 1.3);
  box(b, base, BRONZE, 0, 1.2, 0.56, 0.5, 0.35, 0.02);
  const y = 2.35; // фигура: ноги, сюртук, голова, рука вперёд
  for (const k of [-1, 1]) box(b, base, BRONZE, k * 0.13, y, 0, 0.18, 0.85, 0.22);
  b.add(new THREE.CylinderGeometry(0.22, 0.32, 0.9, 6), BRONZE, at(base, 0, y + 1.2, 0));
  b.add(new THREE.SphereGeometry(0.15, 6, 4), BRONZE, at(base, 0, y + 1.82, 0));
  beam(b, base, BRONZE, [0.25, y + 1.5, 0], [0.45, y + 1.75, 0.4], 0.11, 0.11);
  beam(b, base, BRONZE, [-0.25, y + 1.5, 0], [-0.32, y + 0.95, 0.05], 0.1, 0.1);
}

// Коновязь с поилкой
function hitchingPost(b, base, o, rng) {
  for (const k of [-1, 1]) cyl(b, base, DARK, k * 1.3, 0, -0.2, 0.08, 0.09, 1.1, 6);
  box(b, base, jitterColor(WOOD, rng), 0, 1.0, -0.2, 2.8, 0.1, 0.1);
  for (const x of [-0.6, 0.6]) b.add(new THREE.TorusGeometry(0.08, 0.015, 4, 8), IRON, at(base, x, 0.9, -0.14));
  box(b, base, STONE, 0, 0, 0.35, 1.6, 0.5, 0.6);
  box(b, base, WATER, 0, 0.46, 0.35, 1.4, 0.02, 0.4);
}

// Киоск: шестигранный, остеклённый пояс, прилавок, шатёр с навершием
function kiosk(b, base, o, rng) {
  const c = pick([0x2f5f4a, 0x2f4a6a, 0x6a2f2f, 0x4a4a3a], rng), r6 = Math.PI / 6;
  cyl(b, base, 0x8f8c86, 0, 0, 0, 1.05, 1.05, 0.2, 6, r6);
  cyl(b, base, c, 0, 0.2, 0, 0.95, 0.95, 0.9, 6, r6);
  cyl(b, base, 0x2e3d48, 0, 1.1, 0, 0.93, 0.93, 0.8, 6, r6);
  for (let i = 0; i < 6; i++) { // стойки рам на рёбрах
    const a = i * Math.PI / 3;
    box(b, base, c, Math.sin(a) * 0.95, 1.1, Math.cos(a) * 0.95, 0.08, 0.8, 0.08);
  }
  cyl(b, base, c, 0, 1.9, 0, 1.0, 0.95, 0.4, 6, r6);
  box(b, base, WOOD, 0, 1.05, 1.0, 1.0, 0.06, 0.3); // прилавок у окна
  b.add(new THREE.ConeGeometry(1.35, 0.9, 6), c, at(base, 0, 2.75, 0, 1, 1, 1, 0, r6, 0));
  b.add(new THREE.SphereGeometry(0.12, 6, 4), 0xc9a24a, at(base, 0, 3.25, 0));
}

// Флагшток: каменное основание, мачта, шар, вымышленный флаг (поле, крыж, кайма по seed —
// не государственные флаги)
function flagpole(b, base, o, rng) {
  box(b, base, STONE, 0, 0, 0, 0.6, 0.35, 0.6);
  cyl(b, base, 0xf4f1e8, 0, 0.35, 0, 0.04, 0.08, 8.6, 6);
  b.add(new THREE.SphereGeometry(0.09, 6, 4), 0xc9a24a, at(base, 0, 9.0, 0));
  const cols = [0x2f5fa8, RED, 0x2f6f4a, 0x5a2f6a, 0xf4f1e8, 0xf2c14e];
  const field = pick(cols, rng), canton = pick(cols.filter((c) => c !== field), rng), h = 0.9, w = 1.4, x = 0.06 + w / 2, y = 7.95;
  box(b, base, field, x, y, 0, w, h, 0.02);
  box(b, base, canton, 0.06 + w * 0.2, y + h * 0.55, 0.005, w * 0.4, h * 0.45, 0.025); // крыж
  box(b, base, canton, x, y, 0.005, w, h * 0.1, 0.025); // кайма снизу
}

// Беседка: восьмигранный настил, стойки, перила (вход к +Z), шатёр с навершием
function gazebo(b, base, o, rng) {
  const R = 2.3, r8 = Math.PI / 8, c = pick([0xf4f1e8, 0xe6dcc3, 0x8f7a62], rng);
  cyl(b, base, 0xb5ad9e, 0, 0, 0, 2.5, 2.55, 0.4, 8, r8);
  box(b, base, 0xb5ad9e, 0, 0, 2.7, 1.2, 0.2, 0.5); // ступень
  const pts = Array.from({ length: 8 }, (_, i) => { const a = r8 + i * Math.PI / 4; return [Math.sin(a) * R, Math.cos(a) * R]; });
  for (const [x, z] of pts) box(b, base, c, x, 0.4, z, 0.14, 2.4, 0.14);
  for (let i = 0; i < 8; i++) {
    const [x0, z0] = pts[i], [x1, z1] = pts[(i + 1) % 8];
    if (i === 7) continue; // вход между последней и первой стойкой
    for (const y of [0.55, 1.3]) beam(b, base, c, [x0, y, z0], [x1, y, z1], 0.08, 0.08);
    beam(b, base, c, [x0, 2.75, z0], [x1, 2.75, z1], 0.1, 0.16);
  }
  beam(b, base, c, [pts[7][0], 2.75, pts[7][1]], [pts[0][0], 2.75, pts[0][1]], 0.1, 0.16);
  b.add(new THREE.ConeGeometry(2.9, 1.6, 8), pick([0x6b625a, 0xb8583b, 0x2f4a3a], rng), at(base, 0, 2.85 + 0.8, 0, 1, 1, 1, 0, r8, 0));
  cyl(b, base, c, 0, 4.4, 0, 0.03, 0.08, 0.5, 5);
}

// Почтовый ящик-тумба
function postBox(b, base) {
  box(b, base, 0x3a3a3a, 0, 0, 0, 0.42, 0.08, 0.36);
  cyl(b, base, RED, 0, 0.08, 0, 0.17, 0.19, 1.0, 10);
  cyl(b, base, RED, 0, 1.08, 0, 0.21, 0.21, 0.06, 10);
  b.add(new THREE.SphereGeometry(0.2, 10, 3, 0, Math.PI * 2, 0, Math.PI / 2), RED, at(base, 0, 1.14, 0));
  box(b, base, 0x111111, 0, 0.88, 0.17, 0.16, 0.03, 0.03); // щель
  box(b, base, 0xf2e6c4, 0, 0.6, 0.18, 0.12, 0.08, 0.01); // табличка
}

export const STREET = {
  'street-lamp': { name: 'Фонарь', category: 'street', variants: 2, footprint: { w: 0.6, d: 0.8 }, build: streetLamp },
  bench: { name: 'Скамья', category: 'street', variants: 2, footprint: { w: 1.8, d: 0.7 }, build: bench },
  'advert-column': { name: 'Афишная тумба', category: 'street', footprint: { w: 1.5, d: 1.5 }, build: advertColumn },
  'telegraph-pole': { name: 'Телеграфный столб', category: 'street', variants: 2, footprint: { w: 0.5, d: 1.2 }, build: telegraphPole },
  fountain: { name: 'Фонтан', category: 'street', styles: true, footprint: { w: 4.2, d: 4.2 }, build: fountain },
  monument: { name: 'Памятник', category: 'street', variants: 2, footprint: { w: 3, d: 3 }, build: monument },
  'hitching-post': { name: 'Коновязь с поилкой', category: 'street', footprint: { w: 2.8, d: 1 }, build: hitchingPost },
  kiosk: { name: 'Киоск', category: 'street', footprint: { w: 2.7, d: 2.7 }, build: kiosk },
  flagpole: { name: 'Флагшток', category: 'street', footprint: { w: 1.6, d: 0.6 }, build: flagpole },
  gazebo: { name: 'Беседка', category: 'street', footprint: { w: 5.8, d: 5.8 }, build: gazebo },
  'post-box': { name: 'Почтовый ящик', category: 'street', footprint: { w: 0.45, d: 0.4 }, build: postBox },
};
