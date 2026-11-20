import { edt, isolines, simplify, chaikin, resample, pathLength, polyline, traceGradient, makeRouter, gradeAlong, maxGrade } from './geom.js';

// Проектирование поселений и всего антропогенного (шаг между биомами и объектами): только данные, без three.js.
//
// Для порта, города и деревни:
//   граница  — заливка от центра по пригодной суше (тот же остров, не круто), до площади π r² × k: сама тянется вдоль берега;
//   улицы    — продольные по изолиниям поля F: на ровном F — расстояние до воды (улицы повторяют берег),
//              на склоне — высота (террасы по горизонталям); первая улица у воды — набережная или главная;
//              периметр каждой зоны — переулок (ring) или полевая дорога (track);
//              поперечные — по полосам между продольными, вверх по градиенту F со скосом: T-перекрёстки, углы не прямые;
//              уклон проезжих путей не круче 15 %: подрезка рельефа, серпантин (ramp), иначе лестница;
//   площадь  — самое ровное место 20×20 м у главной улицы ближе к центру; резервы общественных зданий — вокруг неё;
//   зоны     — core, residential, waterfront в границе; outskirts и fields в кольце за ней;
//   причалы  — точки на кромке, где в 20 м от берега достаточно глубоко.
// Маяк и причал маяка — точка и направление к морю. Дороги — остовное дерево по острову, A* между концами улиц.
// Навигационные знаки (МАМС, регион A): латеральные буи на входе в бухты с поселением, кардинальные у групп камней,
// знак отдельной опасности над камнями, целиком скрытыми водой.
//
// opts.footprint(id) → { w, d } — размеры построек (из библиотеки src/scene/structures).
// Подсказки площадки в описании карты: field ('shore' | 'height'), spacing (шаг продольных улиц, м), streets (ручные ломаные).

export const PLAN_ZONES = ['none', 'core', 'residential', 'waterfront', 'outskirts', 'fields'];
const PZ = Object.fromEntries(PLAN_ZONES.map((z, i) => [z, i]));
const AREA_K = { port: 1.6, town: 1.4, village: 1.2 };
const ORDER = { port: 0, town: 1, village: 2, landing: 3, lighthouse: 4 };
const PUBLIC = {
  port: ['church', 'town-hall', 'customs', 'market', 'tavern', 'warehouse', 'warehouse', 'pilot-station'],
  town: ['church', 'town-hall', 'market', 'tavern'],
  village: ['chapel', 'tavern'],
};
const HARBOR_USE = new Set(['warehouse', 'customs', 'pilot-station']);
const ROAD = { port: 'road-cobble', town: 'road-cobble', village: 'road-dirt' };
const REACH = { 'pier-stone': 40, 'pier-wood': 22, 'quay-wall': 8, 'jetty-small': 10 }; // длина причала: глубина у его конца
const HW = { 'road-cobble': 2.9, 'road-dirt': 2.1, path: 0.9, stairs: 3.5 }; // полуширина ленты с обочиной
// предельный уклон (окно 6 м): проезжие пути — VEH, тропы — FOOT; круче — серпантин, подрезка рельефа или лестница
const VEH = 0.15, FOOT = 0.25;
const FOOTWAY = new Set(['stairs', 'path']);

