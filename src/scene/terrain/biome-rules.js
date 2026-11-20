// Инструмент: области биомов по правилам рельефа. Результат — обычные области для map.biomeRegions
// (с полем auto = имя правила), их вставляют в описание карты и правят руками. Стенд карты:
// ?map=archipelago&autoregions=1 — пересчитать и показать код (ручные области сохраняются, auto заменяются).
//
// Правило (map.biomeRules):
//   { name, biome (как у области: строка или веса), islands?: [имена],
//     minH, maxH — высота, м;  minSlope, maxSlope — уклон, м/м;
//     aspect: [курс°, допуск°] — куда смотрит склон (0 — север, 90 — восток);
//     minCoast, maxCoast — расстояние до берега по суше, м;
//     minArea — отбросить куски меньше, м² (по умолчанию 5000);
//     feather, jitter, weight — переходят в области }
// Маска считается на сетке cell м, сглаживается, делится на связные куски. Кусок, который эллипс заполняет
// хорошо (≥ 60 %), становится эллипсом по моментам, иначе — выпуклым многоугольником (до 16 вершин).

import { edt } from './geom.js';

const DEG = Math.PI / 180;
const r1 = (v) => Math.round(v);

export function regionsFromRules(hf, map, rules = map.biomeRules ?? [], { cell = 8 } = {}) {
  const S = Math.round(cell / hf.step), W = hf.size, Wc = Math.floor((W - 1) / S) + 1, Nc = Wc * Wc;
  const [x0, z0] = hf.bounds;
  const H = new Float32Array(Nc), own = new Int8Array(Nc), land = new Uint8Array(Nc);
  for (let j = 0; j < Wc; j++) {
    for (let i = 0; i < Wc; i++) {
      const k = j * Wc + i, kk = j * S * W + i * S;
      H[k] = hf.heights[kk]; own[k] = hf.owner[kk]; land[k] = H[k] > 0 ? 1 : 0;
    }
  }
  const toWater = edt(land, 0, Wc, Wc);
  const names = map.islands.map((isl) => isl.name);
  const at = (i, j) => H[Math.min(Wc - 1, Math.max(0, j)) * Wc + Math.min(Wc - 1, Math.max(0, i))];
  const out = [];

  for (const rule of rules) {
    const only = rule.islands ? new Set(rule.islands.map((n) => names.indexOf(n))) : null;
    let mask = new Uint8Array(Nc);
    for (let j = 0; j < Wc; j++) {
      for (let i = 0; i < Wc; i++) {
        const k = j * Wc + i, h = H[k];
        if (h <= 0 || (only && !only.has(own[k]))) continue;
        if (h < (rule.minH ?? -Infinity) || h > (rule.maxH ?? Infinity)) continue;
        const gx = (at(i + 1, j) - at(i - 1, j)) / (2 * cell), gz = (at(i, j + 1) - at(i, j - 1)) / (2 * cell);
        const s = Math.hypot(gx, gz);
        if (s < (rule.minSlope ?? 0) || s > (rule.maxSlope ?? Infinity)) continue;
        if (rule.aspect) {
          if (s < 0.05) continue; // на ровном у склона нет направления
          const face = Math.atan2(-gx, gz) / DEG; // куда смотрит склон (вниз по нему)
          const diff = Math.abs(((face - rule.aspect[0]) % 360 + 540) % 360 - 180);
          if (diff > rule.aspect[1]) continue;
        }
        const cd = Math.sqrt(toWater[k]) * cell;
        if (cd < (rule.minCoast ?? 0) || cd > (rule.maxCoast ?? Infinity)) continue;
        mask[k] = 1;
      }
    }
    // сглаживание: большинство в окрестности 3×3, дважды (убирает крошку и дыры)
    for (let pass = 0; pass < 2; pass++) {
      const m2 = new Uint8Array(Nc);
      for (let j = 1; j < Wc - 1; j++) {
        for (let i = 1; i < Wc - 1; i++) {
          let c = 0;
          for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) c += mask[(j + dj) * Wc + i + di];
          m2[j * Wc + i] = c >= 5 ? 1 : 0;
        }
      }
      mask = m2;
    }
    // связные куски (8-соседство)
    const seen = new Uint8Array(Nc);
    let n = 0;
    for (let k0 = 0; k0 < Nc; k0++) {
      if (!mask[k0] || seen[k0]) continue;
      const cells = [], stack = [k0];
      seen[k0] = 1;
      while (stack.length) {
        const k = stack.pop();
        cells.push(k);
        const i = k % Wc, j = (k - i) / Wc;
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            const ii = i + di, jj = j + dj, kk = jj * Wc + ii;
            if (ii < 0 || jj < 0 || ii >= Wc || jj >= Wc || seen[kk] || !mask[kk]) continue;
            seen[kk] = 1; stack.push(kk);
          }
        }
      }
      const area = cells.length * cell * cell;
      if (area < (rule.minArea ?? 5000)) continue;
      const shape = fitShape(cells.map((k) => [x0 + (k % Wc) * cell, z0 + Math.floor(k / Wc) * cell]), area, cell);
      const isl = [...new Set(cells.map((k) => own[k]).filter((o) => o >= 0 && names[o]))].map((o) => names[o]);
      out.push({
        name: `${rule.name} ${++n}`, biome: rule.biome, ...shape,
        feather: rule.feather ?? 100, jitter: rule.jitter ?? 25, weight: rule.weight ?? 1,
        ...(isl.length && { islands: isl }), auto: rule.name,
      });
    }
  }
  return out;
}

