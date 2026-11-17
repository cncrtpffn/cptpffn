// Запуск: jsc -m src/debug/run-polar.mjs  (из корня проекта)
import { polar, formatRows, runCase } from './polar.js';
const out = (s) => (typeof print === 'function' ? print(s) : console.log(s));
for (const tws of [4, 7, 10, 13]) {
  out(`\n=== TWS ${tws} м/с, без рифов, шверт опущен, откренивание ===`);
  out(formatRows(polar(tws)));
}
out('\n=== TWS 10, шверт поднят ===');
out(formatRows(polar(10, { board: 0 })));
out('\n=== TWS 16, без рифов, экипаж в центре ===');
out(formatRows(polar(16, { hike: false })));
out('\n=== TWS 16, 2 рифа, откренивание ===');
out(formatRows(polar(16, { reefs: 2 })));
out('\n=== TWS 7, шкот потравлен полностью (88°) на разных курсах ===');
out(formatRows(polar(7, { sheet: 88 })));
out('\n=== TWS 7, шкот выбран в доску (8°) ===');
out(formatRows(polar(7, { sheet: 8 })));
