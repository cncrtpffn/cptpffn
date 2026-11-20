// Геометрия для планировщика и строителя поселений: ломаные, сглаживание, A*, изолинии, путь по градиенту.
// Без three.js — проверяется в jsc.

// Ломаная [[x, z], …]: длина и точка с касательной по длине дуги
export function polyline(pts) {
  const seg = [];
  let L = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1], len = Math.hypot(bx - ax, bz - az);
    if (len < 1e-6) continue;
    seg.push({ ax, az, tx: (bx - ax) / len, tz: (bz - az) / len, l0: L, len });
    L += len;
  }
  return {
    pts, L,
    at(u) {
      let s = seg[0];
      for (const q of seg) { s = q; if (u <= q.l0 + q.len) break; }
      const t = Math.max(0, Math.min(s.len, u - s.l0));
      return { x: s.ax + s.tx * t, z: s.az + s.tz * t, tx: s.tx, tz: s.tz };
    },
  };
}
export const resample = (pts, step) => {
  const P = polyline(pts), n = Math.max(1, Math.round(P.L / step));
  return Array.from({ length: n + 1 }, (_, i) => { const p = P.at(i / n * P.L); return [p.x, p.z]; });
};
export const chaikin = (pts) => {
  const out = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    out.push([0.75 * ax + 0.25 * bx, 0.75 * az + 0.25 * bz], [0.25 * ax + 0.75 * bx, 0.25 * az + 0.75 * bz]);
  }
  out.push(pts.at(-1));
  return out;
};

// A* по сетке G м: вода (ниже minH) непроходима, цена растёт с уклоном
export function makeRouter(hf, G = 8, minH = 0.8) {
  const half = hf.bounds[2] / 2, W = Math.floor(hf.bounds[2] / G) + 1, N = W * W;
  const H = new Float32Array(N);
  for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) H[j * W + i] = hf.sample(-half + i * G, -half + j * G);
  const g = new Float32Array(N), from = new Int32Array(N), closed = new Uint8Array(N);
  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const node = (x, z) => {
    // ближайший проходимый узел (по спирали до 5 клеток)
    const i0 = Math.round((x + half) / G), j0 = Math.round((z + half) / G);
    for (let r = 0; r <= 5; r++) {
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        const i = i0 + di, j = j0 + dj;
        if (i >= 0 && j >= 0 && i < W && j < W && H[j * W + i] > minH) return j * W + i;
      }
    }
    return -1;
  };
  return function route(ax, az, bx, bz) {
    const s = node(ax, az), t = node(bx, bz);
    if (s < 0 || t < 0) return null;
    g.fill(Infinity); closed.fill(0);
    const ti = t % W, tj = (t / W) | 0;
    const heap = [[0, s]];
    g[s] = 0; from[s] = -1;
    const push = (f, k) => { heap.push([f, k]); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => {
      const top = heap[0], last = heap.pop();
      if (heap.length) {
        heap[0] = last;
        let i = 0;
        for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; }
      }
      return top;
    };
    while (heap.length) {
      const [, k] = pop();
      if (closed[k]) continue;
      if (k === t) break;
      closed[k] = 1;
      const i = k % W, j = (k / W) | 0;
      for (const [di, dj] of DIRS) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= W || nj >= W) continue;
        const n = nj * W + ni;
        if (closed[n] || H[n] <= minH) continue;
        const L = G * (di && dj ? Math.SQRT2 : 1), sl = Math.abs(H[n] - H[k]) / L;
        const cost = L * (1 + 30 * sl * sl + (sl > 0.3 ? 15 : 0));
        if (g[k] + cost < g[n]) { g[n] = g[k] + cost; from[n] = k; push(g[n] + G * Math.hypot(ni - ti, nj - tj), n); }
      }
    }
    if (!Number.isFinite(g[t])) return null;
    const out = [];
    for (let k = t; k >= 0; k = from[k]) out.push([-half + (k % W) * G, -half + ((k / W) | 0) * G]);
    return out.reverse();
  };
}

