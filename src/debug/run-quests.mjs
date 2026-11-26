// Запуск: jsc -m src/debug/run-quests.mjs  (из корня проекта)
// Движок обучающих квестов: условия (src/tutorial/conditions.js), ход квеста (runner.js), прогресс (progress.js).
// Бот (quest-bot.js) проходит уроки; отдельные проверки — что условия не срабатывают зря.
import { Boat } from '../physics/boat.js';
import { Wind } from '../physics/wind.js';
import { Waves } from '../physics/waves.js';
import { createAssist } from '../physics/assist.js';
import { createTrimAdvisor } from '../physics/trim.js';
import { createObstacles } from '../physics/obstacles.js';
import { createQuestRunner } from '../tutorial/runner.js';
import { createProgress, PROGRESS_KEY } from '../tutorial/progress.js';
import * as C from '../tutorial/conditions.js';
import { createQuestBot } from './quest-bot.js';
import { DEG } from '../config.js';
export { simulate };

const out = (s) => (typeof print === 'function' ? print(s) : console.log(s));
const dt = 1 / 120;
let fails = 0;
const check = (ok, msg) => { out(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fails++; };

// Прогон квеста ботом. marks — { id: { x, z, kind? } }; start — { x, z, hdg (°) }; wind — { speed, dirDeg, gusts }.
// Подсказки бота в шаге (только для прогона): bot: { twa (°, знак — галс) | tacks: n | stop: true }
function simulate(quest, { marks, start, wind: w, maxTime = 900, assistMask = null, obstacles: useObs = true } = {}) {
  const wind = new Wind({ speed: w.speed, dirDeg: w.dirDeg ?? 0, gusts: !!w.gusts, gustStrength: w.gustStrength ?? 0.3, shiftDeg: w.gusts ? 12 : 0 });
  const waves = new Waves(); waves.configure(0, 0, w.speed);
  const boat = new Boat(); boat.reset(start.x, start.z, (start.hdg ?? 0) * DEG);
  const assist = createAssist();
  assist.setChannels(quest.setup?.assist ?? assistMask ?? {});
  const advisor = createTrimAdvisor();
  const obs = createObstacles();
  if (useObs) for (const [id, m] of Object.entries(marks)) if (m.kind !== 'point') obs.addCircle({ id, kind: 'mark', x: m.x, z: m.z, r: 0.9, mass: 30 });
  const mark = (id) => marks[id];
  const runner = createQuestRunner([quest]);
  const bot = createQuestBot();
  runner.start(quest.id, boat);
  let advice = null, t = 0, tackTimer = 0, tackSide = 1;
  const log = [];
  while (t < maxTime && runner.state === 'active') {
    const step = runner.step, hint = step.bot ?? {};
    const target = runner.target(boat, mark);
    // руль
    if (hint.tacks) {
      if ((tackTimer -= dt) <= 0) { tackSide = -tackSide; tackTimer = 14; }
      bot.force(tackSide * 45 * DEG);
    } else if (hint.twa !== undefined) bot.force(hint.twa * DEG);
    else bot.force(null);
    let psi = bot.heading(boat, wind, target);
    if (hint.stop && target && target.dist < 30) { psi = wind.dir; assist.telegraph = 0; }
    if (step.assist) assist.setChannels(step.assist);
    // каналы игрока — по формулам советчика
    const base = { rudderAngle: bot.rudder(boat, psi) };
    if (!assist.channels.sheet && advice) base.sheetAngle = hint.stop && target && target.dist < 30 ? boat.cfg.sheetMax : advice.sheet;
    if (!assist.channels.crew && advice) base.crewPos = advice.crewPos;
    if (!assist.channels.board && advice) base.board = Math.max(-1, Math.min(1, (advice.board - boat.board) / 0.05));
    if (!assist.channels.reef && advice && advice.reef !== boat.sail.reefTarget) boat.sail.setReef(advice.reef);
    wind.update(dt); waves.update(dt);
    boat.step(dt, assist.controls(dt, boat, wind, base), wind, waves, null, useObs ? obs : null);
    advice = advisor.update(dt, boat, wind);
    for (const e of runner.update(dt, { boat, wind, mark, advice, assist })) log.push(`${t.toFixed(1)}s ${e.type}${e.type === 'step' ? ' ' + e.step : ''}`);
    t += dt;
  }
  return { runner, boat, log, t };
}

// --- синтетический урок: ветер с севера, старт (0, 0) курсом на восток ---
const MARKS = {
  A: { x: 150, z: 0 }, G1: { x: 230, z: -12 }, G2: { x: 230, z: 12 },
  B: { x: 260, z: -170 }, C: { x: 120, z: -120 },
};
const LESSON = {
  id: 'test', kind: 'lesson', ru: { title: 'Тест' },
  steps: [
    { ru: { task: 'К знаку A' }, check: () => C.reach('A') },
    { ru: { task: '10 с галфвиндом' }, bot: { twa: 90 }, check: () => C.hold(C.pointOfSailIs('beam'), 10) },
    { ru: { task: 'Ворота' }, check: () => C.gate('G1', 'G2'), penalty: () => C.touched() },
    { ru: { task: 'Обогнуть B левым бортом' }, check: () => C.round('B', 'port') },
    { ru: { task: 'Два поворота оверштаг' }, bot: { tacks: true }, check: () => C.tacks(2) },
    { ru: { task: 'Стоп у C' }, bot: { stop: true }, check: () => C.stopNear('C') },
  ],
};
out('=== Синтетический урок ботом (ветер 7 м/с с севера, ассистент) ===');
let r = simulate(LESSON, { marks: MARKS, start: { x: 0, z: 0, hdg: 90 }, wind: { speed: 7 } });
out('  ' + r.log.join(' | '));
check(r.runner.state === 'done', `урок пройден (${r.runner.state}, шаг ${r.runner.stepIndex}, ${r.t.toFixed(0)} с)`);
if (r.runner.result) out(`  время ${r.runner.result.time.toFixed(1)} с, штрафов ${r.runner.result.penalties}`);

out('\n=== То же с порывами ±40% и шкотом у «игрока» ===');
r = simulate({ ...LESSON, id: 'test2' }, { marks: MARKS, start: { x: 0, z: 0, hdg: 90 }, wind: { speed: 9, gusts: true, gustStrength: 0.4 }, assistMask: { sheet: false } });
check(r.runner.state === 'done', `урок пройден (${r.runner.state}, шаг ${r.runner.stepIndex}, ${r.t.toFixed(0)} с)`);

// --- ложные срабатывания: короткий прогон с заданным курсом ---
function straight(cond, { x = 0, z = 0, hdg = 90, secs = 60, marks = MARKS } = {}) {
  const wind = new Wind({ speed: 7, dirDeg: 0, gusts: false, gustStrength: 0, shiftDeg: 0 });
  const waves = new Waves(); waves.configure(0, 0, 7);
  const boat = new Boat(); boat.reset(x, z, hdg * DEG);
  const assist = createAssist(), bot = createQuestBot();
  let done = false;
  for (let t = 0; t < secs && !done; t += dt) {
    wind.update(dt); waves.update(dt);
    boat.step(dt, assist.controls(dt, boat, wind, { rudderAngle: bot.rudder(boat, hdg * DEG) }), wind, waves, null);
    done = cond.update(dt, { boat, wind, mark: (id) => marks[id], advice: null, assist }).done;
  }
  return done;
}
out('\n=== Ложные срабатывания ===');
check(!straight(C.round('A', 'port'), { z: -5 }), 'проход мимо знака в 5 м по прямой — не обход');
check(!straight(C.round('A', 'starboard'), { z: 5 }), 'то же правым бортом');
check(!straight(C.gate('G2', 'G1'), { x: 180 }), 'ворота в обратную сторону — не засчитаны');
check(straight(C.gate('G1', 'G2'), { x: 180 }), 'ворота в нужную сторону — засчитаны');
check(!straight(C.gate('G1', 'G2'), { x: 180, z: 30 }), 'мимо ворот (за знаком) — не засчитаны');
check(!straight(C.reach('A', 10), { z: 15 }), 'проход в 15 м от знака при r 10 — не «дошли»');
check(!straight(C.stopNear('A'), { x: 60 }), 'проход мимо знака на ходу — не «остановились»');
check(!straight(C.tacks(1), {}), 'на прямом курсе поворотов нет');

// --- прогресс ---
out('\n=== Прогресс (заглушка хранилища) ===');
const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), m }; };
let st = mem();
let p = createProgress({ storage: st });
const order = ['l1', 'l2', 'l3'];
check(p.unlocked(order, 'l1') && !p.unlocked(order, 'l2'), 'открыт только первый урок');
p.started('l1'); p.started('l1');
check(p.record('l1', 120) === true, 'первое прохождение — рекорд');
check(p.record('l1', 150) === false && p.best('l1') === 120, 'медленнее — рекорд прежний');
check(p.entry('l1').tries === 3, `попыток ${p.entry('l1').tries} (2 старта + повтор)`);
p = createProgress({ storage: st, knownIds: order });
check(p.isDone('l1') && p.unlocked(order, 'l2') && !p.unlocked(order, 'l3'), 'после перезагрузки: l1 пройден, открыт l2');
st.setItem(PROGRESS_KEY, '{битый');
check(!createProgress({ storage: st }).isDone('l1'), 'битый JSON — начинаем с нуля без ошибки');
st.setItem(PROGRESS_KEY, JSON.stringify({ v: 99, done: { l1: { best: 5 } } }));
check(!createProgress({ storage: st }).isDone('l1'), 'чужая версия — сброс');
st.setItem(PROGRESS_KEY, JSON.stringify({ v: 1, done: { l1: { best: 5 }, old: { best: 7 } } }));
check(createProgress({ storage: st, knownIds: order }).best('old') === null, 'незнакомый id отброшен');
const throwing = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
p = createProgress({ storage: throwing });
p.record('l1', 10);
check(p.isDone('l1'), 'хранилище бросает исключения — прогресс в памяти');
st = mem();
p = createProgress({ storage: st, unlockAll: true });
p.record('l1', 10);
check(p.unlocked(order, 'l3') && !st.m.size, '?quests=all: всё открыто, ничего не записано');
p = createProgress({ storage: st }); p.record('l1', 10); p.reset();
check(!createProgress({ storage: st }).isDone('l1'), 'сброс прогресса сохраняется');

out(fails ? `\n${fails} проверок не прошло` : '\nвсё ок');
