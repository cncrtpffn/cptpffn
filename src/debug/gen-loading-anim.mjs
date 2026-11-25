// Кадры компаса-троббера экрана загрузки: лодка делает полный круг вправо, истинный ветер гуляет ±15°.
// Гик — настоящий Sail.update (оверштаг через ДП, фордевинд с задержкой by-the-lee и перелётом),
// скорость лодки — установившаяся по поляре (runCase). Анимация идёт в CSS, на потоке композитора:
// она не встаёт, пока главный поток занят сборкой мира.
// Запуск из корня проекта (jsc — /System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc):
//   jsc -m src/debug/gen-loading-anim.mjs > src/ui/loading-anim.css
//   jsc -m src/debug/gen-loading-anim.mjs -- ticks   — разметка рисок картушки для index.html
import { BOAT, DEG } from '../config.js';
import { Sail } from '../physics/sail.js';
import { runCase } from './polar.js';
import { roseTicks } from '../ui/hud.js';

const out = (s) => (typeof print === 'function' ? print(s) : console.log(s));
const args = typeof arguments !== 'undefined' ? [...arguments] : [];

const LOOP = 25;     // с, длина петли: круг за 25 с (14°/с) — спокойная циркуляция, гик успевает, как в игре
const TWS = 7;       // м/с, как в start.json
const SHIFT = 15;    // °, размах захода ветра
const KEYS = 250;    // ключевых кадров на петлю (через 0.1 с: перелёт гика на фордевинде — около секунды)
const DT = 1 / 120;

if (args[0] === 'ticks') {
  out(roseTicks());
} else {
  // установившаяся скорость по TWA; носом к ветру — стоим
  const TWAS = [0, 20, 30, 45, 60, 75, 90, 110, 135, 150, 165, 180];
  const U = TWAS.map((twa) => (twa < 30 ? 0 : runCase({ tws: TWS, twa, duration: 60 }).speedKn / 1.944));
  U[1] = U[2] * 0.3; // 20° — парус полощет, лодка ещё катится
  const speedAt = (twaDeg) => {
    const a = Math.min(180, Math.abs(twaDeg));
    let i = 1;
    while (TWAS[i] < a) i++;
    const t = (a - TWAS[i - 1]) / (TWAS[i] - TWAS[i - 1]);
    return U[i - 1] + (U[i] - U[i - 1]) * t;
  };

  const sail = new Sail(BOAT);
  const steps = Math.round(LOOP / DT), every = steps / KEYS;
  const keys = [];
  // два круга на разгон, чтобы гик и галс замкнулись в петлю; пишется третий
  for (let i = 0; i < steps * 3; i++) {
    const ph = (i % steps) / steps;
    const psi = 2 * Math.PI * ph;                              // курс, рад (вправо)
    const dir = SHIFT * DEG * Math.sin(2 * Math.PI * ph);      // откуда дует истинный
    const twa = Math.atan2(Math.sin(dir - psi), Math.cos(dir - psi));
    const u = speedAt(twa / DEG);
    // как Wind.apparent при v = 0: воздух относительно лодки в её осях
    const ax = TWS * -Math.cos(twa) - u, ay = TWS * -Math.sin(twa);
    const awa = Math.atan2(-ay, -ax), aws = Math.hypot(ax, ay);
    // шкот на автотриме, как автопилот в main.js
    sail.sheet = Math.max(BOAT.sheetMin, Math.min(BOAT.sheetMax, Math.abs(awa) - 24 * DEG));
    sail.update(DT, awa, aws, 0, 0);
    if (i >= steps * 2 && (i - steps * 2) % every === 0) keys.push({ psi, twa, awa, boom: sail.boom });
  }

  // углы SVG/CSS (по часовой) как в Hud._updateRose: картушка −курс, стрелки по twa/awa, гик −boom.
  // Без перескоков через ±180°, иначе CSS-интерполяция крутит в обратную сторону
  const unwrap = (list) => {
    const r = [list[0]];
    for (let i = 1; i < list.length; i++) {
      let d = list[i] - list[i - 1];
      d -= 360 * Math.round(d / 360);
      r.push(r[i - 1] + d);
    }
    return r;
  };
  const tracks = {
    card: unwrap(keys.map((k) => -k.psi / DEG)),
    true: unwrap(keys.map((k) => k.twa / DEG)),
    app: unwrap(keys.map((k) => k.awa / DEG)),
    boom: unwrap(keys.map((k) => -k.boom / DEG)),
  };
  out('/* Сгенерировано src/debug/gen-loading-anim.mjs — не править руками.');
  out(`   Петля ${LOOP} с: круг вправо, истинный ветер ${TWS} м/с ±${SHIFT}°, гик по Sail.update. */`);
  for (const [name, a] of Object.entries(tracks)) {
    // замыкаем петлю: 100% — первый ключ плюс полные обороты за круг (картушка и стрелки −360°, гик 0)
    const end = a[0] + 360 * Math.round((a[a.length - 1] - a[0]) / 360);
    let s = `@keyframes ld-${name} {`;
    a.forEach((v, i) => { s += ` ${(i / KEYS * 100).toFixed(2)}%{transform:rotate(${v.toFixed(1)}deg)}`; });
    s += ` 100%{transform:rotate(${end.toFixed(1)}deg)} }`;
    out(s);
  }
}
