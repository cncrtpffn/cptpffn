import * as THREE from 'three';
import { PropBatch, propMaterial, mat } from '../flora.js';
import { STRUCTURES, addStructure } from '../structures/index.js';
import { seeded } from '../structures/kit.js';
import { mergeStatic } from '../merge-static.js';
import { polyline, resample, chaikin, makeRouter } from './geom.js';

// ЗАМОРОЖЕНО (не править): строитель без плана для карт на settlement-plan-v1.js («Архипелаг»); удалится вместе с ним.
// Поселения, порты, маяки и дороги на карте по полю высот (шаг 3 карты «Архипелаг»).
// По площадкам hf.sites: port/town — сетка улиц вдоль берега с площадью и общественными зданиями, village — улица
// вдоль берега и короткая поперечная, lighthouse — маяк (и дом смотрителя), landing — причал снабжения маяка. Постройки — библиотека src/scene/structures.
// Стиль посёлка — преобладающий биом в центре площадки. Дороги между поселениями одного острова — A* по сетке 8 м.
// Один PropBatch на поселение (и на дороги острова), светящиеся детали сливаются по материалу (mergeStatic).
// Маска занятости occ (сетка поля высот): 1 — дорога, 2 — постройка; растительность её обходит.

const hash = (s) => { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.codePointAt(0), 16777619); return h >>> 0; };
const pickW = (table, rng) => { // [[id, вес], …]
  let t = rng() * table.reduce((a, e) => a + e[1], 0);
  for (const [id, w] of table) if ((t -= w) < 0) return id;
  return table[0][0];
};
const HW = { 'road-cobble': 2.9, 'road-dirt': 2.1, path: 0.9 }; // полуширина ленты с обочиной

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

