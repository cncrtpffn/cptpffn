// Запуск: jsc -m src/debug/run-assist.mjs  (из корня проекта)
// Ассистент (src/physics/assist.js) против ручной настройки: шкот |awa|−24°, рулевой на наветренной банке
import { polar, formatRows, runCase } from './polar.js';
const out = (s) => (typeof print === 'function' ? print(s) : console.log(s));
const f = (x, d = 1) => x.toFixed(d).padStart(6);
for (const tws of [4, 7, 10, 13, 16]) {
  out(`\n=== TWS ${tws} м/с: ассистент, полный ход ===`);
  const a = polar(tws, { assist: true }), m = polar(tws, { hike: false });
  out(formatRows(a));
  out('   twa   ручн  ассист  разн%  рифы');
  a.forEach((r, i) => {
    const h = m[i];
    out(`${f(r.twa, 0)}${h.capsizedAt >= 0 ? '  пер.' : f(h.speedKn)}${f(r.speedKn)}${h.speedKn > 0 ? f((r.speedKn / h.speedKn - 1) * 100) : '     —'}${f(r.reefs, 0)}`);
  });
}
out('\n=== Телеграф, TWS 7: полный / средний / стоп ===');
out('   twa   полн   сред   стоп');
for (const twa of [40, 60, 80, 100, 135]) {
  const s = [2, 1, 0].map((t) => runCase({ tws: 7, twa, assist: true, telegraph: t }).speedKn);
  out(`${f(twa, 0)}${s.map((x) => f(x)).join('')}`);
}
out('\n=== Порывы ±60% (база 9 м/с ≈ 6…14), 180 с ===');
out('   twa  speed maxHl  caps  рифы');
for (const twa of [35, 50, 75, 90, 120, 160]) {
  const r = runCase({ tws: 9, twa, assist: true, gusts: true, gustStrength: 0.6, duration: 180 });
  out(`${f(twa, 0)}${f(r.speedKn)}${f(r.maxHeelDeg)}${r.capsizedAt >= 0 ? f(r.capsizedAt) : '     -'}${f(r.reefs, 0)}`);
}
out('\n=== Каналы: шкот у игрока (|awa|−24° с травлением), остальное — ассистент, TWS 7 / 11 ===');
out('   twa  полн.асс  шкот-игр  разн%');
for (const tws of [7, 11]) for (const twa of [45, 90, 135]) {
  const a = runCase({ tws, twa, assist: true }).speedKn;
  const m = runCase({ tws, twa, assist: true, channels: { sheet: false } }).speedKn;
  out(`${f(twa, 0)}${f(a)}${f(m)}${f((m / a - 1) * 100)}   (${tws} м/с)`);
}
