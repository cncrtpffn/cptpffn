import * as THREE from 'three';

// Контур ватерлинии: где обшивка объекта пересекает видимую воду (waves.heightAt), каждый кадр.
// На нём строятся бурун, брызги и «дырка» в воде для открытых лодок (createWaterlineCap).
//
// Лучевой метод — для фигур, звёздных относительно вертикальной оси (лодки, буи, бочки): при создании с меша
// снимается таблица радиусов r(луч, высота) — самое дальнее попадание горизонтального луча из оси.
// В кадре на каждом луче ищется высота y (СК объекта), где точка обшивки r(y)·dir лежит на воде: секущими
// с тёплым стартом от прошлого кадра. Воду под объектом даёт сетка выборок heightAt с шагом ~step
// (у миски 3×3, у 6-метровой лодки 4×7) и кусочно-биквадратичной интерполяцией (waterAt) — без heightAt в решателе. Сухая корма получается сама: луч назад ниже транца
// выходит через поднимающееся днище, там и замыкается контур.
//
// Лучи — по эллипсу габарита (x = a·sin φ, z = −b·cos φ): первый вперёд (−z, нос), обход против часовой
// сверху; на оконечностях лучи гуще. Число точек постоянно — ленты и эмиттеры без ресэмплинга.

// итераций секущих на луч за кадр (тёплый старт от прошлого кадра)
const ITER = 2;
// таблицы радиусов: по геометрии и параметрам — одинаковые объекты делят одну
const TABLES = new WeakMap();

function buildTable(geometry, rays, levels) {
  const key = `${rays}x${levels}`;
  let byGeo = TABLES.get(geometry);
  if (!byGeo) TABLES.set(geometry, (byGeo = new Map()));
  if (byGeo.has(key)) return byGeo.get(key);
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  const cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
  const a = (bb.max.x - bb.min.x) / 2, b = (bb.max.z - bb.min.z) / 2;
  // уровни чуть внутрь габарита: луч точно по кромке может проскочить
  const eps = (bb.max.y - bb.min.y) * 1e-3;
  const y0 = bb.min.y + eps, y1 = bb.max.y - eps;
  const dir = new Float32Array(rays * 2);
  for (let i = 0; i < rays; i++) {
    const f = 2 * Math.PI * i / rays;
    const x = a * Math.sin(f), z = -b * Math.cos(f), l = Math.hypot(x, z) || 1;
    dir[i * 2] = x / l; dir[i * 2 + 1] = z / l;
  }
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  const rc = new THREE.Raycaster();
  const o = new THREE.Vector3(), d = new THREE.Vector3(), hits = [];
  const r = new Float32Array(rays * levels);
  for (let i = 0; i < rays; i++) {
    for (let j = 0; j < levels; j++) {
      o.set(cx, y0 + (y1 - y0) * j / (levels - 1), cz);
      d.set(dir[i * 2], 0, dir[i * 2 + 1]);
      rc.set(o, d);
      hits.length = 0;
      mesh.raycast(rc, hits);
      let far = 0;
      for (const h of hits) far = Math.max(far, h.distance);
      r[i * levels + j] = far;
    }
  }
  const t = { rays, levels, cx, cz, a, b, y0, y1, dir, r };
  byGeo.set(key, t);
  return t;
}

