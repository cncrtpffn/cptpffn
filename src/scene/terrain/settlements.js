import * as THREE from 'three';
import { PropBatch, propMaterial, mat } from '../flora.js';
import { STRUCTURES, addStructure } from '../structures/index.js';
import { seeded } from '../structures/kit.js';
import { mergeStatic } from '../merge-static.js';
import { polyline, resample } from './geom.js';
import { PLAN_ZONES } from './settlement-plan.js';

// Поселения, порты, маяки и дороги по плану поселений (settlement-plan.js) — только строитель, раскладки здесь нет:
// ленты улиц и дорог по plan.sites[].streets и plan.roads (лестница — stairs-slope), подпорные стенки там, где полотно
// круто обрывается вбок; площадь и общественные здания — по plaza и reserves; причалы — по berths; дома вдоль улиц,
// тип — по зоне плана; хутора — вдоль полевых дорог окраин, мельницы — в полях. Постройки — библиотека src/scene/structures.
// Один PropBatch на поселение (и на дороги острова), светящиеся детали сливаются по материалу (mergeStatic).
// Маска занятости occ (сетка поля высот): 1 — дорога, 2 — постройка; растительность её обходит.

const hash = (s) => { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.codePointAt(0), 16777619); return h >>> 0; };
const pickW = (table, rng) => { // [[id, вес], …]
  let t = rng() * table.reduce((a, e) => a + e[1], 0);
  for (const [id, w] of table) if ((t -= w) < 0) return id;
  return table[0][0];
};
const HW = { 'road-cobble': 2.9, 'road-dirt': 2.1, path: 0.9, 'stairs-slope': 1.4 }; // полуширина ленты с обочиной
const RIBBON = { 'road-cobble': 'road-cobble', 'road-dirt': 'road-dirt', path: 'path', stairs: 'stairs-slope' }; // road плана → объект
const FOOT = new Set(['stairs', 'path']);
// старшинство путей (меньше — старше): младшая лента у перекрёстка обрезается по краю старшей и лежит ниже на LIFT
const RANK = { main: 0, quay: 0, street: 0, ring: 1, lane: 2, ramp: 2, 'road-dirt': 2, track: 3, path: 4, stairs: 5 };
const LIFT = [0.06, 0.045, 0.03, 0.015, 0, 0];
const VIS = { 'road-cobble': [2.85, 4.15], 'road-dirt': [2.1, 2.1], path: [0.85, 0.85] }; // видимая полуширина [вар. 0, вар. 1]
// не встал дом — пробуем меньше: кварталы между продольными улицами ~22 м, два ряда больших домов в них не входят
// (в городе цепочка кончается городским домом, хижина — только в деревне)
const SMALLER = {
  town: { villa: 'cottage', tenement: 'shophouse', shophouse: 'townhouse', cottage: 'townhouse' },
  village: { cottage: 'hut', townhouse: 'hut', shed: 'hut' },
};

// Маска занятости на сетке поля высот
export function occupancy(hf) {
  const [x0, z0] = hf.bounds, st = hf.step, W = hf.size, a = new Uint8Array(W * W);
  const cell = (x, z) => {
    const i = Math.round((x - x0) / st), j = Math.round((z - z0) / st);
    return i < 0 || j < 0 || i >= W || j >= W ? -1 : j * W + i;
  };
  // прямоугольник w×d с центром (x, z) и поворотом rot (как у mat: +Z объекта → (sin, cos)) плюс запас pad
  function rect(x, z, w, d, rot, pad, fn) {
    const c = Math.cos(rot), s = Math.sin(rot), hw = w / 2 + pad, hd = d / 2 + pad, R = Math.hypot(hw, hd);
    for (let zz = Math.floor((z - R) / st) * st; zz <= z + R; zz += st) {
      for (let xx = Math.floor((x - R) / st) * st; xx <= x + R; xx += st) {
        const dx = xx - x, dz = zz - z;
        if (Math.abs(dx * c - dz * s) > hw || Math.abs(dx * s + dz * c) > hd) continue;
        const k = cell(xx, zz);
        if (k >= 0 && fn(k) === false) return false;
      }
    }
    return true;
  }
  return {
    data: a,
    free: (x, z, w, d, rot, pad = 0) => rect(x, z, w, d, rot, pad, (k) => !a[k]),
    mark: (x, z, w, d, rot, pad = 0, v = 2) => rect(x, z, w, d, rot, pad, (k) => { if (a[k] < v) a[k] = v; }),
    at: (x, z) => { const k = cell(x, z); return k < 0 ? 0 : a[k]; },
  };
}

