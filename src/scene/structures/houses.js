import * as THREE from 'three';
import { palette, box, cyl, spire, faceFrame, windowAt, doorAt, glow } from './kit.js';

// Жильё и общественные здания (категории A–B каталога docs/changes/structures-library/catalog.md).
// build(b, base, opts, rng) пишет в PropBatch и может вернуть { extras: [Object3D] } —
// детали, которые не ложатся в батч (светящийся фонарь), уже с применённой base.

// Фонарь маяка: светится, поэтому отдельный меш (glow), а не цвет вершин.
const lamp = (base, r, h, y) => glow(base, new THREE.CylinderGeometry(r, r, h, 8), 0, y + h / 2, 0);

// Маяк. atlantic — прежний маяк Маячного острова один в один (белая башня, красный пояс);
// north — красно-белые полосы, чёрная галерея; south — восьмигранная башня из известняка, медный купол.
function lighthouse(b, base, o = {}) {
  const style = o.style ?? 'atlantic';
  const p = palette(style);
  if (style === 'atlantic') {
    cyl(b, base, 0xf4f1e8, 0, 0, 0, 1.4, 1.9, 9, 10);
    cyl(b, base, 0xe9553b, 0, 3.5, 0, 1.62, 1.72, 2, 10);
    spire(b, base, 0xb8463a, 0, 10.6, 0, 1.5, 1.6, 8);
    return { extras: [lamp(base, 1.1, 1.6, 9)] };
  }
  if (style === 'north') {
    const H = 10, seg = 12;
    for (let i = 0; i < 5; i++) {
      const y0 = (i / 5) * H, y1 = ((i + 1) / 5) * H;
      const r0 = 2.0 - 0.6 * (y0 / H), r1 = 2.0 - 0.6 * (y1 / H);
      cyl(b, base, i % 2 ? 0xf4f1e8 : 0xc23b2e, 0, y0, 0, r1, r0, y1 - y0, seg);
    }
    cyl(b, base, p.metal, 0, H, 0, 1.9, 1.9, 0.25, seg); // галерея
    for (let i = 0; i < 12; i++) { // стойки перил
      const a = (i / 12) * Math.PI * 2;
      cyl(b, base, p.metal, Math.cos(a) * 1.8, H + 0.25, Math.sin(a) * 1.8, 0.03, 0.03, 0.8, 4);
    }
    cyl(b, base, p.metal, 0, H + 1.0, 0, 1.85, 1.85, 0.06, seg);
    cyl(b, base, p.metal, 0, H + 0.25, 0, 1.15, 1.15, 0.4, 8);
    spire(b, base, p.metal, 0, H + 2.15, 0, 1.4, 1.3, 8);
    cyl(b, base, p.metal, 0, H + 3.45, 0, 0.08, 0.12, 0.5, 6);
    // домик у подножия
    box(b, base, 0xf4f1e8, 0, 0, 2.6, 2.2, 2.2, 1.4);
    doorAt(b, faceFrame(base, '+z', 3.3), 0, { w: 0.8, h: 1.8, color: p.door, frame: p.trim });
    return { extras: [lamp(base, 1.05, 1.5, H + 0.65)] };
  }
  // south
  // восьмигранник повёрнут на π/8: к +Z смотрит грань, а не ребро
  const H = 9, seg = 8, rot = Math.PI / 8, apo = Math.cos(Math.PI / 8);
  cyl(b, base, p.stone, 0, 0, 0, 2.6, 2.8, 2.2, seg, rot); // цоколь с дверью
  cyl(b, base, p.trim, 0, 2.2, 0, 2.7, 2.7, 0.15, seg, rot);
  cyl(b, base, p.stone, 0, 2.2, 0, 1.5, 2.0, H - 2.2, seg, rot);
  cyl(b, base, p.trim, 0, H - 0.4, 0, 1.75, 1.6, 0.4, seg, rot); // карниз
  const towerR = (y) => (2.0 - 0.5 * (y - 2.2) / (H - 2.2)) * apo;
  cyl(b, base, p.stone, 0, H, 0, 1.9, 1.9, 0.2, seg); // галерея
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    cyl(b, base, p.metal, Math.cos(a) * 1.8, H + 0.2, Math.sin(a) * 1.8, 0.03, 0.03, 0.75, 4);
  }
  cyl(b, base, p.metal, 0, H + 0.92, 0, 1.85, 1.85, 0.06, 16);
  b.add(new THREE.SphereGeometry(1.2, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), p.copper,
    new THREE.Matrix4().copy(base).multiply(new THREE.Matrix4().makeTranslation(0, H + 1.9, 0)));
  cyl(b, base, p.copper, 0, H + 3.0, 0, 0.05, 0.1, 0.5, 6);
  doorAt(b, faceFrame(base, '+z', 2.65 * apo), 0, { w: 0.9, h: 1.85, color: p.door, frame: p.trim });
  for (const y of [4.6, 7.2]) windowAt(b, faceFrame(base, '+z', towerR(y)), 0, y, { ww: 0.38, wh: 0.75, frame: p.trim, glass: p.glass, sill: false });
  return { extras: [lamp(base, 1.1, 1.5, H + 0.4)] };
}

export const HOUSES = {
  lighthouse: { name: 'Маяк', category: 'housing', styles: true, footprint: { w: 4, d: 4 }, build: lighthouse },
};