export function planSettlements(hf, bio, map, { footprint }) {
  const t0 = performance.now();
  const W = hf.size, st = hf.step, [x0, z0] = hf.bounds, H = hf.heights, N = W * W;
  const cellOf = (x, z) => {
    const i = Math.round((x - x0) / st), j = Math.round((z - z0) / st);
    return i < 0 || j < 0 || i >= W || j >= W ? -1 : j * W + i;
  };
  const xy = (k) => [x0 + (k % W) * st, z0 + ((k / W) | 0) * st];

  // расстояние до воды по суше, м (на воде 0)
  const land = new Uint8Array(N);
  for (let k = 0; k < N; k++) land[k] = H[k] > 0 ? 1 : 0;
  const d2 = edt(land, 0, W, W), toWater = new Float32Array(N);
  for (let k = 0; k < N; k++) toWater[k] = land[k] ? Math.sqrt(d2[k]) * st : 0;
  const sampleField = (f) => (x, z) => {
    const fx = Math.min(W - 1.001, Math.max(0, (x - x0) / st)), fz = Math.min(W - 1.001, Math.max(0, (z - z0) / st));
    const i = Math.floor(fx), j = Math.floor(fz), tx = fx - i, tz = fz - j, k = j * W + i;
    return (f[k] * (1 - tx) + f[k + 1] * tx) * (1 - tz) + (f[k + W] * (1 - tx) + f[k + W + 1] * tx) * tz;
  };
  const waterDist = sampleField(toWater);
  const slopeAt = (k) => {
    const i = k % W, j = (k / W) | 0;
    if (i < 1 || j < 1 || i >= W - 1 || j >= W - 1) return 1;
    return Math.hypot(H[k + 1] - H[k - 1], H[k + W] - H[k - W]) / (2 * st);
  };
  const ownerNear = (x, z) => {
    for (let r = 0; r <= 10; r++) for (let a = 0; a < 8; a++) {
      const k = cellOf(x + Math.cos(a * Math.PI / 4) * r * st, z + Math.sin(a * Math.PI / 4) * r * st);
      if (k >= 0 && hf.owner[k] >= 0 && H[k] > 0) return hf.owner[k];
    }
    return -1;
  };

  const siteOf = new Int16Array(N).fill(-1); // чья граница
  const zone = new Uint8Array(N);            // PLAN_ZONES
  const cur = new Uint8Array(N);             // маска текущей площадки (очищается после неё)

  // кромка воды от (x, z) по направлению (dx, dz), не дальше max
  function edge(x, z, dx, dz, max) {
    let hp = hf.sample(x, z);
    if (hp < 0) return null;
    for (let t = 1; t <= max; t += 1) {
      const h = hf.sample(x + dx * t, z + dz * t);
      if (h < 0) { const k = t - 1 + hp / (hp - h); return { x: x + dx * k, z: z + dz * k, t: k }; }
      hp = h;
    }
    return null;
  }
  function seaNormal(x, z) {
    const e = 3, gx = hf.sample(x + e, z) - hf.sample(x - e, z), gz = hf.sample(x, z + e) - hf.sample(x, z - e), l = Math.hypot(gx, gz) || 1;
    return [-gx / l, -gz / l];
  }
  function seaward(x, z, max) {
    let best = null;
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2, e = edge(x, z, Math.cos(a), Math.sin(a), max);
      if (e && (!best || e.t < best.t)) best = { ...e, dx: Math.cos(a), dz: Math.sin(a) };
    }
    return best;
  }

  // расстояние от точки до ломаной
  function distTo(px, pz, pts) {
    let best = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
      best = Math.min(best, Math.hypot(px - ax - dx * t, pz - az - dz * t));
    }
    return best;
  }
  // ломаная минус окрестность других улиц: куски длиннее minLen
  function clipNear(pts, others, d, minLen) {
    const runs = [[]];
    for (const p of pts) {
      if (others.some((o) => distTo(p[0], p[1], o) < d)) { if (runs.at(-1).length) runs.push([]); } else runs.at(-1).push(p);
    }
    return runs.filter((r) => r.length > 1 && pathLength(r) >= minLen);
  }
  const smoothLine = (pts) => chaikin(chaikin(simplify(pts, 1.5)));
  // ближайшая точка ломаной: расстояние, точка, касательная отрезка
  function nearestOn(px, pz, pts) {
    let best = { d: Infinity, x: px, z: pz, tx: 1, tz: 0 };
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
      if (!l2) continue;
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)), x = ax + dx * t, z = az + dz * t, d = Math.hypot(px - x, pz - z);
      if (d < best.d) { const l = Math.sqrt(l2); best = { d, x, z, tx: dx / l, tz: dz / l }; }
    }
    return best;
  }
  // куски ломаной, не идущие вдоль других улиц (ближе d и почти параллельно); пересечения не режутся
  // (короткие «покрытые» куски < 12 м остаются); оборванный у улицы конец дотягивается до неё — выходит примыкание
  function notAlong(pts, others, d, minLen) {
    const n = pts.length, cov = new Uint8Array(n), near = new Array(n);
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      let tx = b[0] - a[0], tz = b[1] - a[1];
      const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
      for (const o of others) {
        const q = nearestOn(pts[i][0], pts[i][1], o);
        if (q.d >= d) continue;
        near[i] = q;
        if (Math.abs(tx * q.tx + tz * q.tz) > 0.75) { cov[i] = 1; break; }
      }
    }
    for (let i = 0; i < n;) {
      if (!cov[i]) { i++; continue; }
      let j = i, L = 0;
      while (j + 1 < n && cov[j + 1]) { L += Math.hypot(pts[j + 1][0] - pts[j][0], pts[j + 1][1] - pts[j][1]); j++; }
      if (L < 12) for (let m = i; m <= j; m++) cov[m] = 0;
      i = j + 1;
    }
    const runs = [];
    for (let i = 0; i < n;) {
      if (cov[i]) { i++; continue; }
      let j = i;
      while (j + 1 < n && !cov[j + 1]) j++;
      const run = pts.slice(i, j + 1);
      if (i > 0 && near[i - 1]) run.unshift([near[i - 1].x, near[i - 1].z]);
      if (j < n - 1 && near[j + 1]) run.push([near[j + 1].x, near[j + 1].z]);
      if (pathLength(run) >= minLen) runs.push(run);
      i = j + 1;
    }
    return runs;
  }
  // деление пути по уклону (окно 6 м): до VEH — как есть; круче — пешком: у троп и полевых дорог до FOOT — тропа,
  // у улиц — лестница; круче FOOT — всегда лестница. Куски короче 6 м сливаются с соседями.
  function splitGrade(pts, cls, road) {
    const q = resample(pts, 2), n = q.length, h = q.map(([x, z]) => hf.sample(x, z));
    const soft = cls === 'track' || cls === 'path';
    const kind = q.map((_, i) => {
      const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 2), g = Math.abs(h[b] - h[a]) / Math.max(1, pathLength(q.slice(a, b + 1)));
      return g <= VEH ? (cls === 'path' ? 1 : 0) : g <= FOOT && soft ? 1 : 2;
    });
    for (let i = 0; i < n;) { let j = i; while (j + 1 < n && kind[j + 1] === kind[i]) j++; if (j - i < 3 && i > 0) for (let m = i; m <= j; m++) kind[m] = Math.max(kind[m], kind[i - 1]); i = j + 1; }
    const as = [{ cls, road }, { cls: 'path', road: 'path' }, { cls: 'stairs', road: 'stairs' }], out = [];
    for (let i = 0; i < n - 1;) {
      let j = i;
      while (j + 1 < n && kind[j + 1] === kind[i]) j++;
      out.push({ ...as[kind[i]], pts: q.slice(i, Math.min(n, j + 2)) });
      i = j + 1;
    }
    return out.filter((l) => l.pts.length > 1);
  }
  // перекрёстки сети: T — конец ломаной у середины другой, X — пересечение вдали от концов; angle — острый угол, °
  function junctionsOf(lines) {
    const out = [];
    const acute = (ax, az, bx, bz) => Math.acos(Math.min(1, Math.abs(ax * bx + az * bz))) * 180 / Math.PI;
    const isEnd = (x, z, pts) => Math.hypot(x - pts[0][0], z - pts[0][1]) < 5 || Math.hypot(x - pts.at(-1)[0], z - pts.at(-1)[1]) < 5;
    const box = lines.map((l) => { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (const [x, z] of l.pts) { a = Math.min(a, x); b = Math.min(b, z); c = Math.max(c, x); d = Math.max(d, z); } return [a - 4, b - 4, c + 4, d + 4]; });
    lines.forEach((a, ia) => {
      for (const end of [0, 1]) {
        const e = end ? a.pts.at(-1) : a.pts[0], f = end ? a.pts[Math.max(0, a.pts.length - 3)] : a.pts[Math.min(a.pts.length - 1, 2)];
        let best = null;
        lines.forEach((b, ib) => {
          if (ib === ia || e[0] < box[ib][0] || e[0] > box[ib][2] || e[1] < box[ib][1] || e[1] > box[ib][3]) return;
          const q = nearestOn(e[0], e[1], b.pts);
          if (q.d < 3.5 && (!best || q.d < best.d)) best = { ...q, b };
        });
        if (!best || isEnd(best.x, best.z, best.b.pts)) continue; // продолжение или стык концами — не перекрёсток
        const dx = e[0] - f[0], dz = e[1] - f[1], l = Math.hypot(dx, dz) || 1;
        out.push({ x: best.x, z: best.z, type: 'T', angle: acute(dx / l, dz / l, best.tx, best.tz) });
      }
    });
    for (let ia = 0; ia < lines.length; ia++) for (let ib = ia + 1; ib < lines.length; ib++) {
      const A = lines[ia].pts, B = lines[ib].pts, ba = box[ia], bb = box[ib];
      if (ba[0] > bb[2] || bb[0] > ba[2] || ba[1] > bb[3] || bb[1] > ba[3]) continue;
      for (let i = 0; i < A.length - 1; i++) for (let j = 0; j < B.length - 1; j++) {
        const [ax, az] = A[i], [bx, bz] = A[i + 1], [cx, cz] = B[j], [dx, dz] = B[j + 1];
        const rx = bx - ax, rz = bz - az, sx = dx - cx, sz = dz - cz, den = rx * sz - rz * sx;
        if (Math.abs(den) < 1e-9) continue;
        const t = ((cx - ax) * sz - (cz - az) * sx) / den, u = ((cx - ax) * rz - (cz - az) * rx) / den;
        if (t < 0 || t > 1 || u < 0 || u > 1) continue;
        const x = ax + rx * t, z = az + rz * t;
        if (isEnd(x, z, A) || isEnd(x, z, B)) continue;
        const lr = Math.hypot(rx, rz), ls = Math.hypot(sx, sz);
        out.push({ x, z, type: 'X', angle: acute(rx / lr, rz / lr, sx / ls, sz / ls) });
      }
    }
    return out.filter((j, n) => !out.slice(0, n).some((o) => Math.hypot(o.x - j.x, o.z - j.z) < 4));
  }
  const RIGHT = 80; // угол примыкания от 80° — «прямой»
  const zf = new Float32Array(N); // маска зоны для периметров (очищается после каждой)
  const lock = new Uint8Array(N); // полотно выровненных путей (gradeAlong)
  const hole = new Uint8Array(N); // дыры в зонах текущей площадки (кручи внутри): переулки идут через них
  const local = makeRouter(hf, 4, 0.7, { maxSlope: VEH, dirs16: true }); // серпантины внутри посёлка

  const sites = [];
  const order = hf.sites.map((s, i) => [s, i]).sort((a, b) => (ORDER[a[0].type] ?? 9) - (ORDER[b[0].type] ?? 9));
  for (const [s] of order) {
    const style = bio.biomeAt(s.x, s.z) === 'none' ? 'atlantic' : bio.biomeAt(s.x, s.z);
    const island = ownerNear(s.x, s.z);
    const sea = seaward(s.x, s.z, s.r + 160);
    const p = { name: s.name, type: s.type, x: s.x, z: s.z, r: s.r, h: s.h, style, island, sea, fishing: !!s.fishing, proto: s.proto, streets: [], reserves: [], berths: [] };
    sites.push(p);
    if (s.type === 'lighthouse' || s.type === 'landing') {
      // маленькая площадка-круг
      const r = s.r, idx = sites.length - 1;
      for (let dz = -r; dz <= r; dz += st) for (let dx = -r; dx <= r; dx += st) {
        const k = cellOf(s.x + dx, s.z + dz);
        if (k >= 0 && H[k] > 0.5 && dx * dx + dz * dz < r * r && siteOf[k] < 0) siteOf[k] = idx;
      }
      if (s.type === 'landing' && sea) p.berths.push(berth(sea.x, sea.z, 'jetty-small'));
      continue;
    }
    planTown(s, p, sites.length - 1);
  }

  // место причала на кромке: глубина у конца (out м от берега) для мола, пирса, стенки и мостков
  function berth(x, z, kind) {
    const [nx, nz] = seaNormal(x, z), at = (t) => -hf.sample(x + nx * t, z + nz * t);
    return { kind, x, z, nx, nz, rot: Math.atan2(nx, nz), depth: kind ? at(REACH[kind]) : at(20), at };
  }

  function planTown(s, p, idx) {
    const big = s.type !== 'village', R = s.r;
    const maxSlope = p.style === 'south' ? 0.4 : 0.3;
    const target = Math.PI * R * R * (AREA_K[s.type] ?? 1.2) / (st * st);
    // 1. граница: «волна» от центра по ближайшим пригодным клеткам (куча по расстоянию до центра)
    const c0 = cellOf(s.x, s.z);
    let heap, seen, cells;
    const push = (d, k) => { heap.push([d, k]); let i = heap.length - 1; while (i) { const q = (i - 1) >> 1; if (heap[q][0] <= heap[i][0]) break; [heap[q], heap[i]] = [heap[i], heap[q]]; i = q; } };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } }
      return top;
    };
    // на крутом месте граница набирает мало — допуск уклона растёт ступенями до 0.5 (там будут террасы и лестницы)
    for (let lim = maxSlope; ; lim += 0.1) {
      heap = [[0, c0]]; seen = new Set([c0]); cells = [];
      grow(lim);
      if (cells.length >= target * 0.6 || lim >= 0.5) break;
    }
    function grow(lim) {
      const fits = (k) => H[k] > 0.7 && siteOf[k] < 0 && (hf.owner[k] === p.island || hf.owner[k] < 0) && slopeAt(k) < lim;
      while (heap.length && cells.length < target) {
        const [d, k] = pop();
        if (d > R * 2.2) break;
        if (k !== c0 && !fits(k)) continue;
        cells.push(k);
        const i = k % W, j = (k / W) | 0;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ni = i + di, nj = j + dj, n = nj * W + ni;
          if (ni < 1 || nj < 1 || ni >= W - 1 || nj >= W - 1 || seen.has(n)) continue;
          seen.add(n);
          const [x, z] = xy(n);
          push(Math.hypot(x - s.x, z - s.z), n);
        }
      }
    }
    let i0 = W, j0 = W, i1 = 0, j1 = 0, slopeSum = 0;
    for (const k of cells) {
      siteOf[k] = idx; cur[k] = 1; slopeSum += slopeAt(k);
      const i = k % W, j = (k / W) | 0;
      i0 = Math.min(i0, i); i1 = Math.max(i1, i); j0 = Math.min(j0, j); j1 = Math.max(j1, j);
    }
    const win = [Math.max(0, i0 - 1), Math.max(0, j0 - 1), Math.min(W - 1, i1 + 1), Math.min(W - 1, j1 + 1)];
    const inMask = (x, z) => { const k = cellOf(x, z); return k >= 0 && cur[k] === 1; };
    p.area = cells.length * st * st;
    p.avgSlope = slopeSum / Math.max(1, cells.length);
    // контур границы — изолиния 0.5 маски
    const mf = new Float32Array(N);
    for (const k of cells) mf[k] = 1;
    p.outline = isolines(mf, W, st, x0, z0, 0.5, win).filter((l) => pathLength(l) > 20).map((l) => simplify(l, 1));

    // 2–3. продольные улицы
    const nearSea = p.sea && p.sea.t < R * 1.5;
    p.field = s.field ?? (p.avgSlope < 0.12 ? 'shore' : 'height');
    const road = ROAD[s.type], spacing = s.spacing ?? (big ? 28 : 26);
    const nStreets = s.type === 'port' ? 4 : s.type === 'town' ? 3 : s.fishing ? 1 : 2;
    const level0 = s.type === 'port' ? 22 : s.type === 'town' ? 16 : 12;
    const long = [];
    const addLong = (pts, cls) => {
      for (const run of clipNear(pts, long.map((l) => l.pts), spacing * 0.45, 30)) long.push({ cls, road, pts: smoothLine(run) });
    };
    const levelLines = (f, level) => isolines(f, W, st, x0, z0, level, win, cur).filter((l) => pathLength(l) >= 30).slice(0, 2);
    if (s.streets) for (const pts of s.streets) long.push({ cls: 'street', road, pts: smoothLine(pts) });
    else {
      // первая — у воды по расстоянию до берега (набережная порта, главная улица деревни)
      // только у своей воды: линия должна пройти рядом с ближайшей к центру кромкой (иначе — берег по ту сторону мыса)
      if (nearSea) {
        const own = levelLines(toWater, level0).filter((l) => distTo(p.sea.x, p.sea.z, l) < level0 + 25);
        for (const l of own.slice(0, 1)) addLong(l, s.type === 'port' ? 'quay' : 'main');
      }
      if (p.field === 'shore' || !long.length && !nearSea) {
        const start = nearSea ? level0 + spacing : Math.max(4, waterDist(s.x, s.z));
        for (let n = 0; long.length < nStreets && n < nStreets + 2; n++) for (const l of levelLines(toWater, start + n * spacing)) addLong(l, long.length ? 'street' : 'main');
      } else {
        // террасы: горизонтали через dh, вверх от набережной (или от центра)
        const dh = Math.max(5, p.avgSlope * spacing);
        const base = long.length ? long[0].pts.reduce((a, q) => a + hf.sample(q[0], q[1]), 0) / long[0].pts.length : hf.sample(s.x, s.z);
        const levels = long.length ? [1, 2, 3, 4, 5].map((n) => base + n * dh) : [0, 1, -1, 2, -2, 3].map((n) => base + n * dh);
        for (const lv of levels) {
          if (long.length >= nStreets) break;
          for (const l of levelLines(H, lv)) addLong(l, long.length ? 'street' : 'main');
        }
        for (const l of long) if (l.cls === 'street') l.terrace = true;
      }
    }
    // посёлок внутри острова на «гребне» расстояния до воды: изолиний нет — главная улица вдоль длинной оси границы,
    // с лёгким изгибом
    if (!long.length) {
      let mx = 0, mz = 0, xx = 0, xz = 0, zz = 0;
      for (const k of cells) { const [x, z] = xy(k); mx += x; mz += z; }
      mx /= cells.length; mz /= cells.length;
      for (const k of cells) { const [x, z] = xy(k), dx = x - mx, dz = z - mz; xx += dx * dx; xz += dx * dz; zz += dz * dz; }
      const ang = 0.5 * Math.atan2(2 * xz, xx - zz), ax = Math.cos(ang), az = Math.sin(ang);
      const pts = [];
      for (let t = -R * 2; t <= R * 2; t += 4) {
        const bend = 4 * Math.sin(t / R * 1.7);
        const x = mx + ax * t - az * bend, z = mz + az * t + ax * bend;
        if (inMask(x, z)) pts.push([x, z]); else if (pts.length) break;
      }
      if (pathLength(pts) >= 30) long.push({ cls: 'main', road, pts: smoothLine(pts) });
    }
    p.streets.push(...long.slice(0, nStreets + 1));
    const main = p.streets[0];

    // 4. площадь — сразу после продольных улиц: от неё центр (core); переулки примыкают к её краю, периметры её обходят;
    // самое ровное 20×20 м у первых двух улиц, ближе к центру
    const fpFits = (x, z, w, d, rot, tol) => {
      const c = Math.cos(rot), sn = Math.sin(rot);
      let lo = Infinity, hi = -Infinity;
      for (const [cx, cz] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0], [0, -1], [0, 1]]) {
        const lx = cx * w / 2, lz = cz * d / 2, px = x + lx * c + lz * sn, pz = z - lx * sn + lz * c;
        if (!inMask(px, pz)) return null;
        const h = hf.sample(px, pz);
        lo = Math.min(lo, h); hi = Math.max(hi, h);
      }
      return hi - lo <= tol ? hi - lo : null;
    };
    const taken = []; // { x, z, w, d, rot } — площадь и резервы
    const clearOfStreets = (x, z, w, d, rot) => {
      const c = Math.cos(rot), sn = Math.sin(rot);
      for (const [cx, cz] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]]) {
        const px = x + cx * w / 2 * c + cz * d / 2 * sn, pz = z - cx * w / 2 * sn + cz * d / 2 * c;
        for (const l of p.streets) if (distTo(px, pz, l.pts) < (HW[l.road] ?? 2) + 0.5) return false;
      }
      return true;
    };
    const overlaps = (x, z, w, d) => taken.some((t) => Math.hypot(t.x - x, t.z - z) < (Math.hypot(t.w, t.d) + Math.hypot(w, d)) / 2 * 0.85);
    // у улицы: точка u, сторона side, футпринт w×d фасадом к улице
    const besideStreet = (l, u, side, w, d, gap = 1) => {
      const a = polyline(l.pts).at(u), nx = -a.tz * side, nz = a.tx * side, off = (HW[l.road] ?? 2) + gap + d / 2;
      return { x: a.x + nx * off, z: a.z + nz * off, rot: Math.atan2(-nx, -nz) };
    };
    // на склоне ровных 20×20 может не быть — тогда 16×16 с перепадом до 2.5 м
    let plaza = null;
    for (const [a, tol] of [[20, 1.5], [16, 2.5]]) {
      for (const l of p.streets.slice(0, 2)) {
        const P = polyline(l.pts);
        for (let u = 6; u < P.L - 6; u += 3) for (const side of [-1, 1]) {
          const q = besideStreet(l, u, side, a, a, 0.5);
          const dc = Math.hypot(q.x - s.x, q.z - s.z);
          if (dc > R * 0.6) continue;
          const rng = fpFits(q.x, q.z, a, a, q.rot, tol);
          if (rng === null || !clearOfStreets(q.x, q.z, a, a, q.rot)) continue;
          const score = rng + 0.03 * dc;
          if (!plaza || score < plaza.score) plaza = { ...q, w: a, d: a, score };
        }
      }
      if (plaza) break;
    }
    if (plaza) { p.plaza = { x: plaza.x, z: plaza.z, rot: plaza.rot, w: plaza.w, d: plaza.d }; taken.push(plaza); }
    const hub = p.plaza ?? { x: s.x, z: s.z };
    // резервы общественных зданий: у улиц, ближе к площади; портовые (пакгауз, таможня, лоцманская) — ближе к воде
    const list = s.fishing ? ['chapel'] : PUBLIC[s.type] ?? [];
    const quay = p.streets.find((l) => l.cls === 'quay');
    const harborHub = quay ? (() => { const P = polyline(quay.pts), a = P.at(P.L / 2); return { x: a.x, z: a.z }; })() : hub;
    function placeReserve(id) {
      const { w, d } = footprint(id), near = HARBOR_USE.has(id) ? harborHub : hub;
      const cand = [];
      for (const l of p.streets) {
        if (FOOTWAY.has(l.cls)) continue;
        const P = polyline(l.pts);
        for (let u = w / 2 + 2; u < P.L - w / 2 - 2; u += 3) for (const side of [-1, 1]) {
          const q = besideStreet(l, u, side, w, d);
          cand.push({ ...q, dc: Math.hypot(q.x - near.x, q.z - near.z) });
        }
      }
      cand.sort((a, b) => a.dc - b.dc);
      const tol = w * d > 200 ? 2.5 : 2.2;
      let got = cand.find((q) => !overlaps(q.x, q.z, w, d) && fpFits(q.x, q.z, w, d, q.rot, tol) !== null && clearOfStreets(q.x, q.z, w, d, q.rot));
      // церковь обязательна: любое место в границе (сетка 6 м, 4 поворота)
      if (!got && id === 'church') {
        const all = [];
        for (const k of cells) { const [x, z] = xy(k); if ((k % W) % 3 === 0 && ((k / W) | 0) % 3 === 0) for (let r = 0; r < 4; r++) all.push({ x, z, rot: r * Math.PI / 2, dc: Math.hypot(x - hub.x, z - hub.z) }); }
        all.sort((a, b) => a.dc - b.dc);
        got = all.find((q) => !overlaps(q.x, q.z, w, d) && fpFits(q.x, q.z, w, d, q.rot, 3) !== null && clearOfStreets(q.x, q.z, w, d, q.rot));
      }
      if (!got) return null;
      const r = { id, x: got.x, z: got.z, rot: got.rot, w, d };
      p.reserves.push(r); taken.push(r);
      return r;
    }
    // площадь и церковь — «блоки»: их край — как улица (к нему примыкают переулки), периметры их обходят,
    // клетки заперты от подрезки дорог
    const blocks = [];
    if (p.plaza) blocks.push(p.plaza);
    if (list.includes('church')) { const c = placeReserve('church'); if (c) blocks.push(c); }
    const inBlock = (x, z, pad = 0) => blocks.some(({ x: px, z: pz, rot, w, d }) => {
      const c = Math.cos(rot), sn = Math.sin(rot), dx = x - px, dz = z - pz;
      return Math.abs(dx * c - dz * sn) < w / 2 + pad && Math.abs(dx * sn + dz * c) < d / 2 + pad;
    });
    const blockRings = blocks.map(({ x: px, z: pz, rot, w, d }) => {
      const c = Math.cos(rot), sn = Math.sin(rot);
      return [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]].map(([a, b]) => [px + a * w / 2 * c + b * d / 2 * sn, pz - a * w / 2 * sn + b * d / 2 * c]);
    });
    for (const b of blocks) {
      const R2 = Math.hypot(b.w, b.d);
      for (let dz = -R2; dz <= R2; dz += st) for (let dx = -R2; dx <= R2; dx += st) if (inBlock(b.x + dx, b.z + dz, 1)) { const k = cellOf(b.x + dx, b.z + dz); if (k >= 0) lock[k] = 1; }
    }

    // 5. зоны: в границе — core (у площади, край неровный), waterfront (порт: между набережной и водой), residential;
    // кольцо за границей — outskirts и fields (ровный луг)
    let seed = ((map.seed ?? 1) * 7919 + idx * 104729) >>> 0;
    const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
    const ph = [rnd() * 6.28, rnd() * 6.28, rnd() * 6.28];
    const wob = (x, z, a) => { const t = Math.atan2(z - hub.z, x - hub.x); return 1 + a * (0.6 * Math.sin(2 * t + ph[0]) + 0.4 * Math.sin(3 * t + ph[1])); };
    for (const k of cells) {
      const [x, z] = xy(k);
      zone[k] = Math.hypot(x - hub.x, z - hub.z) < R * 0.45 * wob(x, z, 0.25) ? PZ.core
        : s.type === 'port' && nearSea && toWater[k] < level0 - 2 ? PZ.waterfront : PZ.residential;
    }
    const mine = cells.slice(), RO = R * 1.7;
    for (let dz = -RO * 1.2; dz <= RO * 1.2; dz += st) for (let dx = -RO * 1.2; dx <= RO * 1.2; dx += st) {
      if (Math.hypot(dx, dz) > RO * wob(s.x + dx, s.z + dz, 0.15)) continue;
      const k = cellOf(s.x + dx, s.z + dz);
      if (k < 0 || siteOf[k] >= 0 || zone[k] || H[k] < 0.7 || hf.owner[k] !== p.island || slopeAt(k) > 0.3) continue;
      zone[k] = bio.zone && bio.zoneAt(s.x + dx, s.z + dz) === 'meadow' ? PZ.fields : PZ.outskirts;
      mine.push(k);
    }

    // 6. периметры зон: изолиния 0.5 маски зоны без кромки воды и без кусков вдоль уже существующих улиц;
    // в посёлке — переулок (ring), снаружи окраин и полей — полевая дорога (track)
    const longs = p.streets.slice();
    let wi0 = W, wj0 = W, wi1 = 0, wj1 = 0;
    for (const k of mine) { const i = k % W, j = (k / W) | 0; wi0 = Math.min(wi0, i); wi1 = Math.max(wi1, i); wj0 = Math.min(wj0, j); wj1 = Math.max(wj1, j); }
    const winO = [Math.max(0, wi0 - 2), Math.max(0, wj0 - 2), Math.min(W - 1, wi1 + 2), Math.min(W - 1, wj1 + 2)];
    const holes = [];
    for (const v of [PZ.core, PZ.residential, PZ.waterfront, PZ.outskirts, PZ.fields]) {
      let any = false;
      for (const k of mine) if (zone[k] === v) { zf[k] = 1; any = true; }
      // дыры в зоне (кручи, скалы внутри) — не граница с другой зоной: залить (всё, куда не дойти от края окна)
      if (any) {
        const seen = new Uint8Array((winO[2] - winO[0] + 1) * (winO[3] - winO[1] + 1)), ww = winO[2] - winO[0] + 1;
        const at = (i, j) => (j - winO[1]) * ww + (i - winO[0]), stack = [];
        for (let i = winO[0]; i <= winO[2]; i++) for (const j of [winO[1], winO[3]]) stack.push([i, j]);
        for (let j = winO[1]; j <= winO[3]; j++) for (const i of [winO[0], winO[2]]) stack.push([i, j]);
        while (stack.length) {
          const [i, j] = stack.pop();
          if (i < winO[0] || j < winO[1] || i > winO[2] || j > winO[3] || seen[at(i, j)] || zf[j * W + i]) continue;
          seen[at(i, j)] = 1;
          stack.push([i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]);
        }
        for (let j = winO[1]; j <= winO[3]; j++) for (let i = winO[0]; i <= winO[2]; i++) if (!seen[at(i, j)] && !zf[j * W + i]) { zf[j * W + i] = 1; mine.push(j * W + i); holes.push(j * W + i); if (v <= PZ.waterfront) hole[j * W + i] = 1; }
      }
      if (any) {
        const outer = v >= PZ.outskirts;
        for (const c of isolines(zf, W, st, x0, z0, 0.5, winO)) {
          const dry = [];
          let run = [];
          for (const q of c) {
            if (waterDist(q[0], q[1]) > 8 && hf.sample(q[0], q[1]) > 0.7) run.push(q);
            else { if (run.length > 1) dry.push(run); run = []; }
          }
          if (run.length > 1) dry.push(run);
          // без кусков через площадь и церковь
          const out = [];
          for (const r of dry) { let q = []; for (const pt of r) { if (inBlock(pt[0], pt[1], 2)) { if (q.length > 1) out.push(q); q = []; } else q.push(pt); } if (q.length > 1) out.push(q); }
          for (const r of out) for (const piece of notAlong(simplify(r, 1), [...p.streets.map((l) => l.pts), ...blockRings], 6, 10)) {
            p.streets.push({ cls: outer ? 'track' : 'ring', road: outer ? 'road-dirt' : road, pts: chaikin(chaikin(simplify(piece, 2.5))) });
          }
        }
      }
      for (const k of mine) zf[k] = 0;
      for (const k of holes.splice(0)) mine.pop();
    }

    // 7. поперечные по полосам: от продольной улицы вверх по градиенту F до первой встречной улицы или периметра —
    // T-перекрёстки; старты соседних полос сдвинуты на полшага; трасса скошена на θ к нормали улицы — углы не прямые
    const F = (x, z) => hf.sample(x, z) + 0.25 * waterDist(x, z);
    const every = big ? 42 : 50, lanes = [];
    let sgn = 1;
    // источники полос: продольные улицы, затем кольца периметров в посёлке (от кольца центра — наружу)
    const sources = [...longs, ...p.streets.filter((l) => l.cls === 'ring')];
    const inTown = (x, z) => { const k = cellOf(x, z); return k >= 0 && (cur[k] === 1 || hole[k] === 1); };
    function traceLane(band, u, theta) {
      const l0 = sources[band], a = polyline(l0.pts).at(u), e = 2;
      const g0 = Math.hypot(F(a.x + e, a.z) - F(a.x - e, a.z), F(a.x, a.z + e) - F(a.x, a.z - e)) / (2 * e);
      const kk = Math.tan(theta) * g0;
      const Fs = (x, z) => F(x, z) + kk * ((x - a.x) * a.tx + (z - a.z) * a.tz);
      if (inBlock(a.x, a.z, 2)) return null;
      const tr = traceGradient(Fs, a.x, a.z, { ds: 3, maxLen: R * 1.8, ok: inTown });
      if (tr.length < 4) return null;
      // остановилась на вершине (градиент обнулился) — дальше прямо по инерции, пока в границе
      for (let m = 0, [px, pz] = tr.at(-2), [qx, qz] = tr.at(-1); m < R / 3; m++) {
        const l = Math.hypot(qx - px, qz - pz) || 1, nx = qx + (qx - px) / l * 3, nz = qz + (qz - pz) / l * 3;
        if (!inTown(nx, nz)) break;
        tr.push([nx, nz]); [px, pz, qx, qz] = [qx, qz, nx, nz];
      }
      const targets = [...p.streets.filter((l) => l !== l0), ...lanes.filter((q) => q.band !== band || q.u !== u)].map((l) => l.pts);
      targets.push(...blockRings);
      for (let n = 2; n < tr.length + 2; n++) {
        const [x, z] = n < tr.length ? tr[n] : tr.at(-1);
        let hit = null;
        for (const t of targets) { const q = nearestOn(x, z, t); if (q.d < (n < tr.length ? 2.5 : 4) && (!hit || q.d < hit.d)) hit = q; }
        if (hit) {
          const pts = [...tr.slice(0, Math.min(n, tr.length - 1) + 1), [hit.x, hit.z]];
          return pathLength(pts) >= 12 ? { band, u, theta, pts } : null;
        }
      }
      // не дошла ни до какой улицы: в деревне — тупик, в городе не нужна
      return s.type === 'village' && pathLength(tr) >= 15 ? { band, u, theta, pts: tr } : null;
    }
    const pickTheta = () => { sgn = -sgn; return rnd() < 0.15 ? 0 : sgn * (18 + rnd() * 17) * Math.PI / 180; };
    for (let band = 0; band < sources.length; band++) {
      const L = polyline(sources[band].pts).L;
      for (let u = every * (band % 2 ? 1 : 0.5) * (0.85 + 0.3 * rnd()); u < L - 8; u += every * (0.75 + 0.5 * rnd())) {
        const lane = traceLane(band, u, pickTheta());
        if (lane) lanes.push(lane);
      }
    }
    // доля прямых углов — не больше 20 %: самые прямые переулки перетрассировать с бо́льшим скосом (до 2 проходов)
    const laneAngle = (lane) => {
      const near = junctionsOf([...p.streets, ...lanes]).filter((j) => [lane.pts[0], lane.pts.at(-1)].some((e) => Math.hypot(e[0] - j.x, e[1] - j.z) < 4));
      return near.reduce((m, j) => Math.max(m, j.angle), 0);
    };
    for (let pass = 0; pass < 2; pass++) {
      const js = junctionsOf([...p.streets, ...lanes]);
      if (js.length < 5 || js.filter((j) => j.angle >= RIGHT).length <= 0.2 * js.length) break;
      for (const lane of lanes.slice()) {
        if (laneAngle(lane) < RIGHT) continue;
        const th = (Math.sign(lane.theta) || (rnd() < 0.5 ? -1 : 1)) * (38 + 6 * pass) * Math.PI / 180;
        const again = traceLane(lane.band, lane.u, th);
        if (again) lanes[lanes.indexOf(lane)] = again;
      }
    }

    // концы колец и переулков, примыкающие почти под прямым углом, — сдвинуть вдоль улицы: последние 8 м подхода косые
    const DEG = Math.PI / 180;
    for (const l of [...p.streets.filter((q) => !longs.includes(q)), ...lanes]) {
      for (const end of [0, 1]) {
        const pts = l.pts, n = pts.length;
        if (n < 3) break;
        const e = end ? pts[n - 1] : pts[0];
        let best = null;
        for (const o of [...p.streets, ...lanes]) {
          if (o === l) continue;
          const q = nearestOn(e[0], e[1], o.pts);
          if (q.d < 3.5 && (!best || q.d < best.d)) best = { ...q, o };
        }
        if (!best) continue;
        // точка подхода — 8 м назад по ломаной
        let m = end ? n - 1 : 0, acc = 0;
        while (acc < 8 && (end ? m > 0 : m < n - 1)) { const m2 = end ? m - 1 : m + 1; acc += Math.hypot(pts[m2][0] - pts[m][0], pts[m2][1] - pts[m][1]); m = m2; }
        const f = pts[m], dx = e[0] - f[0], dz = e[1] - f[1], L = Math.hypot(dx, dz) || 1, dot = (dx * best.tx + dz * best.tz) / L;
        if (Math.abs(dot) > Math.cos(RIGHT * DEG) || L < 5) continue;
        const sg = dot >= 0 ? 1 : (dot < 0 ? -1 : (rnd() < 0.5 ? 1 : -1)), sh = L * Math.tan((24 + 10 * rnd()) * DEG);
        const q = nearestOn(best.x + best.tx * sg * sh, best.z + best.tz * sg * sh, best.o.pts), ne = [q.x, q.z];
        l.pts = end ? [...pts.slice(0, m + 1), ne] : [ne, ...pts.slice(m)];
      }
    }

    // 8. уклоны: проезжие пути не круче VEH — подрезка рельефа; переулок — ещё серпантин (ramp); иначе пешком
    const cuts = [];
    const grade = (l, maxCut) => { const r = gradeAlong(hf, l.pts, HW[l.road] ?? 2, VEH, { maxCut, lock }); cuts.push(r.cut); return r.grade; };
    // по старшинству: продольные, периметры, переулки; каждый выровненный путь запирает своё полотно
    for (const l of longs) if (maxGrade(hf.sample, l.pts) > VEH) grade(l, 3); else gradeAlong(hf, l.pts, HW[l.road] ?? 2, VEH, { maxCut: 0, lock });
    for (const l of p.streets.filter((q) => q.cls === 'ring' || q.cls === 'track')) if (maxGrade(hf.sample, l.pts) > VEH) grade(l, 3);
    const ramp = (lane, maxCut) => {
      const [a, b] = [lane.pts[0], lane.pts.at(-1)];
      let path = local(a[0], a[1], b[0], b[1], { ok: (x, z) => inTown(x, z) || waterDist(x, z) > 3 && siteOf[cellOf(x, z)] < 0 });
      if (!path) return null;
      path = chaikin(chaikin([a, ...path.slice(1, -1), b]));
      if (pathLength(path) > 4 * Math.max(20, pathLength(lane.pts))) return null;
      const l = { cls: 'ramp', road, pts: path };
      grade(l, maxCut);
      return l;
    };
    const vehicleBands = new Set();
    for (const lane of lanes) {
      const l = { cls: 'lane', road, pts: lane.pts };
      let out = [l];
      if (maxGrade(hf.sample, l.pts) > VEH) {
        if (gradeAlong(hf, l.pts, HW[road], VEH, { dry: true }).cut <= 1.5) grade(l, 1.5);
        else { const r = ramp(lane, 2); out = r ? [r] : splitGrade(l.pts, 'lane', road); }
      }
      if (out.every((q) => !FOOTWAY.has(q.cls))) vehicleBands.add(lane.band);
      lane.out = out;
    }
    // связность: в каждой полосе хотя бы один проезжий путь вверх — серпантин принудительно, со срезом до 3 м
    for (let band = 0; band < longs.length; band++) {
      const inBand = lanes.filter((q) => q.band === band);
      if (!inBand.length || vehicleBands.has(band)) continue;
      inBand.sort((a, b) => Math.abs(a.u - polyline(longs[band].pts).L / 2) - Math.abs(b.u - polyline(longs[band].pts).L / 2));
      for (const lane of inBand) { const r = ramp(lane, 3); if (r) { lane.out.push(r); vehicleBands.add(band); break; } }
    }
    for (const lane of lanes) p.streets.push(...lane.out);
    // что и после подрезки круче VEH — пешком (лестница; у полевой дороги — тропа)
    for (const l of p.streets.slice()) {
      if (FOOTWAY.has(l.cls) || maxGrade(hf.sample, l.pts) <= VEH + 0.005) continue;
      p.streets.splice(p.streets.indexOf(l), 1, ...splitGrade(l.pts, l.cls, l.road));
    }
    p.cut = cuts.reduce((m, v) => Math.max(m, v), 0);
    p.bands = longs.length;
    p.vehicleBands = [...vehicleBands].filter((b) => b < longs.length).length;
    p.junctions = junctionsOf(p.streets);

    // 9. остальные резервы общественных зданий (церковь — уже на шаге 4)
    for (const id of list) if (id !== 'church') placeReserve(id);

    // 10. причалы: точки кромки у первой улицы; у каждого типа своя глубина у конца
    if (nearSea && main) {
      const NEED = { 'pier-stone': 2.5, 'pier-wood': 1.8, 'quay-wall': 1.2, 'jetty-small': 1.0 }, P = polyline(main.pts), spots = [];
      for (let u = 4; u < P.L - 4; u += 6) {
        const a = P.at(u);
        let gx = waterDist(a.x + 2, a.z) - waterDist(a.x - 2, a.z), gz = waterDist(a.x, a.z + 2) - waterDist(a.x, a.z - 2);
        const g = Math.hypot(gx, gz) || 1;
        const e = edge(a.x, a.z, -gx / g, -gz / g, 60);
        if (!e) continue;
        spots.push({ ...berth(e.x, e.z, null), u });
      }
      const pick = (kind, minGap, best = (a, b) => b.at(REACH[kind]) - a.at(REACH[kind])) => {
        const free = spots.filter((q) => !q.kind && q.at(REACH[kind]) >= NEED[kind] && !p.berths.some((b) => Math.hypot(b.x - q.x, b.z - q.z) < minGap));
        free.sort(best);
        const q = free[0];
        if (q) { q.kind = kind; q.depth = q.at(REACH[kind]); p.berths.push(q); }
        return q;
      };
      const mid = (a, b) => Math.abs(a.u - P.L / 2) - Math.abs(b.u - P.L / 2);
      if (s.type === 'port') {
        pick('pier-stone', 30, (a, b) => b.at(40) - a.at(40) + 0.05 * mid(a, b));
        pick('pier-wood', 28); pick('pier-wood', 28);
        for (let n = 0; n < 4; n++) pick('quay-wall', 14, mid);
      } else {
        const n = s.fishing ? 4 : 2;
        for (let m = 0; m < n; m++) pick('jetty-small', s.fishing ? 16 : 20, mid);
      }
    }
    for (const k of cells) cur[k] = 0;
    hole.fill(0);
  }

  // --- дороги между поселениями одного массива суши ------------------------------
  // (массив — связная суша выше 0.8 м: остров карты может состоять из нескольких записей islands)
  const mass = new Int32Array(N).fill(-1);
  const massAt = (x, z) => {
    const k0 = cellOf(x, z);
    if (k0 < 0 || H[k0] <= 0.8) return -1;
    if (mass[k0] < 0) {
      const stack = [k0];
      mass[k0] = k0;
      while (stack.length) {
        const k = stack.pop();
        for (const n of [k + 1, k - 1, k + W, k - W]) if (n >= 0 && n < N && mass[n] < 0 && H[n] > 0.8) { mass[n] = k0; stack.push(n); }
      }
    }
    return mass[k0];
  };
  const route = makeRouter(hf, 4, 0.7); // шаг 4 м: узкие перешейки (у губ и бухт) на 8 м пропадают
  const roads = [];
  const byIsland = new Map();
  for (const p of sites) {
    const m = massAt(p.x, p.z);
    if (m >= 0) (byIsland.get(m) ?? byIsland.set(m, []).get(m)).push(p);
  }
  // точка входа: ближайшая к соседу точка внешнего периметра (полевой дороги или кольца; у маяка — сама точка);
  // away — не ближе 60 м к этой точке (вход запасной дороги)
  const gate = (p, to, away = null) => {
    let best = null;
    const outer = p.streets.filter((l) => l.cls === 'track' || l.cls === 'ring');
    for (const l of outer.length ? outer : p.streets) {
      if (FOOTWAY.has(l.cls)) continue;
      for (const [x, z] of away ? resample(l.pts, 4) : []) {
        if (Math.hypot(x - away[0], z - away[1]) < 60) continue;
        const d = Math.hypot(x - to.x, z - to.z);
        if (!best || d < best.d) best = { d, x, z };
      }
      if (away) continue;
      const q = nearestOn(to.x, to.z, l.pts);
      if (!best || q.d < best.d) best = q;
    }
    return best ? [best.x, best.z] : [p.x, p.z];
  };
  // прокладка пути ga → gb. kind: 'road-dirt' — дорога (не круче VEH; если так нельзя — круче со штрафом и подрезкой
  // сильнее), 'track' — полевая дорога (не круче VEH, подрезка до 2 м, остаток — тропой), 'path' — тропа (не круче FOOT,
  // иначе лестницей). Куски вдоль уже проложенных дорог и улиц посёлков near отрезаются — путь к ним примыкает.
  // extra — добавка к цене узла (другой коридор); accept(pts) — проверка трассы до записи. Возвращает куски или null.
  function lay(ga, gb, kind, from, to, near, { extra = null, accept = null, noSteep = false } = {}) {
    const lim = kind === 'path' ? FOOT : VEH;
    let path = route(ga[0], ga[1], gb[0], gb[1], { maxSlope: lim, dirs16: true, extra }), steep = false;
    if (!path && !noSteep) { path = route(ga[0], ga[1], gb[0], gb[1], { maxSlope: lim, dirs16: true, extra, steep: 8 }); steep = true; }
    if (!path || path.length < 2) return null;
    const all = chaikin(chaikin([ga, ...path.slice(1, -1), gb]));
    if (accept && !accept(all)) return null;
    const ways = [...roads.map((r) => r.pts), ...near.flatMap((q) => q.streets.filter((l) => !FOOTWAY.has(l.cls)).map((l) => l.pts))];
    const out = [];
    for (const pts of notAlong(all, ways, 5, 8)) {
      const r = { kind, from, to, pts, L: pathLength(pts) };
      if (kind === 'path') r.segs = splitGrade(pts, 'path', 'path');
      else {
        Object.assign(r, gradeAlong(hf, pts, HW['road-dirt'], VEH, { maxCut: kind === 'track' ? 2 : steep ? 5 : 3, lock }));
        if (kind === 'track' && r.grade > VEH + 0.005) r.segs = splitGrade(pts, 'track', 'road-dirt');
      }
      roads.push(r); out.push(r);
    }
    return out;
  }
  const SETTLE = new Set(['port', 'town', 'village']);
  const nearMain = new Uint8Array(N); // коридор основной дороги (±45 м) — запасная его обходит
  for (const [, list] of byIsland) {
    const towns = list.filter((p) => p.type !== 'lighthouse'), edges = [];
    const inT = new Set(towns.length ? [towns[0]] : []);
    while (inT.size < towns.length) {
      let best = null;
      for (const a of inT) for (const b of towns) {
        if (inT.has(b)) continue;
        const d = Math.hypot(a.x - b.x, a.z - b.z);
        if (!best || d < best[2]) best = [a, b, d];
      }
      inT.add(best[1]);
      edges.push([best[0], best[1], 'road-dirt']);
    }
    for (const l of list.filter((p) => p.type === 'lighthouse')) {
      let best = null;
      for (const q of towns) { const d = Math.hypot(l.x - q.x, l.z - q.z); if (!best || d < best[1]) best = [q, d]; }
      if (best) edges.push([l, best[0], 'path']);
    }
    for (const [a, b, kind] of edges) {
      const ga = gate(a, b), gb = gate(b, a), main = lay(ga, gb, kind, a.name, b.name, [a, b]);
      // между посёлками — вторая связь другим коридором: полевая дорога, если рельеф позволяет, иначе тропа;
      // не длиннее основной втрое и не вдоль неё (не больше 40 % трассы ближе 15 м к основной)
      if (!main?.length || !SETTLE.has(a.type) || !SETTLE.has(b.type)) continue;
      const mainPts = main.flatMap((r) => r.pts), mainL = main.reduce((t, r) => t + r.L, 0) + Math.hypot(ga[0] - gb[0], ga[1] - gb[1]) * 0.2;
      const R45 = Math.ceil(45 / st);
      for (const [x, z] of resample(mainPts, 8)) {
        const ci = Math.round((x - x0) / st), cj = Math.round((z - z0) / st);
        for (let dj = -R45; dj <= R45; dj++) for (let di = -R45; di <= R45; di++) {
          const i = ci + di, j = cj + dj;
          if (i >= 0 && j >= 0 && i < W && j < W && di * di + dj * dj <= R45 * R45) nearMain[j * W + i] = 1;
        }
      }
      const ga2 = gate(a, b, ga), gb2 = gate(b, a, gb);
      const opts = {
        extra: (x, z) => { const k = cellOf(x, z); return k >= 0 && nearMain[k] ? 6 : 0; },
        accept: (pts) => pathLength(pts) <= 3 * Math.max(mainL, 50) && resample(pts, 4).filter(([x, z]) => mainPts.length && nearestOn(x, z, mainPts).d < 15).length <= 0.4 * resample(pts, 4).length,
        noSteep: true,
      };
      lay(ga2, gb2, 'track', a.name, b.name, [a, b], opts) ?? lay(ga2, gb2, 'path', a.name, b.name, [a, b], opts);
      nearMain.fill(0);
    }

    // названные места массива (пляжи, бухты, области) — тропа или полевая дорога от ближайшего посёлка,
    // если до места ещё не доходит ни одна улица или дорога (ближе 30 м)
    const from = towns.filter((p) => SETTLE.has(p.type));
    const srcs = from.length ? from : towns.length ? towns : list;
    if (!srcs.length) continue;
    const m0 = massAt(srcs[0].x, srcs[0].z);
    const landward = (x, z) => {
      // ближайшая точка суши выше 1.2 м (до 60 м)
      for (let r = 0; r <= 60; r += 4) for (let a = 0; a < 16; a++) {
        const px = x + Math.cos(a * Math.PI / 8) * r, pz = z + Math.sin(a * Math.PI / 8) * r;
        if (hf.sample(px, pz) > 1.2 && massAt(px, pz) === m0) return [px, pz];
        if (!r) break;
      }
      return null;
    };
    const places = [
      ...(map.beaches ?? []).map((b) => ({ name: b.name, kind: 'path', pts: resample(b.pts, 10) })),
      ...(map.bays ?? []).map((b) => ({ name: b.name, kind: 'track', pts: [b.head] })),
      ...(map.biomeRegions ?? []).filter((r) => r.x !== undefined).map((r) => ({ name: r.name, kind: 'track', pts: [[r.x, r.z]] })),
    ];
    const reached = (x, z) => [...roads.map((r) => r.pts), ...list.flatMap((q) => q.streets.map((l) => l.pts))].some((pts) => nearestOn(x, z, pts).d < 30);
    for (const pl of places) {
      const cand = pl.pts.map(([x, z]) => landward(x, z)).filter(Boolean);
      if (!cand.length) continue;
      let best = null;
      for (const c of cand) for (const q of srcs) { const d = Math.hypot(c[0] - q.x, c[1] - q.z); if (!best || d < best.d) best = { d, c, q }; }
      if (reached(best.c[0], best.c[1])) continue;
      const g = gate(best.q, { x: best.c[0], z: best.c[1] });
      const done = lay(g, best.c, pl.kind, best.q.name, pl.name, list, { noSteep: pl.kind === 'track' });
      if (!done && pl.kind === 'track') lay(g, best.c, 'path', best.q.name, pl.name, list);
    }
  }

  // --- навигационные знаки -------------------------------------------------------
  const marks = [];
  const deepEnough = (x, z, d) => hf.sample(x, z) <= -d;
  // сдвиг точки по направлению, пока не станет глубже d (до max м)
  const pushOut = (x, z, dx, dz, d, max = 80) => {
    for (let t = 0; t <= max; t += 2) if (deepEnough(x + dx * t, z + dz * t, d)) return [x + dx * t, z + dz * t];
    return null;
  };
  for (const b of map.bays ?? []) {
    const served = sites.some((p) => p.type !== 'lighthouse' && Math.hypot(p.x - b.head[0], p.z - b.head[1]) < b.w + 160);
    if (!served) continue;
    let ax = b.head[0] - b.mouth[0], az = b.head[1] - b.mouth[1];
    const l = Math.hypot(ax, az); ax /= l; az /= l;
    const rx = -az, rz = ax; // правый борт при входе
    for (const [side, kind] of [[-1, 'lateral-red'], [1, 'lateral-green']]) {
      // от оси к берегу, пока глубже 3 м, затем чуть назад к оси — буй у кромки фарватера
      let off = 0;
      while (off < b.w * 1.5 && deepEnough(b.mouth[0] + rx * side * (off + 2), b.mouth[1] + rz * side * (off + 2), 3)) off += 2;
      off = Math.max(6, Math.min(b.w * 0.7, off * 0.75));
      const q = pushOut(b.mouth[0] + rx * side * off, b.mouth[1] + rz * side * off, -ax, -az, 3);
      if (q) marks.push({ kind, x: q[0], z: q[1], name: b.name });
    }
  }
  const harbors = sites.filter((p) => p.type === 'port' || p.type === 'town');
  for (const r of map.reefs ?? []) {
    const [cx, cz] = r.pts ? r.pts[r.pts.length >> 1] : [r.x, r.z];
    const rr = r.pts ? pathLength(r.pts) / 2 : r.r;
    if (r.top[1] < 0) { marks.push({ kind: 'isolated', x: cx, z: cz, name: r.name }); continue; }
    const ref = (harbors.length ? harbors : sites).reduce((a, p) => (!a || Math.hypot(p.x - cx, p.z - cz) < Math.hypot(a.x - cx, a.z - cz) ? p : a), null);
    if (!ref) continue;
    let dx = ref.x - cx, dz = ref.z - cz;
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const q = pushOut(cx + dx * (rr + 25), cz + dz * (rr + 25), dx, dz, 3);
    if (!q) continue;
    // сторона света буя относительно опасности: −z — север
    const kind = Math.abs(dz) > Math.abs(dx) ? (dz < 0 ? 'cardinal-n' : 'cardinal-s') : (dx > 0 ? 'cardinal-e' : 'cardinal-w');
    marks.push({ kind, x: q[0], z: q[1], name: r.name });
  }

  return { sites, roads, marks, siteOf, zone, ms: performance.now() - t0 };
}