// Упрощение ломаной (Рамер — Дуглас — Пекер) с допуском eps, м
export function simplify(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, az] = pts[a], [bx, bz] = pts[b], dx = bx - ax, dz = bz - az, l = Math.hypot(dx, dz) || 1;
    let worst = -1, wd = eps;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i][0] - ax) * dz - (pts[i][1] - az) * dx) / l;
      if (d > wd) { wd = d; worst = i; }
    }
    if (worst > 0) { keep[worst] = 1; stack.push([a, worst], [worst, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

export const pathLength = (pts) => { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return L; };

// Изолинии уровня level поля f (сетка W×W, шаг st, начало x0, z0) в окне [i0, j0, i1, j1] — marching squares.
// mask (необязательна): клетка квадрата учитывается, только если все 4 узла в маске.
// Отрезки сшиваются в ломаные [[x, z], …] (замкнутые повторяют первую точку), по убыванию длины.
export function isolines(f, W, st, x0, z0, level, win, mask) {
  const [i0, j0, i1, j1] = win;
  const segs = [];
  const P = (i, j, ia, ja) => { // точка на ребре между узлами (i, j) и (ia, ja)
    const a = f[j * W + i] - level, b = f[ja * W + ia] - level, t = a / (a - b);
    return [x0 + (i + (ia - i) * t) * st, z0 + (j + (ja - j) * t) * st];
  };
  for (let j = j0; j < j1; j++) {
    for (let i = i0; i < i1; i++) {
      const k = j * W + i;
      if (mask && !(mask[k] && mask[k + 1] && mask[k + W] && mask[k + W + 1])) continue;
      const c = (f[k] > level ? 1 : 0) | (f[k + 1] > level ? 2 : 0) | (f[k + W + 1] > level ? 4 : 0) | (f[k + W] > level ? 8 : 0);
      if (c === 0 || c === 15) continue;
      const T = () => P(i, j, i + 1, j), R = () => P(i + 1, j, i + 1, j + 1), B = () => P(i, j + 1, i + 1, j + 1), Lf = () => P(i, j, i, j + 1);
      switch (c) {
        case 1: case 14: segs.push([Lf(), T()]); break;
        case 2: case 13: segs.push([T(), R()]); break;
        case 3: case 12: segs.push([Lf(), R()]); break;
        case 4: case 11: segs.push([R(), B()]); break;
        case 6: case 9: segs.push([T(), B()]); break;
        case 7: case 8: segs.push([Lf(), B()]); break;
        case 5: segs.push([Lf(), T()], [R(), B()]); break;
        case 10: segs.push([T(), R()], [Lf(), B()]); break;
      }
    }
  }
  // сшивка по совпадающим концам (ключ — координаты с точностью до мм)
  const key = (p) => `${Math.round(p[0] * 1000)},${Math.round(p[1] * 1000)}`;
  const ends = new Map(), used = new Uint8Array(segs.length);
  segs.forEach((s, n) => { for (const p of s) { const kk = key(p); (ends.get(kk) ?? ends.set(kk, []).get(kk)).push(n); } });
  const next = (p, from) => (ends.get(key(p)) ?? []).find((n) => n !== from && !used[n]);
  const out = [];
  for (let n = 0; n < segs.length; n++) {
    if (used[n]) continue;
    used[n] = 1;
    const line = [segs[n][0], segs[n][1]];
    for (const dir of [1, -1]) { // вперёд от конца, затем назад от начала
      let cur = n;
      for (;;) {
        const tip = dir > 0 ? line.at(-1) : line[0], m = next(tip, cur);
        if (m === undefined) break;
        used[m] = 1;
        const [a, b] = segs[m], q = key(a) === key(tip) ? b : a;
        if (dir > 0) line.push(q); else line.unshift(q);
        cur = m;
      }
    }
    out.push(line);
  }
  return out.map((l) => ({ pts: l, L: pathLength(l) })).sort((a, b) => b.L - a.L).map((o) => o.pts);
}

// Путь из (x, z) вдоль градиента поля (sign = +1 — вверх) шагом ds, пока ok(x, z) и не больше maxLen
export function traceGradient(sample, x, z, { sign = 1, ds = 3, maxLen = 200, ok = () => true, e = 2 } = {}) {
  const pts = [[x, z]];
  let L = 0, px = 0, pz = 0;
  while (L < maxLen) {
    let gx = sample(x + e, z) - sample(x - e, z), gz = sample(x, z + e) - sample(x, z - e);
    const g = Math.hypot(gx, gz);
    if (g < 1e-6) break;
    gx = sign * gx / g; gz = sign * gz / g;
    // инерция: путь не дёргается на шуме поля
    if (L > 0) { gx = 0.6 * gx + 0.4 * px; gz = 0.6 * gz + 0.4 * pz; const l = Math.hypot(gx, gz); gx /= l; gz /= l; }
    const nx = x + gx * ds, nz = z + gz * ds;
    if (!ok(nx, nz)) break;
    x = nx; z = nz; px = gx; pz = gz; L += ds;
    pts.push([x, z]);
  }
  return pts;
}

// Квадрат евклидова расстояния от каждого текселя до ближайшего с mask == target
// (Felzenszwalb & Huttenlocher: точный EDT за O(N), сначала по столбцам, потом по строкам).
export function edt(mask, target, W, H) {
  const INF = 1e20;
  const g = new Float32Array(W * H);
  for (let k = 0; k < W * H; k++) g[k] = mask[k] === target ? 0 : INF;
  const n = Math.max(W, H);
  const f = new Float32Array(n), d = new Float32Array(n), v = new Int32Array(n), zb = new Float32Array(n + 1);
  for (let i = 0; i < W; i++) {
    for (let j = 0; j < H; j++) f[j] = g[j * W + i];
    edt1d(f, H, d, v, zb);
    for (let j = 0; j < H; j++) g[j * W + i] = d[j];
  }
  for (let j = 0; j < H; j++) {
    const o = j * W;
    for (let i = 0; i < W; i++) f[i] = g[o + i];
    edt1d(f, W, d, v, zb);
    for (let i = 0; i < W; i++) g[o + i] = d[i];
  }
  return g;
}

// нижняя огибающая парабол (q − p)² + f(p)
function edt1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  const cross = (q, p) => ((f[q] + q * q) - (f[p] + p * p)) / (2 * q - 2 * p);
  for (let q = 1; q < n; q++) {
    let s = cross(q, v[k]);
    // z[0] = −∞, так что k не уходит ниже нуля
    while (s <= z[k]) { k--; s = cross(q, v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    const p = v[k];
    d[q] = (q - p) * (q - p) + f[p];
  }
}
