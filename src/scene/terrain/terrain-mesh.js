import * as THREE from 'three';
import { propMaterial } from '../flora.js';

// Меш рельефа по полю высот: чанки chunk×chunk м, индексная сетка, цвет по вершинам.
// Грани ломаные за счёт flatShading материала (нормаль по производным в шейдере).
// Чанк с сушей или мелководьем (мельче deep м) — шаг step, глубокое море — шаг coarse.
// Шаги кратны шагу поля высот: вершины ложатся на его узлы, без биений билинейной выборки («лесенки»).
// По краю чанка — «юбка» вниз на skirt м: закрывает щели на стыке чанков разного шага.
// Цвет вершины даёт paint(x, z, h, color) — палитра биомов (biomes.js).

export function buildTerrain(hf, paint, { chunk = 200, step = 4, coarse = 25, deep = 15, skirt = 4 } = {}) {
  const [bx, bz, bw, bh] = hf.bounds;
  const group = new THREE.Group();
  const material = propMaterial();
  const c = new THREE.Color();
  let tris = 0;
  for (let cz = bz; cz < bz + bh - 1e-6; cz += chunk) {
    for (let cx = bx; cx < bx + bw - 1e-6; cx += chunk) {
      // шаг чанка: есть ли выше −deep хоть одна точка (проверка по узлам поля высот)
      let top = -Infinity;
      for (let z = cz; z <= cz + chunk; z += hf.step) for (let x = cx; x <= cx + chunk; x += hf.step) top = Math.max(top, hf.sample(x, z));
      const st = top > -deep ? step : coarse, n = Math.round(chunk / st), V = n + 1;
      const ring = 4 * n; // вершины юбки по периметру
      const pos = new Float32Array((V * V + ring) * 3), col = new Float32Array((V * V + ring) * 3);
      for (let j = 0; j < V; j++) {
        for (let i = 0; i < V; i++) {
          const x = cx + i * st, z = cz + j * st, h = hf.sample(x, z), k = j * V + i;
          pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
          paint(x, z, h, c);
          col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
        }
      }
      const idx = [];
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const a = j * V + i, b = a + 1, d = a + V, e = d + 1;
          // диагональ чередуется — меньше «полос» на склонах
          if ((i + j) & 1) idx.push(a, d, b, b, d, e); else idx.push(a, d, e, a, e, b);
        }
      }
      // юбка: обход периметра, каждой вершине края — копия ниже на skirt
      const edge = [];
      for (let i = 0; i < n; i++) edge.push(i);                       // север
      for (let j = 0; j < n; j++) edge.push(j * V + n);               // восток
      for (let i = n; i > 0; i--) edge.push(n * V + i);               // юг
      for (let j = n; j > 0; j--) edge.push(j * V);                   // запад
      edge.forEach((k, e) => {
        const s = V * V + e;
        pos[s * 3] = pos[k * 3]; pos[s * 3 + 1] = pos[k * 3 + 1] - skirt; pos[s * 3 + 2] = pos[k * 3 + 2];
        col.copyWithin(s * 3, k * 3, k * 3 + 3);
      });
      for (let e = 0; e < ring; e++) {
        const k0 = edge[e], k1 = edge[(e + 1) % ring], s0 = V * V + e, s1 = V * V + (e + 1) % ring;
        idx.push(k0, k1, s1, k0, s1, s0, k0, s1, k1, k0, s0, s1); // двусторонняя полоса
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, material);
      mesh.castShadow = st === step;
      mesh.receiveShadow = true;
      mesh.userData.step = st;
      group.add(mesh);
      tris += idx.length / 3;
    }
  }
  group.userData.tris = tris;
  return group;
}
