import * as THREE from 'three';
import { createOpenHull } from '../scene/waterline.js';

// точек контура у миски
const RAYS = 32;

// Отладка (?bowl=N): N открытых «мисок» на воде сеткой с шагом 4 м от точки (x, z) — корпус без палубы с полом
// ниже воды, как у гребной лодки. Каждая садится на волну и наклоняется по её уклону. Проверка контура
// ватерлинии и дырки в воде (createOpenHull: рядом с лодкой — контур и стенсил-крышка, вдали — маска по кромке;
// таблица радиусов общая — одна геометрия): внутри мисок воды быть не должно.
// stats: ms — время всех контуров за кадр, near — сколько мисок считают контур.
export function createTestBowls(count, x, z) {
  // профиль от дна к кромке: радиус, высота от ватерлинии покоя
  const prof = [[0, -0.35], [0.5, -0.33], [0.85, -0.22], [1.05, 0], [1.15, 0.25]].map(([r, y]) => new THREE.Vector2(r, y));
  const geo = new THREE.LatheGeometry(prof, 32);
  const mat = new THREE.MeshStandardMaterial({ color: 0xc8643c, side: THREE.DoubleSide, roughness: 0.8 });
  const side = Math.ceil(Math.sqrt(count));
  const bowls = Array.from({ length: count }, (_, i) => {
    const shell = new THREE.Mesh(geo, mat);
    shell.castShadow = true;
    const hull = createOpenHull(geo, { rays: RAYS });
    shell.add(hull.mask);
    // крышка — в мировых координатах, в сцену добавляется отдельно
    return { x: x + (i % side) * 4, z: z - Math.floor(i / side) * 4, shell, hull, waterline: hull.waterline };
  });
  const stats = { ms: 0, near: 0 };

  const R = 0.9;
  // cx, cz — центр ближней воды (лодка игрока); edgeAt — доля волны в видимой воде (water.edgeAt):
  // вдали миска садится на погашенную волну, как её рисует вода
  function update(waves, cx, cz, edgeAt) {
    let ms = 0, near = 0;
    for (const b of bowls) {
      const e = edgeAt(b.x, b.z);
      const h0 = waves.heightAt(b.x, b.z) * e;
      const hx = e * (waves.heightAt(b.x + R, b.z) - waves.heightAt(b.x - R, b.z)) / (2 * R);
      const hz = e * (waves.heightAt(b.x, b.z + R) - waves.heightAt(b.x, b.z - R)) / (2 * R);
      b.shell.position.set(b.x, h0, b.z);
      // уклон воды: +z выше — поворот вокруг x отрицательный, +x выше — вокруг z положительный
      b.shell.rotation.set(-Math.atan(hz), 0, Math.atan(hx), 'XYZ');
      b.shell.updateMatrixWorld();
      b.hull.update(b.shell, waves, cx, cz);
      if (b.hull.near) { near++; ms += b.waterline.stats.ms; }
    }
    stats.ms = ms; stats.near = near;
  }

  return { objects: bowls.flatMap((b) => [b.shell, b.hull.cap.mesh]), bowls, update, stats };
}
