import { edt, isolines, simplify, chaikin, pathLength, polyline, traceGradient, makeRouter } from './geom.js';

// Проектирование поселений и всего антропогенного (шаг между биомами и объектами): только данные, без three.js.
//
// Для порта, города и деревни:
//   граница  — заливка от центра по пригодной суше (тот же остров, не круто), до площади π r² × k: сама тянется вдоль берега;
//   улицы    — продольные по изолиниям поля F: на ровном F — расстояние до воды (улицы повторяют берег),
//              на склоне — высота (террасы по горизонталям); первая улица у воды — набережная или главная;
//              поперечные — от главной вверх по градиенту F, на крутом — лестницы;
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

    // 4. поперечные: от главной вверх по градиенту высоты с примесью расстояния до воды (на ровном — прочь от берега),
    // до последней продольной; круто — лестница
    const F = (x, z) => hf.sample(x, z) + 0.25 * waterDist(x, z);
    if (main) {
      const P = polyline(main.pts), every = big ? 42 : 50, ends = p.streets.slice(1).map((l) => l.pts);
      for (let u = every / 2; u < P.L - 8; u += every) {
        const a = P.at(u);
        const tr = traceGradient(F, a.x, a.z, { ds: 3, maxLen: R * 1.8, ok: inMask });
        if (tr.length < 6) continue;
        // обрезка после последней встречи с продольной улицей (+ 4 м)
        let cut = tr.length - 1;
        if (ends.length) {
          let last = -1;
          tr.forEach(([x, z], n) => { if (n > 3 && ends.some((e) => distTo(x, z, e) < 3)) last = n; });
          if (last > 0) cut = Math.min(tr.length - 1, last + 1);
          else if (s.type !== 'village') continue; // не дошла ни до одной улицы — не нужна
        }
        const lane = tr.slice(0, cut + 1);
        if (pathLength(lane) < 15) continue;
        // делим на участки: уклон > 0.25 — лестница
        let run = [lane[0]], stairs = null;
        const flush = () => { if (run.length > 1) p.streets.push({ cls: stairs ? 'stairs' : 'lane', road: stairs ? 'stairs' : road, pts: run }); };
        for (let n = 1; n < lane.length; n++) {
          const [ax, az] = lane[n - 1], [bx, bz] = lane[n], sl = Math.abs(hf.sample(bx, bz) - hf.sample(ax, az)) / Math.hypot(bx - ax, bz - az);
          const isSt = sl > 0.25;
          if (stairs !== null && isSt !== stairs) { flush(); run = [lane[n - 1]]; }
          stairs = isSt; run.push(lane[n]);
        }
        flush();
      }
    }

    // 5. площадь: самое ровное 20×20 м у первых двух улиц, ближе к центру
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

    // 6. резервы общественных зданий: у улиц, ближе к площади; портовые (пакгауз, таможня, лоцманская) — ближе к воде
    const list = s.fishing ? ['chapel'] : PUBLIC[s.type] ?? [];
    const quay = p.streets.find((l) => l.cls === 'quay');
    const harborHub = quay ? (() => { const P = polyline(quay.pts), a = P.at(P.L / 2); return { x: a.x, z: a.z }; })() : hub;
    for (const id of list) {
      const { w, d } = footprint(id), near = HARBOR_USE.has(id) ? harborHub : hub;
      const cand = [];
      for (const l of p.streets) {
        if (l.cls === 'stairs') continue;
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
      if (got) { const r = { id, x: got.x, z: got.z, rot: got.rot, w, d }; p.reserves.push(r); taken.push(r); }
    }

    // 7. зоны: в границе — core / waterfront / residential; кольцо за ней — outskirts и fields (ровный луг)
    for (const k of cells) {
      const [x, z] = xy(k);
      zone[k] = Math.hypot(x - hub.x, z - hub.z) < R * 0.45 ? PZ.core
        : s.type === 'port' && nearSea && toWater[k] < level0 - 2 ? PZ.waterfront : PZ.residential;
    }
    const RO = R * 1.7;
    for (let dz = -RO; dz <= RO; dz += st) for (let dx = -RO; dx <= RO; dx += st) {
      if (dx * dx + dz * dz > RO * RO) continue;
      const k = cellOf(s.x + dx, s.z + dz);
      if (k < 0 || siteOf[k] >= 0 || zone[k] || H[k] < 0.7 || hf.owner[k] !== p.island || slopeAt(k) > 0.3) continue;
      zone[k] = bio.zone && bio.zoneAt(s.x + dx, s.z + dz) === 'meadow' ? PZ.fields : PZ.outskirts;
    }

    // 8. причалы: точки кромки у первой улицы; у каждого типа своя глубина у конца
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
  const route = makeRouter(hf);
  const roads = [];
  const byIsland = new Map();
  for (const p of sites) {
    const m = massAt(p.x, p.z);
    if (m >= 0) (byIsland.get(m) ?? byIsland.set(m, []).get(m)).push(p);
  }
  // точки входа: концы продольных и поперечных улиц (у маяка — сама точка)
  const gates = (p) => {
    const g = p.streets.filter((l) => l.cls !== 'stairs').flatMap((l) => [l.pts[0], l.pts.at(-1)]);
    return g.length ? g : [[p.x, p.z]];
  };
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
      let g = null;
      for (const ga of gates(a)) for (const gb of gates(b)) { const d = Math.hypot(ga[0] - gb[0], ga[1] - gb[1]); if (!g || d < g[2]) g = [ga, gb, d]; }
      const path = route(g[0][0], g[0][1], g[1][0], g[1][1]);
      if (!path || path.length < 2) continue;
      const pts = chaikin(chaikin([g[0], ...path.slice(1, -1), g[1]]));
      roads.push({ kind, from: a.name, to: b.name, pts, L: pathLength(pts) });
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