// rays — точек контура; levels — уровней таблицы по высоте; margin — сетка воды шире габарита во столько раз
// (потребители берут waterAt и чуть снаружи корпуса: пена, брызги); step — наибольший шаг сетки воды, м
export function createWaterline(geometry, { rays = 32, levels = 24, margin = 1.3, step = 1.5 } = {}) {
  const T = buildTable(geometry, rays, levels);
  const { dir, r, y0, y1 } = T;
  const dy = (y1 - y0) / (levels - 1);

  // контур: pw, pl — точки в мире и в СК объекта; nw — наружная горизонтальная нормаль в мире (x, z);
  // s — путь от носа, м; awash — вода выше борта на луче (точка прижата к кромке); valid — посчитан в этом кадре
  const n = rays;
  const contour = {
    n, pw: new Float32Array(n * 3), pl: new Float32Array(n * 3), nw: new Float32Array(n * 2),
    s: new Float32Array(n), len: 0, awash: new Uint8Array(n), valid: false,
  };
  const ys = new Float32Array(n).fill(NaN); // решение по лучам с прошлого кадра
  const stats = { heightCalls: 0, ms: 0 };

  // сетка воды NX×NZ в плане объекта: центр (gx, gz), оси ex, ez (горизонтальные, ортонормированные),
  // полуразмеры ex, ez — hx, hz; узлов по оси — не меньше 3, шаг не больше step
  const hx = T.a * margin + 0.05, hz = T.b * margin + 0.05;
  const NX = Math.max(3, Math.ceil(2 * hx / step) + 1), NZ = Math.max(3, Math.ceil(2 * hz / step) + 1);
  const sx = 2 * hx / (NX - 1), sz = 2 * hz / (NZ - 1);
  const H = new Float32Array(NX * NZ);
  let gx = 0, gz = 0, exx = 1, exz = 0, ezx = 0, ezz = 1;

  // вода в точке мира (x, z) по сетке: биквадратичный Лагранж по 3×3 узлам вокруг ближайшего,
  // вне сетки — экстраполяция крайним блоком
  function waterAt(x, z) {
    const tu = (((x - gx) * exx + (z - gz) * exz) + hx) / sx, tv = (((x - gx) * ezx + (z - gz) * ezz) + hz) / sz;
    const cu = Math.min(NX - 2, Math.max(1, Math.round(tu))), cv = Math.min(NZ - 2, Math.max(1, Math.round(tv)));
    const u = tu - cu, v = tv - cv;
    const u0 = u * (u - 1) / 2, u1 = 1 - u * u, u2 = u * (u + 1) / 2;
    const v0 = v * (v - 1) / 2, v1 = 1 - v * v, v2 = v * (v + 1) / 2;
    const o = (cv - 1) * NX + cu - 1;
    return v0 * (u0 * H[o] + u1 * H[o + 1] + u2 * H[o + 2])
      + v1 * (u0 * H[o + NX] + u1 * H[o + NX + 1] + u2 * H[o + NX + 2])
      + v2 * (u0 * H[o + 2 * NX] + u1 * H[o + 2 * NX + 1] + u2 * H[o + 2 * NX + 2]);
  }

  // радиус луча i на высоте y (СК объекта): линейно между уровнями; ниже днища — 0, выше борта — как у кромки
  function radius(i, y) {
    const t = (y - y0) / dy;
    if (t <= 0) return t < -1 ? 0 : r[i * levels] * (1 + t);
    if (t >= levels - 1) return r[i * levels + levels - 1];
    const j = Math.floor(t), f = t - j;
    return r[i * levels + j] * (1 - f) + r[i * levels + j + 1] * f;
  }

  let me = null;
  const out = { x: 0, y: 0, z: 0 };
  // f(y) на луче i: высота точки обшивки над водой в мире; точка — в out
  function fOn(i, y) {
    const rr = radius(i, y);
    const lx = T.cx + rr * dir[i * 2], lz = T.cz + rr * dir[i * 2 + 1];
    out.x = me[0] * lx + me[4] * y + me[8] * lz + me[12];
    out.y = me[1] * lx + me[5] * y + me[9] * lz + me[13];
    out.z = me[2] * lx + me[6] * y + me[10] * lz + me[14];
    return out.y - waterAt(out.x, out.z);
  }

  function update(matrixWorld, waves) {
    const t0 = performance.now();
    me = matrixWorld.elements;
    // сетка воды: центр оси объекта и его оси в плане
    gx = me[0] * T.cx + me[8] * T.cz + me[12];
    gz = me[2] * T.cx + me[10] * T.cz + me[14];
    let l = Math.hypot(me[0], me[2]) || 1;
    exx = me[0] / l; exz = me[2] / l;
    ezx = me[8]; ezz = me[10];
    const dp = ezx * exx + ezz * exz;
    ezx -= dp * exx; ezz -= dp * exz;
    l = Math.hypot(ezx, ezz) || 1;
    ezx /= l; ezz /= l;
    for (let j = 0; j < NZ; j++) {
      for (let i = 0; i < NX; i++) {
        const u = i * sx - hx, v = j * sz - hz;
        H[j * NX + i] = waves.heightAt(gx + u * exx + v * ezx, gz + u * exz + v * ezz);
      }
    }
    stats.heightCalls = NX * NZ;
    // высота воды у оси в СК объекта — старт для лучей без прошлого решения
    const yStart = (waterAt(gx, gz) - me[13]) / (me[5] || 1);

    for (let i = 0; i < n; i++) {
      let ya = Number.isNaN(ys[i]) ? yStart : ys[i];
      let fa = fOn(i, ya);
      // второй узел секущих — шаг на величину невязки (наклон f по y ≈ 1)
      let yb = ya - fa;
      if (Math.abs(yb - ya) < 1e-5) yb = ya + 1e-3;
      for (let it = 0; it < ITER; it++) {
        const fb = fOn(i, yb);
        const den = fb - fa;
        const yn = Math.abs(den) > 1e-7 ? yb - fb * (yb - ya) / den : yb - fb;
        ya = yb; fa = fb;
        // не уходить дальше таблицы: ниже днища на уровень, выше кромки — прижать
        yb = Math.min(y1, Math.max(y0 - dy, yn));
      }
      ys[i] = yb;
      fOn(i, yb);
      contour.awash[i] = yb >= y1 ? 1 : 0;
      contour.pw[i * 3] = out.x; contour.pw[i * 3 + 1] = out.y; contour.pw[i * 3 + 2] = out.z;
      const rr = radius(i, yb);
      contour.pl[i * 3] = T.cx + rr * dir[i * 2]; contour.pl[i * 3 + 1] = yb; contour.pl[i * 3 + 2] = T.cz + rr * dir[i * 2 + 1];
    }
    // путь от носа и наружные нормали (касательная по соседям в окне ~0.3 м; обход против часовой → наружу (dz, −dx))
    let L = 0;
    for (let i = 0; i < n; i++) {
      contour.s[i] = L;
      const j = (i + 1) % n;
      L += Math.hypot(contour.pl[j * 3] - contour.pl[i * 3], contour.pl[j * 3 + 2] - contour.pl[i * 3 + 2]);
    }
    contour.len = L;
    const w = Math.max(1, Math.round(0.3 / (L / n || 1)));
    for (let i = 0; i < n; i++) {
      const a = ((i - w) % n + n) % n, b = (i + w) % n;
      const dx = contour.pl[b * 3] - contour.pl[a * 3], dz = contour.pl[b * 3 + 2] - contour.pl[a * 3 + 2];
      const nx = me[0] * dz - me[8] * dx, nz = me[2] * dz - me[10] * dx;
      const k = Math.hypot(nx, nz) || 1;
      contour.nw[i * 2] = nx / k; contour.nw[i * 2 + 1] = nz / k;
    }
    contour.valid = true;
    stats.ms = performance.now() - t0;
  }

  // контур устарел (объект не считали в этом кадре)
  function invalidate() { contour.valid = false; }

  // наибольшее |y − вода| по точкам контура, м (для проверки); grid — против сетки waterAt вместо heightAt
  function error(waves, grid = false) {
    let m = 0;
    for (let i = 0; i < n; i++) {
      const x = contour.pw[i * 3], z = contour.pw[i * 3 + 2];
      m = Math.max(m, Math.abs(contour.pw[i * 3 + 1] - (grid ? waterAt(x, z) : waves.heightAt(x, z))));
    }
    return m;
  }

  return { contour, update, invalidate, waterAt, error, stats, table: T, grid: [NX, NZ] };
}