export function buildSettlements(hf, bio, map, plan, opts = {}) {
  const t0 = performance.now();
  const occ = opts.occ ?? occupancy(hf);
  const group = new THREE.Group();
  const material = propMaterial();
  const counts = {};
  let tris = 0;
  // высота земли — по самому мешу рельефа (opts.ground), если он дан: ленты и постройки стоят на том, что видно
  const ground = opts.ground ?? null;
  const land = ground ?? ((x, z) => hf.sample(x, z));
  const [gx0, gz0] = hf.bounds;
  const cellOf = (x, z) => {
    const i = Math.round((x - gx0) / hf.step), j = Math.round((z - gz0) / hf.step);
    return i < 0 || j < 0 || i >= hf.size || j >= hf.size ? -1 : j * hf.size + i;
  };
  const zoneAt = (x, z) => { const k = cellOf(x, z); return k < 0 ? 'none' : PLAN_ZONES[plan.zone[k]]; };
  const siteAt = (x, z) => { const k = cellOf(x, z); return k < 0 ? -1 : plan.siteOf[k]; };

  // градиент высоты → нормаль берега (в сторону воды)
  function seaNormal(x, z) {
    const e = 3, gx = land(x + e, z) - land(x - e, z), gz = land(x, z + e) - land(x, z - e), l = Math.hypot(gx, gz) || 1;
    return [-gx / l, -gz / l];
  }
  // кромка воды от (x, z) по направлению (dx, dz) не дальше max: точка перехода через 0
  function edge(x, z, dx, dz, max) {
    let hp = land(x, z);
    if (hp < 0) return null;
    for (let t = 1; t <= max; t += 1) {
      const h = land(x + dx * t, z + dz * t);
      if (h < 0) { const k = t - 1 + hp / (hp - h); return { x: x + dx * k, z: z + dz * k, t: k }; }
      hp = h;
    }
    return null;
  }

  // контекст одного батча: put — постройка из библиотеки, road — лента по точкам, ribbon — объект-лента по точкам с высотой
  function batchCtx(name, style, rng) {
    const batch = new PropBatch(), extras = [];
    const put = (id, x, z, rot, o = {}) => {
      const def = STRUCTURES[id], { w, d } = def.footprint;
      let y = o.y ?? 0;
      if (o.y === undefined && !def.water) {
        const c = Math.cos(rot), s = Math.sin(rot);
        let lo = Infinity, hi = -Infinity;
        for (const [cx, cz] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]]) {
          const lx = cx * w / 2, lz = cz * d / 2, h = land(x + lx * c + lz * s, z - lx * s + lz * c);
          lo = Math.min(lo, h); hi = Math.max(hi, h);
        }
        if (o.check !== false && (lo < (o.minH ?? 0.7) || hi - lo > (o.tol ?? 2.2) || !occ.free(x, z, w, d, rot, o.pad ?? 0.6))) return false;
        y = lo - 0.12;
      }
      // у объектов у воды начало на кромке, футпринт лежит в +Z от неё
      const fx = def.water ? x + Math.sin(rot) * d / 2 : x, fz = def.water ? z + Math.cos(rot) * d / 2 : z;
      if (def.water && o.check !== false && !occ.free(fx, fz, w, d, rot, 0)) return false;
      extras.push(...addStructure(batch, id, mat(x, y, z, 1, 1, 1, 0, rot, 0), { style, variant: o.variant ?? Math.floor(rng() * (def.variants ?? 1)), ...o.params }, rng));
      occ.mark(fx, fz, w, d, rot, o.mark ?? 0.4, 2);
      counts[id] = (counts[id] ?? 0) + 1;
      return true;
    };
    const ribbon = (id, pts3, o = {}) => {
      const drape = ground && VIS[id] ? { ground, lift: o.lift ?? 0 } : {};
      extras.push(...addStructure(batch, id, new THREE.Matrix4(), { style, variant: o.variant ?? 0, points: pts3, ...drape, ...o.params }, rng));
      counts[id] = (counts[id] ?? 0) + 1;
    };
    // лента: суша по точкам через step м (вода и обрывки короче minLen отбрасываются), y — высота земли
    const road = (id, pts, o = {}) => {
      const hw = HW[id] ?? 2, minLen = o.minLen ?? 5;
      const runs = [[]];
      for (const p of resample(pts, o.step ?? 3)) {
        if (land(p[0], p[1]) > 0.5) runs.at(-1).push(p); else if (runs.at(-1).length) runs.push([]);
      }
      const out = runs.filter((r) => r.length >= 2 && polyline(r).L >= minLen);
      for (const run of out) {
        ribbon(id, run.map(([x, z]) => [x, land(x, z), z]), o);
        for (let i = 0; i < run.length - 1; i++) {
          const [ax, az] = run[i], [bx, bz] = run[i + 1];
          occ.mark((ax + bx) / 2, (az + bz) / 2, 2 * hw, Math.hypot(bx - ax, bz - az) + 1, Math.atan2(bx - ax, bz - az), 0, 1);
        }
      }
      return out;
    };
    const finish = () => {
      if (!batch.pos.length) return;
      const g = new THREE.Group();
      g.name = name;
      const mesh = batch.toMesh(material);
      mesh.castShadow = mesh.receiveShadow = true;
      g.add(mesh, ...extras);
      mergeStatic(g);
      g.traverse((m) => { if (m.isMesh) tris += m.geometry.attributes.position.count / 3; });
      group.add(g);
    };
    return { put, road, ribbon, finish, rng, style };
  }

  // постройка у улицы: от u0 в обе стороны с шагом 2 м до первого свободного места; side ±1 — сторона от оси
  function alongStreet(ctx, id, st, side, u0, o = {}) {
    const { d } = STRUCTURES[id].footprint, hw = HW[st.road] ?? 2;
    for (let k = 0; k < 40; k++) {
      const u = u0 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 2;
      if (u < 4 || u > st.P.L - 4) continue;
      const p = st.P.at(u), nx = -p.tz * side, nz = p.tx * side, off = hw + 1 + d / 2 + (o.setback ?? 0);
      if (ctx.put(id, p.x + nx * off, p.z + nz * off, Math.atan2(-nx, -nz), o)) return { u, x: p.x + nx * off, z: p.z + nz * off };
    }
    return null;
  }
  // застройка улицы с обеих сторон: choose(x, z) — id дома в этой точке или null (здесь не строить);
  // smaller — чем заменить дом, если не встал
  function fillStreet(ctx, st, choose, smaller) {
    const hw = HW[st.road] ?? 2;
    for (const side of [-1, 1]) {
      let u = 3 + ctx.rng() * 3;
      while (u < st.P.L - 3) {
        const p = st.P.at(u), nx0 = -p.tz * side, nz0 = p.tx * side, id = choose(p.x + nx0 * (hw + 5), p.z + nz0 * (hw + 5));
        if (!id) { u += 4; continue; }
        const gap = ctx.rng() * 0.8;
        let w = 0;
        for (let t = id; t && !w; t = smaller[t]) {
          const fp = STRUCTURES[t].footprint;
          const q = st.P.at(Math.min(st.P.L, u + fp.w / 2)), nx = -q.tz * side, nz = q.tx * side, off = hw + 0.8 + fp.d / 2 + gap;
          if (ctx.put(t, q.x + nx * off, q.z + nz * off, Math.atan2(-nx, -nz))) w = fp.w;
        }
        u += w ? w + 0.6 + ctx.rng() * 1.4 : 2;
      }
    }
  }
  // фонари вдоль улицы — только в границе посёлка idx
  function lamps(ctx, st, every, idx) {
    const hw = HW[st.road] ?? 2;
    for (let u = every / 2, i = 0; u < st.P.L; u += every, i++) {
      const p = st.P.at(u), side = i % 2 ? 1 : -1, nx = -p.tz * side, nz = p.tx * side;
      if (siteAt(p.x, p.z) !== idx) continue;
      ctx.put('street-lamp', p.x + nx * (hw + 0.5), p.z + nz * (hw + 0.5), Math.atan2(-nx, -nz), { pad: 0, mark: 0.2 });
    }
  }
  // подпорные стенки вдоль улицы в границе посёлка: земля сбоку (за обочиной, до 4 м) ниже полотна больше чем на 1.2 м —
  // стенка с низовой стороны лицом наружу; выше — с верховой, лицом к улице. Куски короче 6 м отбрасываются.
  function walls(ctx, st, idx) {
    const hw = HW[st.road] ?? 2, off = hw + 0.6, P = st.P;
    for (const side of [-1, 1]) {
      let run = [];
      const flush = () => {
        if (run.length >= 4 && polyline(run.map((r) => [r.x, r.z])).L >= 6) {
          const down = run.filter((r) => r.down).length >= run.length / 2;
          const h = Math.min(4, Math.max(1, Math.round(run.reduce((a, r) => a + (down ? r.drop : r.rise), 0) / run.length * 2) / 2));
          let pts = run.map((r) => [r.x, down ? r.y - h : r.y, r.z]);
          // лицо — к +s ленты: s = (−tz, tx), это нормаль стороны side = +1
          if (down !== (side > 0)) pts = pts.reverse();
          ctx.ribbon('retaining-wall', pts, { params: { height: h } });
          for (const r of run) occ.mark(r.x, r.z, 1.5, 2.5, 0, 0, 1);
        }
        run = [];
      };
      for (let u = 1; u < P.L - 1; u += 2) {
        const p = P.at(u), nx = -p.tz * side, nz = p.tx * side, x = p.x + nx * off, z = p.z + nz * off;
        const y = land(p.x, p.z), g1 = land(x, z), g2 = land(p.x + nx * (off + 3.4), p.z + nz * (off + 3.4));
        const drop = y - Math.min(g1, g2), rise = Math.max(g1, g2) - y;
        const ok = siteAt(p.x, p.z) === idx && g1 > 0.5 && occ.at(p.x + nx * (off + 1.5), p.z + nz * (off + 1.5)) === 0 && (drop > 1.2 || rise > 1.2);
        if (!ok) { flush(); continue; }
        const down = drop >= rise;
        if (run.length && run.at(-1).down !== down) flush();
        run.push({ x, z, y, drop, rise, down });
      }
      flush();
    }
  }
  // хутор фасадом к дороге: дом, сарай, поленница, телега, колодец, ограда огорода
  function farmstead(ctx, x, z, rot) {
    const rng = ctx.rng, c = Math.cos(rot), sn = Math.sin(rot);
    const at = (lx, lz) => [x + lx * c + lz * sn, z - lx * sn + lz * c];
    if (!ctx.put(rng() < 0.7 ? 'cottage' : 'shed', x, z, rot, { pad: 1.5 })) return false;
    ctx.put('shed', ...at(9, -2 * rng()), rot + Math.PI / 2);
    ctx.put('woodpile', ...at(-7, -1), rot);
    if (rng() < 0.4) ctx.put('cart', ...at(-6, -7), rot + 1);
    if (rng() < 0.5) ctx.put('well', ...at(4, -7), rot);
    // ограда огорода: ряд секций по 4 м за домом
    const fl = 3 + Math.floor(rng() * 4);
    for (let f = 0; f < fl; f++) ctx.put('fence', ...at(-fl * 2 + 2 + f * 4, -11), rot, { pad: 0, mark: 0.1, tol: 1.2 });
    return true;
  }
  // окраины: хутора вдоль полевых дорог (track) в outskirts/fields через 30–45 м, мельницы — в полях
  function outskirts(ctx, p, streets, n, mills) {
    const rng = ctx.rng, tracks = streets.filter((l) => l.cls === 'track');
    let made = 0;
    for (const st of tracks) {
      const hw = HW[st.road] ?? 2;
      for (let u = 10 + rng() * 15; u < st.P.L - 8 && made < n; u += 30 + rng() * 15) {
        // сторона — та, где окраина или поле (снаружи полевой дороги обычно уже ничья земля)
        const q = st.P.at(u), s0 = rng() < 0.5 ? 1 : -1;
        for (const side of [s0, -s0]) {
          const nx = -q.tz * side, nz = q.tx * side, off = hw + 6, x = q.x + nx * off, z = q.z + nz * off, zn = zoneAt(x, z);
          if ((zn === 'outskirts' || zn === 'fields') && siteAt(x, z) < 0 && farmstead(ctx, x, z, Math.atan2(-nx, -nz))) { made++; break; }
        }
      }
    }
    if (!mills) return;
    // мельницы — на клетках полей вокруг посёлка (нет полей — на окраинах), случайные пробы
    const R = p.r * 2.2, fields = [], outs = [];
    for (let dz = -R; dz <= R; dz += 4) for (let dx = -R; dx <= R; dx += 4) {
      const x = p.x + dx, z = p.z + dz, zn = zoneAt(x, z);
      if (siteAt(x, z) >= 0) continue;
      if (zn === 'fields') fields.push([x, z]); else if (zn === 'outskirts') outs.push([x, z]);
    }
    const pool = fields.length > 20 ? fields : fields.concat(outs);
    for (let i = 0, k = 0; i < mills && k < 60 && pool.length; k++) {
      const [x, z] = pool[Math.floor(rng() * pool.length)];
      if (ctx.put('windmill', x, z, rng() * 6.28, { tol: 1.6, pad: 3 })) i++;
    }
  }

  // точки кромки вдоль улицы через 6 м: луч к воде по склону
  function shoreSpots(st, max = 60) {
    const out = [];
    for (let u = 4; u < st.P.L - 4; u += 6) {
      const a = st.P.at(u), [nx, nz] = seaNormal(a.x, a.z), e = edge(a.x, a.z, nx, nz, max);
      if (!e) continue;
      const [sx, sz] = seaNormal(e.x, e.z);
      out.push({ x: e.x, z: e.z, nx: sx, nz: sz, rot: Math.atan2(sx, sz) });
    }
    return out;
  }
  // объект у воды — в ближайшую к середине точку кромки, не ближе gap к уже занятым
  function atShore(ctx, id, spots, used, gap, o = {}) {
    const mid = spots.length / 2;
    const order = spots.map((q, i) => [q, Math.abs(i - mid)]).sort((a, b) => a[1] - b[1]).map((e) => e[0]);
    for (const q of order) {
      if (used.some((b) => Math.hypot(b.x - q.x, b.z - q.z) < gap)) continue;
      if (ctx.put(id, q.x, q.z, q.rot, o)) { used.push(q); return q; }
    }
    return null;
  }
  // причалы по berths плана
  const BERTH_LEN = { 'pier-stone': () => 45, 'pier-wood': (rng) => 22 + Math.round(rng() * 4), 'jetty-small': (rng) => 8 + Math.round(rng() * 4) };
  function berths(ctx, p) {
    const out = [];
    for (const b of p.berths) {
      if (!b.kind) continue;
      const len = BERTH_LEN[b.kind]?.(ctx.rng);
      if (ctx.put(b.kind, b.x, b.z, b.rot, { params: len ? { length: len } : undefined })) out.push(b);
    }
    return out;
  }

  // --- площадь и общественные здания -------------------------------------------
  function plazaAndReserves(ctx, p, town) {
    if (p.plaza) {
      const { x, z, rot, w } = p.plaza, y = land(x, z), c = Math.cos(rot), sn = Math.sin(rot);
      const at = (lx, lz) => [x + lx * c + lz * sn, z - lx * sn + lz * c];
      if (town) {
        ctx.put('plaza', x, z, rot, { check: false, y: y - 0.02, variant: 2 });
        ctx.put('fountain', x, z, rot, { check: false, y: y + 0.04 });
        for (const [lx, lz, id] of [[6, 6.5, 'bench'], [-6, 6.5, 'bench'], [6.5, -6.5, 'kiosk'], [-6.5, -6, 'advert-column'], [7.5, 0, 'post-box']]) {
          ctx.put(id, ...at(lx, lz), rot + (lz > 0 ? Math.PI : 0), { check: false, y: y + 0.06 });
        }
        ctx.put('monument', ...at(-(w / 2 + 3), 0), rot, { pad: 0.5 });
      } else {
        // деревенская площадь — без мощения: колодец и скамьи
        ctx.put('well', x, z, rot, { check: false });
        for (const lx of [-4, 4]) ctx.put('bench', ...at(lx, 3), rot + Math.PI, { pad: 0.2 });
      }
    }
    for (const r of p.reserves) {
      if (!ctx.put(r.id, r.x, r.z, r.rot, { check: false })) continue;
      if (r.id === 'town-hall') ctx.put('flagpole', r.x + Math.sin(r.rot) * (r.d / 2 + 2), r.z + Math.cos(r.rot) * (r.d / 2 + 2), 0, { pad: 0 });
    }
  }

  // --- город и порт ---------------------------------------------------------------
  function town(p, idx, ctx, streets) {
    const rng = ctx.rng, port = p.type === 'port';
    if (port) {
      const quay = streets.find((l) => l.cls === 'quay') ?? streets.find((l) => !FOOT.has(l.cls));
      const used = berths(ctx, p);
      const mole = used.find((b) => b.kind === 'pier-stone');
      // кран, грузы и сигнальная мачта — на причальной полосе у мола
      if (mole) {
        const ax = -mole.nz, az = mole.nx, bx = mole.x - mole.nx * 5, bz = mole.z - mole.nz * 5;
        ctx.put('crane', bx + ax * 6, bz + az * 6, mole.rot, { pad: 0.2 });
        for (let i = 0; i < 6; i++) ctx.put('cargo', bx + ax * (-12 + i * 5 + rng()) - mole.nx * rng() * 4, bz + az * (-12 + i * 5) - mole.nz * rng() * 4, mole.rot + (rng() - 0.5), { pad: 0.2 });
        ctx.put('signal-mast', bx - ax * 16 - mole.nx * 4, bz - az * 16 - mole.nz * 4, mole.rot, { pad: 0.3 });
      }
      if (quay) {
        const spots = shoreSpots(quay), taken = used.slice();
        atShore(ctx, 'slipway', spots, taken, 16);
        atShore(ctx, 'shipyard', spots, taken, 16);
        atShore(ctx, p.style !== 'south' ? 'lifeboat-station' : 'steps-water', spots, taken, 12);
      }
    }
    // жилая застройка по зонам плана
    const choose = (x, z) => {
      const zn = siteAt(x, z) === idx ? zoneAt(x, z) : zoneAt(x, z) === 'outskirts' ? 'outskirts' : 'none';
      if (zn === 'core') return pickW([['tenement', 3], ['townhouse', 4], ['shophouse', 4], ['villa', 0.5]], rng);
      if (zn === 'residential') return pickW([['townhouse', 3], ['cottage', 4], ['shophouse', 1.5], ['villa', 1], ['hut', 1]], rng);
      if (zn === 'waterfront') return pickW([['shed', 3], ['hut', 2], ['shophouse', 2], ['townhouse', 1]], rng);
      if (zn === 'outskirts' && rng() < 0.4) return pickW([['cottage', 5], ['hut', 3], ['shed', 1.5]], rng);
      return null;
    };
    const drive = streets.filter((l) => !FOOT.has(l.cls) && l.cls !== 'track');
    for (const st of drive) fillStreet(ctx, st, choose, SMALLER.town);
    for (const st of drive) lamps(ctx, st, 18, idx);
    // скамьи, тумбы, коновязи вдоль улиц — по случайным свободным местам в границе
    for (let i = 0; i < 12 && drive.length; i++) {
      const st = drive[Math.floor(rng() * drive.length)], q = st.P.at(rng() * st.P.L), side = rng() < 0.5 ? 1 : -1;
      const nx = -q.tz * side, nz = q.tx * side, id = pickW([['bench', 3], ['hitching-post', 1], ['advert-column', 1], ['telegraph-pole', 1]], rng);
      if (siteAt(q.x, q.z) === idx) ctx.put(id, q.x + nx * 4, q.z + nz * 4, Math.atan2(-nx, -nz), { pad: 0.2 });
    }
    outskirts(ctx, p, streets, port ? 5 : 4, p.style === 'north' ? 0 : 1);
  }

  // --- деревня (и рыбацкий посёлок) -------------------------------------------------
  function village(p, idx, ctx, streets) {
    const rng = ctx.rng, fish = p.fishing;
    const drive = streets.filter((l) => !FOOT.has(l.cls) && l.cls !== 'track');
    const main = drive[0];
    // у воды: мостки по berths, при каждых — лодки на берегу и сушилка сетей; лодочные сараи — на свободной кромке
    const used = berths(ctx, p);
    for (const b of used) {
      for (let k = 0; k < 2; k++) ctx.put('boat-beached', b.x - b.nx * 3 + b.nz * (5 + k * 2.5), b.z - b.nz * 3 - b.nx * (5 + k * 2.5), b.rot + (rng() - 0.5) * 0.5, { minH: 0.2, pad: 0.2 });
      ctx.put('net-rack', b.x - b.nx * 8 - b.nz * 6, b.z - b.nz * 8 + b.nx * 6, b.rot, { pad: 0.3 });
    }
    if (main && used.length) {
      const spots = shoreSpots(main), taken = used.slice();
      for (let n = 0; n < (fish ? 4 : 2); n++) atShore(ctx, 'boathouse', spots, taken, 9);
    }
    // рыбацкий: хижины, редкие дома, сараи под снасти; обычная деревня — дома и хижины, к краю реже
    const choose = (x, z) => {
      const zn = siteAt(x, z) === idx ? zoneAt(x, z) : zoneAt(x, z) === 'outskirts' ? 'outskirts' : 'none';
      if (zn === 'none' || zn === 'fields') return null;
      if (zn === 'outskirts') return !fish && rng() < 0.3 ? pickW([['hut', 3], ['cottage', 3], ['shed', 2]], rng) : null;
      if (fish) return pickW([['hut', 6], ['cottage', 1], ['shed', 2]], rng);
      return zn === 'core' ? pickW([['cottage', 5], ['hut', 3], ['townhouse', 0.6], ['shed', 0.8]], rng) : pickW([['hut', 3], ['cottage', 3], ['shed', 2]], rng);
    };
    for (const st of drive) fillStreet(ctx, st, choose, SMALLER.village);
    if (!p.plaza) ctx.put('well', p.x, p.z, 0, { pad: 0.3 });
    for (let i = 0; i < 5 && drive.length; i++) {
      const st = drive[Math.floor(rng() * drive.length)], q = st.P.at(rng() * st.P.L), side = rng() < 0.5 ? 1 : -1;
      ctx.put(pickW(fish ? [['net-rack', 3], ['woodpile', 1], ['boat-beached', 2], ['bench', 1]] : [['woodpile', 2], ['cart', 1], ['bench', 1], ['telegraph-pole', 1]], rng), q.x - q.tz * side * 4, q.z + q.tx * side * 4, rng() * 6.28, { pad: 0.2 });
    }
    if (fish) {
      // малый маяк у кромки за концом главной улицы: первое место, где встаёт
      if (!main) return;
      for (const u of [4, main.P.L - 4, main.P.L * 0.2, main.P.L * 0.8]) for (const back of [2, 4, 7]) {
        const a = main.P.at(u), [nx, nz] = seaNormal(a.x, a.z), e = edge(a.x, a.z, nx, nz, 60);
        if (e && ctx.put('harbor-light', e.x - nx * back, e.z - nz * back, Math.atan2(nx, nz), { minH: 0.2, tol: 3, pad: 0.2 })) return;
      }
      return;
    }
    outskirts(ctx, p, streets, 2 + Math.floor(rng() * 2), p.name === 'Мельница' ? 3 : p.style === 'north' ? 0 : rng() < 0.5 ? 1 : 0);
  }

  // --- маяк ----------------------------------------------------------------------
  function lighthouse(p, ctx) {
    const y = land(p.x, p.z) - 0.2, rot = p.sea ? Math.atan2(p.sea.dx, p.sea.dz) : 0;
    if (p.proto === 'fastnet') { ctx.put('lighthouse-fastnet', p.x, p.z, rot, { check: false, y: y - 0.4 }); return; }
    ctx.put('lighthouse', p.x, p.z, rot, { check: false, y });
    // дом смотрителя — от моря, первое место, где встаёт
    for (let k = 0; k < 16; k++) {
      const a = rot + Math.PI + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.35, d = 9 + (k > 8 ? 4 : 0);
      if (ctx.put('keeper-house', p.x + Math.sin(a) * d, p.z + Math.cos(a) * d, rot, { variant: 0, tol: 2.5 })) break;
    }
  }

  // --- причал снабжения (у маяка без посёлка): мостки по berth плана, сарай, грузы, лодка ---
  function landing(p, ctx) {
    const b = p.berths[0];
    if (!b) return;
    const { nx, nz, rot } = b;
    ctx.put('jetty-small', b.x, b.z, rot, { params: { length: 12 } });
    const at = (back, side) => [b.x - nx * back + nz * side, b.z - nz * back - nx * side];
    ctx.put('shed', ...at(9, 6), rot, { tol: 2.5 });
    ctx.put('cargo', ...at(6, -4), rot + 0.3, { pad: 0.2, tol: 2.5 });
    ctx.put('boat-beached', ...at(3, -9), rot + 0.4, { minH: 0.2, pad: 0.2 });
  }

  // --- перекрёстки: все пути плана одним списком; конец младшего (или равного) пути, упёршийся в середину другого,
  // обрезается до края того (минус 0.3 м нахлёста под ним). Стыки концами (куски одной улицы) не трогаются.
  const lines = [];
  plan.sites.forEach((p, idx) => p.streets.forEach((l, n) => {
    const id = RIBBON[l.road] ?? l.road, variant = id === 'road-cobble' ? hash(p.name + n) % 2 : 0;
    lines.push({ site: idx, cls: l.cls, id, variant, rank: RANK[l.cls] ?? 2, pts: l.pts });
  }));
  for (const r of plan.roads) {
    for (const sg of r.segs ?? [{ road: r.kind === 'path' ? 'path' : 'road-dirt', pts: r.pts }]) {
      const id = RIBBON[sg.road] ?? sg.road;
      lines.push({ road: r, id, variant: 0, rank: sg.road === 'stairs' ? 5 : sg.road === 'path' ? 4 : RANK[r.kind] ?? 2, pts: sg.pts });
    }
  }
  for (const l of lines) {
    l.box = l.pts.reduce((b, [x, z]) => [Math.min(b[0], x), Math.min(b[1], z), Math.max(b[2], x), Math.max(b[3], z)], [Infinity, Infinity, -Infinity, -Infinity]);
  }
  const nearest = (x, z, pts) => {
    let best = { d: Infinity, end: false };
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)), d = Math.hypot(x - ax - dx * t, z - az - dz * t);
      if (d < best.d) best = { d, x: ax + dx * t, z: az + dz * t };
    }
    best.end = Math.hypot(best.x - pts[0][0], best.z - pts[0][1]) < 4 || Math.hypot(best.x - pts.at(-1)[0], best.z - pts.at(-1)[1]) < 4;
    return best;
  };
  for (const l of lines) {
    if (l.rank >= 5) continue;
    let q = resample(l.pts, 0.5);
    for (const end of [0, 1]) {
      const e = end ? q.at(-1) : q[0];
      let cut = 0;
      for (const o of lines) {
        if (o === l || o.rank > l.rank || o.rank >= 5 || e[0] < o.box[0] - 4 || e[0] > o.box[2] + 4 || e[1] < o.box[1] - 4 || e[1] > o.box[3] + 4) continue;
        const nb = nearest(e[0], e[1], o.pts);
        if (nb.d < 3.5 && !nb.end) cut = Math.max(cut, VIS[o.id][o.variant] - 0.3 - nb.d * 0.5);
      }
      const k = Math.round(cut / 0.5);
      if (k > 0 && q.length - k >= 3) q = end ? q.slice(0, q.length - k) : q.slice(k);
    }
    l.pts = q;
  }

  // --- все площадки плана: сначала ленты улиц (они занимают маску первыми), потом стенки, площадь, резервы, остальное ---
  plan.sites.forEach((p, idx) => {
    const ctx = batchCtx(p.name, p.style, seeded(hash(p.name)));
    const streets = [];
    for (const l of lines.filter((q) => q.site === idx)) {
      for (const run of ctx.road(l.id, l.pts, { variant: l.variant, lift: LIFT[l.rank] })) streets.push({ cls: l.cls, road: l.id, P: polyline(run) });
    }
    for (const st of streets) if (!FOOT.has(st.cls)) walls(ctx, st, idx);
    if (p.type === 'lighthouse') lighthouse(p, ctx);
    else if (p.type === 'landing') landing(p, ctx);
    else {
      plazaAndReserves(ctx, p, p.type !== 'village');
      if (p.type === 'village') village(p, idx, ctx, streets); else town(p, idx, ctx, streets);
    }
    ctx.finish();
  });

  // дороги между посёлками (plan.roads) — батч на остров; у дорог (не полевых) — телеграфные столбы
  const islandOf = new Map(plan.sites.map((p) => [p.name, p.island]));
  const byIsland = new Map();
  for (const r of plan.roads) {
    const isl = islandOf.get(r.from) ?? -1;
    (byIsland.get(isl) ?? byIsland.set(isl, []).get(isl)).push(r);
  }
  let roadKm = 0;
  for (const [isl, list] of byIsland) {
    const first = plan.sites.find((p) => p.island === isl);
    const ctx = batchCtx(`дороги ${map.islands[isl]?.name ?? isl}`, first?.style ?? 'atlantic', seeded(isl * 977 + 13));
    for (const r of list) {
      for (const l of lines.filter((q) => q.road === r)) {
        for (const run of ctx.road(l.id, l.pts, { lift: LIFT[l.rank] })) {
          const P = polyline(run);
          roadKm += P.L / 1000;
          if (r.kind !== 'road-dirt') continue;
          for (let u = 20; u < P.L - 10; u += 42) {
            const c = P.at(u);
            ctx.put('telegraph-pole', c.x - c.tz * 4.5, c.z + c.tx * 4.5, Math.atan2(c.tx, c.tz), { pad: 0, mark: 0.2, tol: 3 });
          }
        }
      }
    }
    ctx.finish();
  }

  const buildings = Object.entries(counts).reduce((a, [id, n]) => a + (STRUCTURES[id].road ? 0 : n), 0);
  return { group, occ, counts, sites: plan.sites, stats: { buildings, tris, roadKm, ms: performance.now() - t0 } };
}
