// Запуск: jsc -m src/debug/run-reef-table.mjs  (из корня проекта)
// Пороги рифов «безопасно» (BOAT.reefTws.safe в config.js): бейдевинд 45°, шкот |awa|−24°, откренка,
// при крене шкот травится, как у ассистента (ease). Для каждой ступени рифов — наибольший ветер, при котором
// средний крен ≤ HEEL_SAFE (= HEEL_EASE: выше шкот травится постоянно), а в порывах ±30% максимальный ≤ HEEL_MAX
// (ниже «паники» ассистента 38°) и лодка не переворачивается.
import { runCase } from './polar.js';
const out = (s) => (typeof print === 'function' ? print(s) : console.log(s));
const f = (x, d = 1) => x.toFixed(d).padStart(6);
const HEEL_SAFE = 24, HEEL_MAX = 35, TWA = 45;

const limits = [];
for (const reefs of [0, 1, 2]) {
  out(`\n=== ${reefs} риф(а), twa ${TWA}° ===`);
  out('   tws   heel  gustMax  speed');
  let last = 0;
  for (let tws = 6; tws <= 24; tws += 0.5) {
    const r = runCase({ tws, twa: TWA, reefs, duration: 60, ease: true });
    const g = runCase({ tws, twa: TWA, reefs, duration: 120, gusts: true, gustStrength: 0.3, ease: true });
    const gMax = g.capsizedAt >= 0 ? 99 : g.maxHeelDeg;
    out(`${f(tws)}${f(r.heelDeg)}${f(gMax).padStart(9)}${f(r.speedKn)}`);
    if (r.capsizedAt >= 0 || r.heelDeg > HEEL_SAFE || gMax > HEEL_MAX) break;
    last = tws;
  }
  limits.push(last);
}
out(`\nreefTws.safe: [${limits.join(', ')}]  — до этого ветра (м/с) хватает ступени 0 / 1 / 2`);
