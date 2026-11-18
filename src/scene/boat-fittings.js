import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Фурнитура кетбота (deck_gear.gif, 11.jpg): иллюминаторы, поручни, утки, роульс, кранцы,
// бухта, решётчатые пайолы. Всё неподвижно относительно корпуса, поэтому собирается
// в несколько мешей — по одному на материал (mergeGeometries).
// Координаты — физики: x вперёд, y вверх, z на правый борт; pt() переводит в СК модели.

const V = (x, y, z) => new THREE.Vector3(x, y, z);

/**
 * h: { add, MAT, pt, lerpSt, deckY, edge, outlineW, CK, mastX, stemHead (Vector3, СК модели) }
 */
export function createFittings(h) {
  const { add, MAT, pt, lerpSt, deckY, edge, outlineW, CK } = h;
  const buckets = new Map();
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s1 = V(1, 1, 1);
  // put: геометрия в точку p (СК модели) с поворотом euler [x, y, z]
  function put(geo, mat, p, rot = [0, 0, 0], scale = s1) {
    if (rot.isQuaternion) q.copy(rot); else q.setFromEuler(new THREE.Euler(...rot, 'YXZ'));
    geo.applyMatrix4(m4.compose(p, q, scale));
    let g = geo.index ? geo.toNonIndexed() : geo;
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    if (!buckets.has(mat)) buckets.set(mat, []);
    buckets.get(mat).push(g);
  }
  // брусок между двумя точками (СК модели)
  const up = V(0, 1, 0), dir = V();
  function beam(a, b, w, hgt, mat) {
    dir.subVectors(b, a);
    const len = dir.length();
    const g = new THREE.BoxGeometry(w, hgt, len);
    const m = new THREE.Matrix4().lookAt(a, b, up);
    g.applyMatrix4(m.setPosition(a.clone().add(b).multiplyScalar(0.5)));
    put(g, mat, V(), [0, 0, 0]);
  }
  // уровень палубы в точке (x, z) физики
  const deckAt = (x, z) => deckY(lerpSt(x), z);
  // наружная нормаль стенки рубки (СК модели): стенка вертикальна, в плане идёт по outlineW
  const wallNormal = (x, side) => V(side, 0, (outlineW(x + 0.02) - outlineW(x - 0.02)) / 0.04).normalize();

  // ── иллюминаторы: по два на стенке рубки с каждого борта (латунное кольцо + стекло), нарочито крупные
  for (const x of [0.05, 0.75]) {
    for (const side of [-1, 1]) {
      const e = edge(x, side), y = e.y + 0.21;
      const n = wallNormal(x, side);
      const p = pt(x, y, e.z).addScaledVector(n, 0.01);
      const rot = new THREE.Quaternion().setFromUnitVectors(up, n);
      // нарочито крупные (×1.5 от реальных)
      put(new THREE.CylinderGeometry(0.128, 0.128, 0.025, 8), MAT.brass, p, rot);
      put(new THREE.CylinderGeometry(0.093, 0.093, 0.03, 8), MAT.glass, p.clone().addScaledVector(n, 0.004), rot);
    }
  }

  // ── поручни на крыше рубки: брус на трёх стойках с каждой стороны люка
  const roofY = (x, z) => { const e = edge(x, 1); return e.top + CK.crown * (1 - (z / e.z) ** 2); };
  for (const side of [-1, 1]) {
    const z = side * 0.52, xa = CK.xc + 0.15, xb = 1.05;
    const A = pt(xa, roofY(xa, z) + 0.07, z), B = pt(xb, roofY(xb, z) + 0.07, z);
    beam(A, B, 0.035, 0.035, MAT.wood);
    for (const t of [0.04, 0.5, 0.96]) {
      const x = xa + (xb - xa) * t, y0 = roofY(x, z);
      put(new THREE.BoxGeometry(0.035, 0.07, 0.05), MAT.wood, pt(x, y0 + 0.035, z));
    }
  }

  // ── утки: швартовая на баке перед мачтой и две кормовые на боковых проходах
  function cleat(x, z, yaw = 0) {
    const y = deckAt(x, z);
    put(new THREE.BoxGeometry(0.05, 0.04, 0.08), MAT.metal, pt(x, y + 0.02, z), [0, yaw, 0]);
    put(new THREE.BoxGeometry(0.035, 0.025, 0.22), MAT.metal, pt(x, y + 0.05, z), [0, yaw, 0]);
  }
  cleat(h.mastX + 0.3, 0);
  for (const side of [-1, 1]) { const x = -2.45; cleat(x, side * (lerpSt(x).b - 0.13), side * 0.12); }

  // ── носовой роульс на форштевне: две щеки и ролик, выступают вперёд
  const sh = h.stemHead, rollerZ = sh.z - 0.1;
  for (const sx of [-1, 1]) put(new THREE.BoxGeometry(0.018, 0.07, 0.2), MAT.metal, V(sx * 0.045, sh.y + 0.03, sh.z - 0.04));
  put(new THREE.CylinderGeometry(0.03, 0.03, 0.07, 6), MAT.darkWood, V(0, sh.y + 0.03, rollerZ), [0, 0, Math.PI / 2]);

  // ── бухта фала у мачты на палубе
  {
    const x = h.mastX - 0.32, z = -0.25;
    put(new THREE.TorusGeometry(0.13, 0.025, 3, 8), MAT.rope, pt(x, deckAt(x, z) + 0.025, z), [Math.PI / 2, 0, 0]);
    put(new THREE.TorusGeometry(0.1, 0.022, 3, 7), MAT.rope, pt(x + 0.02, deckAt(x, z) + 0.06, z + 0.01), [Math.PI / 2, 0, 0]);
  }

  // ── кранцы убраны на ходу: стоят на полу кокпита по левому борту, впритык к его кормовой стенке
    const fenderProf = [[0, -0.22], [0.06, -0.2], [0.09, -0.12], [0.09, 0.12], [0.06, 0.2], [0, 0.22]].map(([r, y]) => new THREE.Vector2(r, y));
  for (const z of [-0.2, -0.4]) {
    // кормовая стенка на этом z: первая точка, где обшивка выреза отходит от ДП дальше |z| + радиус
    let x = CK.x0;
    while (outlineW(x) - 0.035 < Math.abs(z) + 0.09) x += 0.005;
    put(new THREE.LatheGeometry(fenderProf, 6), MAT.white, pt(x + 0.1, CK.floorY + 0.22, z));
  }

  // ── решётчатые пайолы на полу кокпита: продольные рейки и поперечины
  {
    const xa = CK.x0 + 0.35, xb = CK.xc - 0.08, y = CK.floorY + 0.012;
    const hw = Math.min(outlineW(xa), outlineW(xb)) - CK.seatW + 0.02;
    const N = 5;
    for (let i = 0; i < N; i++) {
      const z = -hw + 2 * hw * (i + 0.5) / N;
      put(new THREE.BoxGeometry(2 * hw / N - 0.035, 0.022, xb - xa), MAT.spar, pt((xa + xb) / 2, y + 0.022, z));
    }
    for (let i = 0; i < 4; i++) {
      const x = xa + 0.08 + (xb - xa - 0.16) * i / 3;
      put(new THREE.BoxGeometry(2 * hw, 0.022, 0.05), MAT.darkWood, pt(x, y, 0));
    }
  }

  for (const [mat, geos] of buckets) add(new THREE.Mesh(mergeGeometries(geos), mat));
}
