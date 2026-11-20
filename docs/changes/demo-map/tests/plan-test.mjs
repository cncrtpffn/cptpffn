globalThis.performance ??= { now: () => Date.now() };
import { buildHeightfield } from '/Users/jim/claude_test_projects/ClaudeFableGameTest/src/scene/terrain/heightfield.js';
import { maxGrade, resample } from '/Users/jim/claude_test_projects/ClaudeFableGameTest/src/scene/terrain/geom.js';
import { planSettlements } from '/Users/jim/claude_test_projects/ClaudeFableGameTest/src/scene/terrain/settlement-plan.js';
import { DEMO } from '/Users/jim/claude_test_projects/ClaudeFableGameTest/src/maps/demo.js';
import { ARCHIPELAGO } from '/Users/jim/claude_test_projects/ClaudeFableGameTest/src/maps/archipelago.js';
const FP = { church: [16, 22.5], 'town-hall': [14.5, 14.5], customs: [10.5, 14], market: [13, 7], tavern: [9.5, 10], warehouse: [16.5, 20.4], 'pilot-station': [5, 5], chapel: [6, 11.5] };
const footprint = (id) => ({ w: FP[id][0], d: FP[id][1] });
const MAP = globalThis.MAPNAME === 'arch' ? ARCHIPELAGO : DEMO;
const hf = buildHeightfield(MAP);
const W = hf.size, st = hf.step, [x0, z0] = hf.bounds;
const idx = (x, z) => Math.min(W - 1, Math.max(0, Math.round((z - z0) / st))) * W + Math.min(W - 1, Math.max(0, Math.round((x - x0) / st)));
const bio = { biomeAt: (x, z) => MAP.islands[hf.owner[idx(x, z)]]?.biome ?? 'none', zoneAt: () => 'scrub', zone: null };
const plan = planSettlements(hf, bio, MAP, { footprint });
print('план', plan.ms.toFixed(0), 'мс');
const errs = [];
for (const p of plan.sites) {
  if (p.type === 'lighthouse' || p.type === 'landing') { print(p.type, p.name, 'берт', p.berths.length); continue; }
  const cls = {}; let wet = 0, outside = 0;
  for (const l of p.streets) {
    cls[l.cls] = (cls[l.cls] ?? 0) + 1;
    for (const [x, z] of l.pts) { if (hf.sample(x, z) < 0) wet++; const k = idx(x, z); if (!['ring', 'track', 'ramp'].includes(l.cls) && plan.siteOf[k] !== plan.sites.indexOf(p)) outside++; }
  }
  const L = p.streets.reduce((a, l) => a + l.pts.slice(1).reduce((s, q, i) => s + Math.hypot(q[0] - l.pts[i][0], q[1] - l.pts[i][1]), 0), 0);
  print(`${p.type} ${p.name}: ${p.style}, поле ${p.field}, уклон ${p.avgSlope.toFixed(2)}, площадь ${(p.area / 1e4).toFixed(2)} га, улицы ${JSON.stringify(cls)} ${L.toFixed(0)} м, точек в воде ${wet}, вне границы ${outside}, площадь ${p.plaza ? 'да' : 'НЕТ'}, резервы ${p.reserves.map((r) => r.id).join(',')}, причалы ${p.berths.map((b) => b.kind + ':' + b.depth.toFixed(1)).join(',')}`);
  if ((p.type === 'port' || p.type === 'town') && (!p.plaza || !p.reserves.some((r) => r.id === 'church'))) errs.push(p.name + ': нет площади или церкви');

  // --- эксперимент: сеть улиц ---
  const FOOT = new Set(['stairs', 'path']);
  const js = p.junctions ?? [], nT = js.filter((j) => j.type === 'T').length, nR = js.filter((j) => j.angle >= 80).length;
  let vmax = 0;
  for (const l of p.streets) if (!FOOT.has(l.cls)) vmax = Math.max(vmax, maxGrade(hf.sample, l.pts));
  // периметры: клетки границ зон (без кромки воды) в пределах 6 м от улицы
  const cov = new Uint8Array(W * W), R6 = Math.ceil(6 / st);
  for (const l of p.streets) for (const [x, z] of resample(l.pts, 2)) {
    const ci = Math.round((x - x0) / st), cj = Math.round((z - z0) / st);
    for (let dj = -R6; dj <= R6; dj++) for (let di = -R6; di <= R6; di++) if (di * di + dj * dj <= R6 * R6) { const i = ci + di, j = cj + dj; if (i >= 0 && j >= 0 && i < W && j < W) cov[j * W + i] = 1; }
  }
  const RR = p.r * 1.7 * 1.2;
  let bnd = 0, bc = 0;
  // дыры (нулевая зона, недостижимая от края окна) — не границы
  const wi0 = Math.round((p.x - RR - x0) / st), wj0 = Math.round((p.z - RR - z0) / st), wn = Math.round(2 * RR / st);
  const outW = new Uint8Array((wn + 1) * (wn + 1)), stk = [];
  for (let t = 0; t <= wn; t++) stk.push([t, 0], [t, wn], [0, t], [wn, t]);
  while (stk.length) { const [a, b] = stk.pop(); if (a < 0 || b < 0 || a > wn || b > wn || outW[b * (wn + 1) + a]) continue; const k = (wj0 + b) * W + wi0 + a; if (plan.zone[k]) continue; outW[b * (wn + 1) + a] = 1; stk.push([a + 1, b], [a - 1, b], [a, b + 1], [a, b - 1]); }
  const isHole = (k) => { const a = (k % W) - wi0, b = ((k / W) | 0) - wj0; return !plan.zone[k] && a >= 0 && b >= 0 && a <= wn && b <= wn && !outW[b * (wn + 1) + a]; };
  for (let dz = -RR; dz <= RR; dz += st) for (let dx = -RR; dx <= RR; dx += st) {
    const k = idx(p.x + dx, p.z + dz), zk = plan.zone[k];
    if (!zk || (plan.siteOf[k] >= 0 && plan.siteOf[k] !== plan.sites.indexOf(p))) continue;
    if (![1, -1, W, -W].some((n) => plan.zone[k + n] !== zk && !isHole(k + n))) continue;
    let wet = false;
    for (let a = 0; a < 8 && !wet; a++) if (hf.sample(p.x + dx + Math.cos(a * 0.785) * 10, p.z + dz + Math.sin(a * 0.785) * 10) < 0.7) wet = true;
    if (wet) continue;
    bnd++; bc += cov[k];
  }
  const share = bnd ? bc / bnd : 1;
  print(`   перекрёстков ${js.length}: T ${nT}, X ${js.length - nT}, прямых ${nR} (${(100 * nR / Math.max(1, js.length)).toFixed(0)} %); макс. уклон проезжих ${vmax.toFixed(3)}; срез до ${(p.cut ?? 0).toFixed(1)} м; периметры ${(100 * share).toFixed(0)} %; полосы проезжие ${p.vehicleBands}/${p.bands}`);
  if ((p.type === 'port' || p.type === 'town') && js.length && nT < 0.4 * js.length) errs.push(p.name + ': мало T');
  if (js.length >= 5 && nR > 0.2 * js.length) errs.push(p.name + ': прямых углов ' + nR + '/' + js.length);
  if (vmax > 0.16) errs.push(p.name + ': уклон ' + vmax.toFixed(3));
  if (share < 0.9) errs.push(p.name + ': периметры ' + (100 * share).toFixed(0) + ' %');
  // резервы не пересекаются
  for (let a = 0; a < p.reserves.length; a++) for (let b = a + 1; b < p.reserves.length; b++) { const A = p.reserves[a], B = p.reserves[b]; if (Math.hypot(A.x - B.x, A.z - B.z) < Math.min(A.w, A.d, B.w, B.d) / 2) errs.push(p.name + ': резервы ' + A.id + '/' + B.id); }
}
print('дороги', plan.roads.map((r) => `${r.kind} ${r.from}→${r.to} ${r.L.toFixed(0)} м${r.cut !== undefined ? ` срез ${r.cut.toFixed(1)} уклон ${maxGrade(hf.sample, r.pts).toFixed(3)}` : ''}${r.segs ? ` лестниц ${r.segs.filter((q) => q.cls === 'stairs').length}` : ''}`).join('; '));
for (const r of plan.roads) {
  if (r.kind !== 'path' && !r.segs && maxGrade(hf.sample, r.pts) > 0.16) errs.push('дорога круто: ' + r.from + '→' + r.to);
  for (const q of r.segs ?? []) if (q.cls !== 'stairs' && maxGrade(hf.sample, q.pts) > (q.cls === 'path' ? 0.26 : 0.16)) errs.push('тропа круто без лестницы: ' + r.from + '→' + r.to);
}
for (const m of plan.marks) { const h = hf.sample(m.x, m.z); print('знак', m.kind, m.name, m.x.toFixed(0), m.z.toFixed(0), 'глубина', (-h).toFixed(1)); if (m.kind !== 'isolated' && h > -3) errs.push('мелко: ' + m.kind + ' ' + m.name); }
print(errs.length ? 'ОШИБКИ:\n' + errs.join('\n') : 'проверки пройдены');

// названные места и вторые связи
{ const named = new Set(plan.roads.map((r) => r.to));
  for (const n of [...(MAP.beaches ?? []), ...(MAP.bays ?? []), ...(MAP.biomeRegions ?? [])].map((q) => q.name)) print('место', n, named.has(n) ? 'путь: ' + plan.roads.filter((r) => r.to === n).map((r) => r.kind + ' от ' + r.from + ' ' + r.L.toFixed(0) + ' м').join(', ') : 'без пути (уже рядом, вне островов с посёлком или недоступно)');
  const pairs = {};
  for (const r of plan.roads) if (r.kind !== 'path' || plan.sites.find((p) => p.name === r.to)?.type !== 'lighthouse') { const k = [r.from, r.to].sort().join('—'); (pairs[k] ??= new Set()).add(r.kind); }
  for (const [k, v] of Object.entries(pairs)) if (plan.sites.find((p) => p.name === k.split('—')[1])) print('связь', k, [...v].join('+'));
}