// «Дырка» в воде внутри контура: невидимая крышка-веер пишет 1 в стенсил, вода с stencilFunc NotEqual 1
// (water.js) там не рисуется. Глубина тестируется: где крышку заслоняет борт, метки нет и вода за бортом цела.
// Рисуется после объекта и до воды (renderOrder 1). Нужен WebGLRenderer({ stencil: true }).
// lift — крышка чуть выше воды, м: волна внутри корпуса не выглядывает между крышкой и дальним бортом
export function createWaterlineCap(n, { lift = 0.03 } = {}) {
  // n точек контура + центр; веер с постоянными индексами
  const pos = new Float32Array((n + 1) * 3);
  const index = [];
  for (let i = 0; i < n; i++) index.push(n, i, (i + 1) % n);
  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', posAttr);
  geo.setIndex(index);
  const mat = new THREE.MeshBasicMaterial({
    colorWrite: false, depthWrite: false, side: THREE.DoubleSide,
    stencilWrite: true, stencilRef: 1, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 1;
  mesh.frustumCulled = false;
  mesh.userData.dynamic = true;

  function update(contour) {
    mesh.visible = contour.valid;
    if (!mesh.visible) return;
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n; i++) {
      pos[i * 3] = contour.pw[i * 3]; pos[i * 3 + 1] = contour.pw[i * 3 + 1] + lift; pos[i * 3 + 2] = contour.pw[i * 3 + 2];
      cx += pos[i * 3]; cy += pos[i * 3 + 1]; cz += pos[i * 3 + 2];
    }
    pos[n * 3] = cx / n; pos[n * 3 + 1] = cy / n; pos[n * 3 + 2] = cz / n;
    posAttr.needsUpdate = true;
  }

  return { mesh, update };
}

// Маска по кромке борта для дальних открытых объектов — как крышка кокпита (boat-mesh.js): невидимый веер
// по верху обшивки пишет только глубину, рисуется после объекта и до воды (renderOrder 1, у воды 2) — вода
// внутри ниже кромки не проходит тест глубины. Без стенсила, поэтому работает и над дальним кольцом воды.
// Кромка — по таблице радиусов: на каждом луче верхний уровень с попаданием. Геометрия статичная, в СК
// объекта (меш — дочерний к объекту), общая на все объекты с этой таблицей. Волна выше кромки видна.
export function createWaterlineMask(table) {
  if (!table.maskGeo) {
    const { rays, levels, dir, r, y0, y1 } = table;
    const pos = new Float32Array((rays + 1) * 3);
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < rays; i++) {
      let j = levels - 1;
      while (j > 0 && r[i * levels + j] === 0) j--;
      const rr = r[i * levels + j], y = y0 + (y1 - y0) * j / (levels - 1) - 0.01;
      pos[i * 3] = table.cx + rr * dir[i * 2]; pos[i * 3 + 1] = y; pos[i * 3 + 2] = table.cz + rr * dir[i * 2 + 1];
      cx += pos[i * 3]; cy += y; cz += pos[i * 3 + 2];
    }
    pos[rays * 3] = cx / rays; pos[rays * 3 + 1] = cy / rays; pos[rays * 3 + 2] = cz / rays;
    const index = [];
    for (let i = 0; i < rays; i++) index.push(rays, i, (i + 1) % rays);
    table.maskGeo = new THREE.BufferGeometry();
    table.maskGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    table.maskGeo.setIndex(index);
  }
  const mask = new THREE.Mesh(table.maskGeo, new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide }));
  mask.renderOrder = 1;
  mask.userData.dynamic = true; // не сливать: порядок отрисовки свой
  return mask;
}

// Открытый корпус (гребная лодка) с дыркой в воде и уровнем детализации: ближе near к центру ближней воды
// (лодка игрока) — точный контур и стенсил-крышка по нему (контур берут и бурун, брызги); дальше near·HYST —
// контур не считается, воду внутри закрывает маска по кромке. Гистерезис — без мигания на границе.
// mask добавить дочерним к объекту, cap.mesh — в сцену (крышка в мировых координатах).
const HYST = 1.15;
export function createOpenHull(geometry, { rays = 32, near = 60 } = {}) {
  const waterline = createWaterline(geometry, { rays });
  const cap = createWaterlineCap(rays);
  const mask = createWaterlineMask(waterline.table);
  let isNear = false;

  // object — с актуальной matrixWorld; cx, cz — центр ближней воды
  function update(object, waves, cx, cz) {
    const e = object.matrixWorld.elements;
    const d = Math.hypot(e[12] - cx, e[14] - cz);
    isNear = d < near * (isNear ? HYST : 1);
    mask.visible = !isNear;
    if (isNear) {
      waterline.update(object.matrixWorld, waves);
    } else {
      waterline.invalidate();
    }
    cap.update(waterline.contour);
  }

  return { waterline, cap, mask, update, get near() { return isNear; } };
}
