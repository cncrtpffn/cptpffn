import * as THREE from 'three';
import { WAKE_POINTS } from './water-fx.js';
import { BOAT } from '../config.js';

const BOW = BOAT.length / 2 - 0.1; // от ЦТ до форштевня на ВЛ, м

// Кильватерный след: точки у форштевня, от новой к старой; передаётся в шейдер воды.
export function createWake({ life = 12 } = {}) {
  const trail = Array.from({ length: WAKE_POINTS }, () => new THREE.Vector4());
  // габарит следа (minX, minZ, maxX, maxZ) с шириной усов — шейдер воды за ним след не считает
  const box = new THREE.Vector4();
  const points = []; // { x, z, t0, s }
  const state = { trail, box, count: 0 };

  function update(time, boat) {
    const bx = boat.x + Math.sin(boat.psi) * BOW, bz = boat.z - Math.cos(boat.psi) * BOW;
    const s = Math.max(0, boat.u);
    const last = points[0];
    if (!last || Math.hypot(bx - last.x, bz - last.z) > Math.max(0.8, s * 0.3)) {
      points.unshift({ x: bx, z: bz, t0: time, s });
    }
    while (points.length > WAKE_POINTS - 1 || (points.length && time - points[points.length - 1].t0 > life)) points.pop();
    // точка 0 — текущее положение форштевня
    trail[0].set(bx, bz, 0, s);
    points.forEach((p, i) => trail[i + 1].set(p.x, p.z, time - p.t0, p.s));
    state.count = points.length + 1;
    box.set(Infinity, Infinity, -Infinity, -Infinity);
    for (let i = 0; i < state.count; i++) {
      const q = trail[i], a = q.z;
      // полуширина: ус на 0.5 + s·a·0.354 плюс его толщина (WAKE_GLSL), с запасом
      const r = 0.5 + q.w * a * 0.354 + 0.22 + 0.09 * a + 0.5;
      box.x = Math.min(box.x, q.x - r); box.y = Math.min(box.y, q.y - r);
      box.z = Math.max(box.z, q.x + r); box.w = Math.max(box.w, q.y + r);
    }
  }

  function reset() { points.length = 0; state.count = 0; }

  return Object.assign(state, { update, reset });
}