// эллипс по моментам, если заполняет хорошо; иначе выпуклая оболочка
function fitShape(pts, area, cell) {
  const n = pts.length;
  let mx = 0, mz = 0;
  for (const [x, z] of pts) { mx += x; mz += z; }
  mx /= n; mz /= n;
  let sxx = 0, szz = 0, sxz = 0;
  for (const [x, z] of pts) { sxx += (x - mx) ** 2; szz += (z - mz) ** 2; sxz += (x - mx) * (z - mz); }
  sxx /= n; szz /= n; sxz /= n;
  const tr = sxx + szz, det = sxx * szz - sxz * sxz, d = Math.sqrt(Math.max(0, tr * tr / 4 - det));
  const l1 = tr / 2 + d, l2 = Math.max(tr / 2 - d, 1);
  // у равномерно заполненного эллипса дисперсия по оси = (полуось)² / 4
  const a = 2 * Math.sqrt(l1) + cell / 2, b = 2 * Math.sqrt(l2) + cell / 2;
  const rot = Math.abs(sxz) < 1e-9 ? (sxx >= szz ? 0 : 90) : Math.atan2(l1 - sxx, sxz) / DEG;
  if (area / (Math.PI * a * b) >= 0.6) return { shape: 'ellipse', x: r1(mx), z: r1(mz), a: r1(a), b: r1(b), rot: r1(rot) };
  return { shape: 'polygon', pts: simplify(hull(pts), 16).map(([x, z]) => [r1(x), r1(z)]) };
}

// выпуклая оболочка (монотонная цепь Эндрю)
function hull(pts) {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length > 1 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (up.length > 1 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
// упрощение: убираем вершину с наименьшей площадью треугольника, пока вершин больше max
function simplify(poly, max) {
  const p = [...poly];
  const tri = (a, b, c) => Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  while (p.length > max) {
    let best = 0, bv = Infinity;
    for (let i = 0; i < p.length; i++) {
      const v = tri(p[(i + p.length - 1) % p.length], p[i], p[(i + 1) % p.length]);
      if (v < bv) { bv = v; best = i; }
    }
    p.splice(best, 1);
  }
  return p;
}

// код для вставки в map.biomeRegions
export function regionsToCode(regions) {
  const val = (v) => (typeof v === 'string' ? `'${v}'` : Array.isArray(v) ? `[${v.map(val).join(', ')}]`
    : typeof v === 'object' ? `{ ${Object.entries(v).map(([k, x]) => `${k}: ${val(x)}`).join(', ')} }` : String(v));
  return regions.map((r) => `    { ${Object.entries(r).map(([k, v]) => `${k}: ${val(v)}`).join(', ')} },`).join('\n');
}
