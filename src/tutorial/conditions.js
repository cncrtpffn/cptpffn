// Условия шагов обучающих квестов. Без three и DOM: тестируется в jsc (src/debug/run-quests.mjs).
// Условие — фабрика: создаёт объект { update(dt, ctx) → { done, progress?, target?, fail? }, reset() }.
// ctx = { boat, wind, mark(id) → { x, z } | null, advice (src/physics/trim.js) | null, assist | null }.
// «Защёлкивающиеся» условия (дойти, обогнуть, сделать повороты) после выполнения остаются done;
// мгновенные (курс, крен, скорость) — только пока выполняются: их держат через hold().
import { DEG } from '../config.js';
import { pointOfSail } from '../physics/trim.js';

const RES = { done: false, progress: 0, target: null, fail: '' };
const res = (done, progress = done ? 1 : 0, target = null, fail = '') => ({ ...RES, done, progress, target, fail });
const latch = (fn) => {
  let ok = false;
  return { update(dt, ctx) { if (ok) return res(true); const r = fn(dt, ctx); ok = r.done; return r; }, reset() { ok = false; fn.reset?.(); } };
};
const dist = (b, m) => Math.hypot(b.x - m.x, b.z - m.z);
const instant = (pred) => ({ update: (dt, ctx) => res(!!pred(ctx)), reset() {} });

// дойти до знака: центр лодки ближе r
export function reach(id, r = 10) {
  return latch((dt, ctx) => {
    const m = ctx.mark(id), d = dist(ctx.boat, m);
    return res(d < r, 0, { marks: [id], x: m.x, z: m.z });
  });
}

// пройти ворота между знаками a (слева) и b (справа): центр лодки пересекает отрезок ab в нужную сторону
export function gate(a, b) {
  let prev = null;
  const fn = (dt, ctx) => {
    const A = ctx.mark(a), B = ctx.mark(b), p = ctx.boat;
    const ex = B.x - A.x, ez = B.z - A.z, L2 = ex * ex + ez * ez;
    const cross = ex * (p.z - A.z) - ez * (p.x - A.x);
    const t = ((p.x - A.x) * ex + (p.z - A.z) * ez) / L2;
    const crossed = prev !== null && prev > 0 && cross <= 0 && t > -0.05 && t < 1.05;
    prev = cross;
    return res(crossed, 0, { marks: [a, b], x: (A.x + B.x) / 2, z: (A.z + B.z) / 2, gate: [a, b] });
  };
  fn.reset = () => { prev = null; };
  return latch(fn);
}

// обогнуть знак: side 'port' — знак слева (обход против часовой стрелки на карте), 'starboard' — справа.
// Пока лодка ближе r, копятся угол вокруг знака (нужно deg, по умолчанию 160°) и поворот лодки в ту же
// сторону (нужно turn, 60°): прямой проход мимо знака заметает до ~170°, но курс не меняет
// clear — с какого расстояния обходить (подсказка боту прогона, для острова больше знака)
export function round(id, side = 'port', { r = 40, deg = 160, turn = 60, clear } = {}) {
  let prevA = null, prevPsi = 0, acc = 0, yaw = 0;
  const sgn = side === 'port' ? -1 : 1; // x — восток, z — юг: atan2(dz, dx) и курс растут по часовой на карте
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const fn = (dt, ctx) => {
    const m = ctx.mark(id), b = ctx.boat;
    const target = { marks: [id], x: m.x, z: m.z, round: side, clear };
    const progress = () => Math.max(0, Math.min(1, Math.min(acc / (deg * DEG), yaw / (turn * DEG))));
    if (dist(b, m) > r) { prevA = null; acc = 0; yaw = 0; return res(false, 0, target); }
    const a = Math.atan2(b.z - m.z, b.x - m.x);
    if (prevA !== null) { acc += sgn * wrap(a - prevA); yaw += sgn * wrap(b.psi - prevPsi); }
    prevA = a; prevPsi = b.psi;
    return res(acc >= deg * DEG && yaw >= turn * DEG, progress(), target);
  };
  fn.reset = () => { prevA = null; acc = 0; yaw = 0; };
  return latch(fn);
}

// курс к ветру: 'beat' бейдевинд, 'beam' галфвинд, 'broad' бакштаг, 'run' фордевинд (с гистерезисом, как в HUD)
const POINT_IDX = { irons: 0, beat: 1, beam: 2, broad: 3, run: 4 };
export function pointOfSailIs(kind) {
  let prev = -1;
  return {
    update(dt, ctx) { prev = pointOfSail(Math.abs(ctx.boat.aw.twa) / DEG, prev); return res(prev === POINT_IDX[kind]); },
    reset() { prev = -1; },
  };
}