export function buildSettlements(hf, bio, map, opts = {}) {
  const t0 = performance.now();
  const occ = opts.occ ?? occupancy(hf);
  const group = new THREE.Group();
  const material = propMaterial();
  const counts = {};
  let tris = 0;
  const land = (x, z) => hf.sample(x, z);

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
  // направление к ближайшей воде от центра площадки
  function seaward(s) {
    let best = null;
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2, e = edge(s.x, s.z, Math.cos(a), Math.sin(a), s.r + 160);
      if (e && (!best || e.t < best.t)) best = { ...e, dx: Math.cos(a), dz: Math.sin(a) };
    }
    return best;
  }

  // контекст одного батча: put — постройка из библиотеки, road — лента по точкам
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
    // лента: суша по точкам (вода и обрывки короче 12 м отбрасываются), y — высота земли
    const road = (id, pts, o = {}) => {
      const hw = HW[id] ?? 2;
      const runs = [[]];
      for (const p of resample(pts, 4)) {
        if (land(p[0], p[1]) > 0.5) runs.at(-1).push(p); else if (runs.at(-1).length) runs.push([]);
      }
      for (const run of runs) {
        if (run.length < 4) continue;
        const pts3 = run.map(([x, z]) => [x, land(x, z), z]);
        extras.push(...addStructure(batch, id, new THREE.Matrix4(), { style, variant: o.variant ?? 0, points: pts3 }, rng));
        for (let i = 0; i < run.length - 1; i++) {
          const [ax, az] = run[i], [bx, bz] = run[i + 1];
          occ.mark((ax + bx) / 2, (az + bz) / 2, 2 * hw, Math.hypot(bx - ax, bz - az) + 1, Math.atan2(bx - ax, bz - az), 0, 1);
        }
        counts[id] = (counts[id] ?? 0) + 1;
      }
      return runs.filter((r) => r.length >= 4);
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
    return { put, road, finish, rng };
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
  // застройка улицы с обеих сторон: choose(dc) — id по расстоянию от центра
  function fillStreet(ctx, st, s, choose) {
    const hw = HW[st.road] ?? 2;
    for (const side of [-1, 1]) {
      let u = 3 + ctx.rng() * 3;
      while (u < st.P.L - 3) {
        const p = st.P.at(u), dc = Math.hypot(p.x - s.x, p.z - s.z) / s.r, id = choose(dc);
        const { w, d } = STRUCTURES[id].footprint;
        const q = st.P.at(Math.min(st.P.L, u + w / 2)), nx = -q.tz * side, nz = q.tx * side, off = hw + 0.8 + d / 2 + ctx.rng() * 0.8;
        if (ctx.put(id, q.x + nx * off, q.z + nz * off, Math.atan2(-nx, -nz))) u += w + 0.6 + ctx.rng() * 1.4;
        else u += 2;
      }
    }
  }
  // фонари вдоль улицы
  function lamps(ctx, st, every) {
    const hw = HW[st.road] ?? 2;
    for (let u = every / 2, i = 0; u < st.P.L; u += every, i++) {
      const p = st.P.at(u), side = i % 2 ? 1 : -1, nx = -p.tz * side, nz = p.tx * side;
      ctx.put('street-lamp', p.x + nx * (hw + 0.5), p.z + nz * (hw + 0.5), Math.atan2(-nx, -nz), { pad: 0, mark: 0.2 });
    }
  }
  // хутора и мельницы за околицей
  function outskirts(ctx, s, n, style, mills) {
    const rng = ctx.rng;
    for (let i = 0; i < mills; i++) {
      for (let k = 0; k < 30; k++) {
        const a = rng() * Math.PI * 2, d = s.r * (1.05 + rng() * 0.6);
        if (ctx.put('windmill', s.x + Math.cos(a) * d, s.z + Math.sin(a) * d, rng() * 6.28, { tol: 1.6, pad: 3 })) break;
      }
    }
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2, d = s.r * (0.95 + rng() * 0.7), x = s.x + Math.cos(a) * d, z = s.z + Math.sin(a) * d;
      const rot = rng() * 6.28, c = Math.cos(rot), sn = Math.sin(rot);
      const at = (lx, lz) => [x + lx * c + lz * sn, z - lx * sn + lz * c];
      if (!ctx.put(rng() < 0.6 ? 'cottage' : 'shed', x, z, rot, { pad: 1.5 })) continue;
      ctx.put('shed', ...at(9, 2 * (rng() - 0.5)), rot + Math.PI / 2);
      ctx.put('woodpile', ...at(-7, 1), rot);
      if (rng() < 0.4) ctx.put('cart', ...at(-6, 7), rot + 1);
      if (rng() < 0.5) ctx.put('well', ...at(4, 7), rot);
      // ограда огорода: ряд секций по 4 м перед домом
      const fl = 3 + Math.floor(rng() * 4);
      for (let f = 0; f < fl; f++) ctx.put('fence', ...at(-fl * 2 + 2 + f * 4, 11), rot, { pad: 0, mark: 0.1, tol: 1.2 });
    }
  }

  // --- город и порт ---------------------------------------------------------
  function town(s, style, ctx, sea) {
    const rng = ctx.rng, port = s.type === 'port', R = s.r;
    // оси: n — к воде, a — вдоль берега; без воды рядом — случайно
    const n = sea ? [sea.dx, sea.dz] : (() => { const a = rng() * 6.28; return [Math.cos(a), Math.sin(a)]; })();
    const a = [-n[1], n[0]];
    const P = (u, v) => [s.x + a[0] * u + n[0] * v, s.z + a[1] * u + n[1] * v];
    // порт: улицы отодвинуты от воды (первая — набережная), в городе — сетка через центр
    // порт: между набережной и водой ~24 м под причальную полосу
    const vEdge = sea ? Math.min(sea.t - (port ? 24 : 12), R * 0.4) : R * 0.6;
    const vs = port ? [vEdge, vEdge - 30, vEdge - 60, vEdge - 90].filter((v) => v > -R * 1.4)
      : [30, 0, -30, -60].filter((v) => v <= vEdge).slice(0, 3);
    const L = R * (port ? 1.25 : 1.05);
    const roadId = 'road-cobble', streets = [];
    const addStreet = (pts) => { for (const run of ctx.road(roadId, pts, { variant: rng() < 0.5 ? 0 : 1 })) streets.push({ road: roadId, P: polyline(run) }); };
    for (const v of vs) addStreet([P(-L, v + 3 * (rng() - 0.5)), P(0, v), P(L, v + 3 * (rng() - 0.5))]);
    const us = port ? [-40, 0, 40] : [0, rng() < 0.5 ? -35 : 35];
    const vMin = Math.min(...vs) - 12, vMax = Math.max(...vs);
    for (const u of us) addStreet([P(u, vMax), P(u + 4 * (rng() - 0.5), vMin)]);

    // площадь между первыми двумя продольными улицами у поперечной u = 0
    const pc = P(12, (vs[0] + vs[1]) / 2), rot = Math.atan2(n[0], n[1]);
    ctx.put('plaza', pc[0], pc[1], rot, { check: false, y: land(...pc) - 0.02 });
    ctx.put('fountain', pc[0], pc[1], rot, { check: false, y: land(...pc) + 0.04 });
    for (const [lx, lz, id] of [[6, 6.5, 'bench'], [-6, 6.5, 'bench'], [6.5, -6.5, 'kiosk'], [-6.5, -6, 'advert-column'], [7.5, 0, 'post-box']]) {
      const c = Math.cos(rot), sn = Math.sin(rot);
      ctx.put(id, pc[0] + lx * c + lz * sn, pc[1] - lx * sn + lz * c, rot + (lz > 0 ? Math.PI : 0), { check: false, y: land(...pc) + 0.06 });
    }
    if (port && sea) waterfront(s, ctx, n, a, P, vEdge, style);
    // общественные здания — ближе к площади; стороны: ±1 от оси улицы (у продольных −1 — к морю), не встало — другая
    const main = streets[0], second = streets[1] ?? streets[0];
    const mid = (st) => st.P.L / 2;
    const pub = port
      ? [['town-hall', second, 1], ['church', streets[2] ?? second, 1], ['customs', main, -1], ['tavern', main, -1], ['market', second, -1],
        ['warehouse', main, 1], ['warehouse', main, 1], ['pilot-station', main, -1]]
      : [['church', second, 1], ['tavern', main, -1], ['market', second, -1], ['town-hall', main, 1]];
    for (const [id, st, side] of pub) {
      const u0 = mid(st) + (rng() - 0.5) * 30, r = alongStreet(ctx, id, st, side, u0) ?? alongStreet(ctx, id, st, -side, u0);
      if (r && id === 'town-hall') ctx.put('flagpole', r.x + n[0] * 2, r.z + n[1] * 2, 0, { pad: 0 });
    }
    ctx.put('monument', ...P(-14, (vs[0] + vs[1]) / 2), rot, { pad: 0.5 });

    // жилая застройка: в центре — доходные дома и лавки, к окраине — дома и хижины
    const choose = (dc) => pickW(dc < 0.55
      ? [['tenement', 3], ['townhouse', 4], ['shophouse', 4], ['villa', 0.5]]
      : dc < 1 ? [['townhouse', 3], ['cottage', 4], ['shophouse', 1.5], ['villa', 1], ['hut', 1]]
        : [['cottage', 5], ['hut', 3], ['shed', 1.5]], rng);
    for (const st of streets) fillStreet(ctx, st, s, choose);
    for (const st of streets) lamps(ctx, st, 18);
    // скамьи, тумбы, коновязи вдоль улиц — по случайным свободным местам
    for (let i = 0; i < 12; i++) {
      const st = streets[Math.floor(rng() * streets.length)], u = rng() * st.P.L, p = st.P.at(u), side = rng() < 0.5 ? 1 : -1;
      const nx = -p.tz * side, nz = p.tx * side, id = pickW([['bench', 3], ['hitching-post', 1], ['advert-column', 1], ['telegraph-pole', 1]], rng);
      ctx.put(id, p.x + nx * 4, p.z + nz * 4, Math.atan2(-nx, -nz), { pad: 0.2 });
    }
    outskirts(ctx, s, port ? 5 : 4, style, style === 'north' ? 0 : 1);
  }

  // набережная порта: мол, пирсы, стенки, стапель, кран и грузы у кромки
  function waterfront(s, ctx, n, a, P, vEdge, style) {
    const rng = ctx.rng;
    const shore = (u) => {
      const [x, z] = P(u, vEdge - 4), e = edge(x, z, n[0], n[1], 70);
      if (!e) return null;
      const [nx, nz] = seaNormal(e.x, e.z);
      return { ...e, rot: Math.atan2(nx, nz), nx, nz };
    };
    const water = (id, u, params) => {
      const e = shore(u);
      return e && ctx.put(id, e.x, e.z, e.rot, { params }) ? e : null;
    };
    const mole = water('pier-stone', 0, { length: 45 });
    water('pier-wood', -30, { length: 26 });
    water('pier-wood', 32, { length: 22, tee: 0 });
    for (const u of [-14, 14, 46, -46]) water('quay-wall', u);
    water('slipway', -62);
    water('shipyard', 62);
    if (style !== 'south') water('lifeboat-station', 78);
    else water('steps-water', 22);
    // кран и грузы на причальной полосе
    if (mole) {
      const bx = mole.x - mole.nx * 5, bz = mole.z - mole.nz * 5;
      ctx.put('crane', bx + a[0] * 6, bz + a[1] * 6, mole.rot, { pad: 0.2 });
      for (let i = 0; i < 6; i++) ctx.put('cargo', bx + a[0] * (-12 + i * 5 + rng()) - mole.nx * rng() * 4, bz + a[1] * (-12 + i * 5) - mole.nz * rng() * 4, mole.rot + (rng() - 0.5), { pad: 0.2 });
      ctx.put('signal-mast', bx - a[0] * 16 - mole.nx * 4, bz - a[1] * 16 - mole.nz * 4, mole.rot, { pad: 0.3 });
    }
  }

  // --- деревня ----------------------------------------------------------------
  function village(s, style, ctx, sea) {
    const rng = ctx.rng, R = s.r;
    const n = sea ? [sea.dx, sea.dz] : (() => { const a = rng() * 6.28; return [Math.cos(a), Math.sin(a)]; })();
    const a = [-n[1], n[0]];
    const P = (u, v) => [s.x + a[0] * u + n[0] * v, s.z + a[1] * u + n[1] * v];
    const roadId = 'road-dirt', streets = [];
    const v0 = sea ? Math.min(0, sea.t - 14) : 0, L = R * 1.15, bend = 3 + rng() * 4;
    const mainPts = Array.from({ length: 7 }, (_, i) => { const u = -L + (i / 6) * 2 * L; return P(u, v0 + bend * Math.sin(u / R * 2)); });
    for (const run of ctx.road(roadId, mainPts)) streets.push({ road: roadId, P: polyline(run) });
    if (R >= 30) for (const run of ctx.road(roadId, [P(4, v0), P(6 + 6 * (rng() - 0.5), v0 - R)])) streets.push({ road: roadId, P: polyline(run) });
    if (!streets.length) return;
    const main = streets[0];
    ctx.put('well', ...P(-6, v0 - 6), 0, { pad: 0.3 });
    if (rng() < 0.5) alongStreet(ctx, 'chapel', main, -1, main.P.L * (0.3 + 0.4 * rng()));
    if (rng() < 0.5) alongStreet(ctx, 'tavern', main, -1, main.P.L * (0.3 + 0.4 * rng()));
    // рыбацкий (fishing): хижины, редкие дома, сараи под снасти; без хуторов и мельниц
    const fish = !!s.fishing;
    const choose = (dc) => pickW(fish ? [['hut', 6], ['cottage', 1], ['shed', 2]]
      : dc < 0.8 ? [['cottage', 5], ['hut', 3], ['townhouse', 0.6], ['shed', 0.8]] : [['hut', 3], ['cottage', 3], ['shed', 2]], rng);
    for (const st of streets) fillStreet(ctx, st, s, choose);
    for (let i = 0; i < 5; i++) {
      const st = streets[Math.floor(rng() * streets.length)], p = st.P.at(rng() * st.P.L), side = rng() < 0.5 ? 1 : -1;
      ctx.put(pickW(fish ? [['net-rack', 3], ['woodpile', 1], ['boat-beached', 2], ['bench', 1]] : [['woodpile', 2], ['cart', 1], ['bench', 1], ['telegraph-pole', 1]], rng), p.x - p.tz * side * 4, p.z + p.tx * side * 4, rng() * 6.28, { pad: 0.2 });
    }
    // у воды: мостки, лодочный сарай, лодки на берегу, сушилки сетей (у рыбацкого — по всему берегу и малый маяк)
    if (sea && sea.t < R + 40) {
      const shoreline = fish
        ? [['jetty-small', 0], ['boathouse', 10], ['jetty-small', 20], ['boathouse', -12], ['jetty-small', -24], ['boathouse', 32], ['jetty-small', -40], ['boathouse', -50]]
        : [['jetty-small', 0], ['boathouse', 14], ['jetty-small', -22], ['boathouse', -36]];
      for (const [id, u] of shoreline) {
        const [x, z] = P(u, 0), e = edge(x, z, n[0], n[1], R + 60);
        if (!e) continue;
        const [nx, nz] = seaNormal(e.x, e.z);
        ctx.put(id, e.x, e.z, Math.atan2(nx, nz), { params: id === 'jetty-small' ? { length: 8 + Math.round(rng() * 4) } : undefined });
        if (id === 'jetty-small') {
          for (let b = 0; b < 2; b++) ctx.put('boat-beached', e.x - nx * 3 + nz * (5 + b * 2.5), e.z - nz * 3 - nx * (5 + b * 2.5), Math.atan2(nx, nz) + (rng() - 0.5) * 0.5, { minH: 0.2, pad: 0.2 });
          ctx.put('net-rack', e.x - nx * 8 - nz * 6, e.z - nz * 8 + nx * 6, Math.atan2(nx, nz), { pad: 0.3 });
        }
      }
    }
    if (fish) {
      // малый маяк на краю посёлка у кромки: первое место, где встаёт
      for (const k of [0.9, -0.9, 0.7, -0.7, 0.5, -0.5]) for (const back of [2, 4, 7]) {
        const [x, z] = P(L * k, v0), e = edge(x, z, n[0], n[1], R + 60);
        if (e && ctx.put('harbor-light', e.x - n[0] * back, e.z - n[1] * back, Math.atan2(n[0], n[1]), { minH: 0.2, tol: 3, pad: 0.2 })) return;
      }
      return;
    }
    outskirts(ctx, s, 2 + Math.floor(rng() * 2), style, s.name === 'Мельница' ? 3 : style === 'north' ? 0 : rng() < 0.5 ? 1 : 0);
  }

  // --- маяк ----------------------------------------------------------------------
  function lighthouse(s, style, ctx, sea) {
    const y = land(s.x, s.z) - 0.2, rot = sea ? Math.atan2(sea.dx, sea.dz) : 0;
    if (s.proto === 'fastnet') { ctx.put('lighthouse-fastnet', s.x, s.z, rot, { check: false, y: y - 0.4 }); return; }
    ctx.put('lighthouse', s.x, s.z, rot, { check: false, y });
    // дом смотрителя — от моря, первое место, где встаёт
    for (let k = 0; k < 16; k++) {
      const a = rot + Math.PI + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.35, d = 9 + (k > 8 ? 4 : 0);
      if (ctx.put('keeper-house', s.x + Math.sin(a) * d, s.z + Math.cos(a) * d, rot, { variant: 0, tol: 2.5 })) break;
    }
  }

  // --- причал снабжения (у маяка без посёлка): мостки, сарай, грузы; тропа к маяку — общей прокладкой дорог ---
  function landing(s, style, ctx, sea) {
    if (!sea) return;
    const [nx, nz] = seaNormal(sea.x, sea.z), rot = Math.atan2(nx, nz);
    ctx.put('jetty-small', sea.x, sea.z, rot, { params: { length: 12 } });
    const at = (back, side) => [sea.x - nx * back + nz * side, sea.z - nz * back - nx * side];
    ctx.put('shed', ...at(9, 6), rot, { tol: 2.5 });
    ctx.put('cargo', ...at(6, -4), rot + 0.3, { pad: 0.2, tol: 2.5 });
    ctx.put('boat-beached', ...at(3, -9), rot + 0.4, { minH: 0.2, pad: 0.2 });
  }

  // --- раскладка всех площадок ------------------------------------------------
  const islandOf = (x, z) => {
    const [x0, z0] = hf.bounds, i = Math.round((x - x0) / hf.step), j = Math.round((z - z0) / hf.step);
    return hf.owner[j * hf.size + i];
  };
  const placed = [];
  for (const s of hf.sites) {
    const style = bio.biomeAt(s.x, s.z) === 'none' ? 'atlantic' : bio.biomeAt(s.x, s.z);
    const ctx = batchCtx(s.name, style, seeded(hash(s.name)));
    const sea = seaward(s);
    if (s.type === 'lighthouse') lighthouse(s, style, ctx, sea);
    else if (s.type === 'village') village(s, style, ctx, sea);
    else if (s.type === 'landing') landing(s, style, ctx, sea);
    else town(s, style, ctx, sea);
    ctx.finish();
    placed.push({ ...s, style, island: islandOf(s.x, s.z) });
  }

  // дороги между поселениями острова: минимальное остовное дерево по расстоянию, путь — A*;
  // маяки — тропой к ближайшему поселению. Вдоль дорог между городами — телеграфные столбы
  const route = makeRouter(hf);
  const byIsland = new Map();
  for (const s of placed) if (s.island >= 0) (byIsland.get(s.island) ?? byIsland.set(s.island, []).get(s.island)).push(s);
  let roadKm = 0;
  for (const [isl, list] of byIsland) {
    const ctx = batchCtx(`дороги ${map.islands[isl].name ?? isl}`, list[0].style, seeded(isl * 977 + 13));
    const towns = list.filter((s) => s.type !== 'lighthouse'), edges = [];
    const inT = new Set(towns.length ? [towns[0]] : []);
    while (inT.size < towns.length) {
      let best = null;
      for (const p of inT) for (const q of towns) {
        if (inT.has(q)) continue;
        const d = Math.hypot(p.x - q.x, p.z - q.z);
        if (!best || d < best[2]) best = [p, q, d];
      }
      inT.add(best[1]);
      edges.push([best[0], best[1], 'road-dirt']);
    }
    for (const l of list.filter((s) => s.type === 'lighthouse')) {
      let best = null;
      for (const q of towns) { const d = Math.hypot(l.x - q.x, l.z - q.z); if (!best || d < best[1]) best = [q, d]; }
      if (best) edges.push([l, best[0], 'path']);
    }
    for (const [p, q, id] of edges) {
      const path = route(p.x, p.z, q.x, q.z);
      if (!path || path.length < 3) continue;
      // обрезка внутри площадок: там свои улицы
      const cut = path.filter(([x, z]) => Math.hypot(x - p.x, z - p.z) > p.r * 0.55 && Math.hypot(x - q.x, z - q.z) > q.r * 0.55);
      if (cut.length < 3) continue;
      const pts = chaikin(chaikin(cut));
      for (const run of ctx.road(id, pts)) {
        const P = polyline(run);
        roadKm += P.L / 1000;
        if (id !== 'road-dirt') continue;
        for (let u = 20; u < P.L - 10; u += 42) {
          const c = P.at(u);
          ctx.put('telegraph-pole', c.x - c.tz * 4.5, c.z + c.tx * 4.5, Math.atan2(c.tx, c.tz), { pad: 0, mark: 0.2, tol: 3 });
        }
      }
    }
    ctx.finish();
  }

  const buildings = Object.entries(counts).reduce((a, [id, n]) => a + (STRUCTURES[id].road ? 0 : n), 0);
  return { group, occ, counts, sites: placed, stats: { buildings, tris, roadKm, ms: performance.now() - t0 } };
}