// условие держится secs секунд подряд; короткий провал (до grace) не сбрасывает счёт
export function hold(cond, secs, grace = 0.7) {
  let t = 0, gap = 0, ok = false;
  return {
    update(dt, ctx) {
      if (ok) return res(true);
      const r = cond.update(dt, ctx);
      if (r.done) { t += dt; gap = 0; } else if ((gap += dt) > grace) t = 0;
      ok = t >= secs;
      return res(ok, Math.min(1, t / secs), r.target);
    },
    reset() { t = gap = 0; ok = false; cond.reset(); },
  };
}

// повороты: n штук с начала шага ('tack' — оверштаг, 'gybe' — фордевинд)
function maneuvers(type, n) {
  let start = null, got = 0;
  return {
    update(dt, ctx) {
      const m = ctx.boat.maneuver;
      if (start === null) start = m.count;
      if (m.count !== start) { if (m.type === type) got++; start = m.count; }
      return res(got >= n, Math.min(1, got / n));
    },
    reset() { start = null; got = 0; },
  };
}
export const tacks = (n = 1) => maneuvers('tack', n);
export const gybes = (n = 1) => maneuvers('gybe', n);

// рифы взяты: цель и само положение паруса не меньше n
export const reefed = (n = 1) => instant(({ boat }) => Math.min(2, boat.sail.reefTarget) >= n && boat.sail.reefLevel >= n - 0.01);
// остановиться у знака: ближе r и медленнее v, м/с (0.5 м/с ≈ 1 уз: носом к ветру лодка гасит ход ~30 с)
export function stopNear(id, r = 25, v = 0.5) {
  return latch((dt, ctx) => {
    const m = ctx.mark(id), b = ctx.boat;
    return res(dist(b, m) < r && b.speed < v, 0, { marks: [id], x: m.x, z: m.z });
  });
}
export const heelBelow = (deg) => instant(({ boat }) => Math.abs(boat.phi) < deg * DEG);
export const speedAbove = (kn) => instant(({ boat }) => boat.u * 1.944 > kn);
export const speedBelow = (kn) => instant(({ boat }) => boat.speed * 1.944 < kn);
export const boardBelow = (f) => instant(({ boat }) => boat.board < f);
export const boardAbove = (f) => instant(({ boat }) => boat.board > f);
export const telegraphIs = (t) => instant(({ assist }) => !!assist && assist.telegraph === t);
// канал настроен по советчику: шкот в пределах tol° от оптимума, экипаж там, где советует советчик
export function trimmed(ch, tol = 5) {
  return instant(({ boat, advice }) => {
    if (!advice) return false;
    if (ch === 'sheet') return Math.abs(boat.sail.sheet - advice.sheet) < tol * DEG && boat.sail.status !== 'luff';
    if (ch === 'crew') return boat.crewPos === advice.crewPos;
    if (ch === 'board') return Math.abs(boat.board - advice.board) < 0.15;
    return false;
  });
}

// все условия выполнены одновременно (защёлкнутые остаются выполненными)
export function all(...cs) {
  return {
    update(dt, ctx) {
      const rs = cs.map((c) => c.update(dt, ctx));
      return res(rs.every((r) => r.done), rs.reduce((a, r) => a + r.progress, 0) / rs.length, rs.find((r) => !r.done && r.target)?.target ?? null);
    },
    reset() { cs.forEach((c) => c.reset()); },
  };
}
export function any(...cs) {
  return {
    update(dt, ctx) {
      const rs = cs.map((c) => c.update(dt, ctx));
      return res(rs.some((r) => r.done), Math.max(...rs.map((r) => r.progress)), rs.find((r) => r.target)?.target ?? null);
    },
    reset() { cs.forEach((c) => c.reset()); },
  };
}
// по очереди: следующее условие начинает считаться, когда выполнено предыдущее
export function seq(...cs) {
  let i = 0;
  return {
    update(dt, ctx) {
      while (i < cs.length) {
        const r = cs[i].update(dt, ctx);
        if (!r.done) return res(false, (i + r.progress) / cs.length, r.target);
        i++;
      }
      return res(true);
    },
    reset() { i = 0; cs.forEach((c) => c.reset()); },
  };
}

// касание знака (или любого знака kind 'mark', если id не задан): срабатывает на каждое новое касание
export function touched(id) {
  let seen = null;
  return {
    update(dt, { boat }) {
      const k = boat.contact;
      if (seen === null) seen = k.count;
      const hit = k.count !== seen && (id ? k.id === id : k.kind === 'mark');
      seen = k.count;
      return res(hit);
    },
    reset() { seen = null; },
  };
}
