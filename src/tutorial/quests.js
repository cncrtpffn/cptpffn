// Обучающие квесты: линейный курс «Школа шкипера» (уроки) и свободные миссии на демо-карте.
// Формат — src/tutorial/runner.js. Знаки — поле marks демо-карты (src/maps/demo.js) и навигационные
// знаки плана («вид@название»). Тексты — в ru: { … } (как в src/ui/glossary.js), задел на перевод.
// setup урока: старт (x, z, hdg °), ветер (speed м/с, dirDeg — откуда дует, gusts), рифы, шверт,
// assist — маска ассистента (src/physics/assist.js): true — канал ведёт ассистент, false — игрок.
// Ветер уроков с востока (90°): акватория вытянута по x, лавировка идёт вдоль неё.
// bot — подсказки боту прогона (src/debug/run-quests.mjs), игре не нужны.
import * as C from './conditions.js';

const ALL_AUTO = { sheet: true, board: true, crew: true, reef: true };

export const LESSONS = [
  {
    id: 'helm', kind: 'lesson',
    ru: {
      title: 'Руль и компас',
      intro: 'Парусами займётся авто-матрос, вам — только руль. Ведите лодку к жёлтым знакам: стрелка на компасе показывает, куда.',
    },
    setup: { x: 150, z: -20, hdg: 180, wind: { speed: 6, dirDeg: 90, gusts: false }, reefs: 0, board: 1, assist: ALL_AUTO },
    steps: [
      { ru: { task: 'Дойдите до южного знака', say: 'Руль ←/→ (на таче — слайдер внизу). Лодка поворачивает не сразу — подруливайте заранее.' },
        manual: '#boat', check: () => C.reach('sk-s', 10) },
      { ru: { task: 'Теперь к знаку у ворот', say: 'Жёлтая стрелка на краю компаса — направление на цель, под ним расстояние.' },
        manual: '#boat', check: () => C.reach('sk-g2', 10) },
      { ru: { task: 'И к западному знаку', say: 'Ветер теперь сзади: гик уходит далеко за борт, лодка идёт ровно.' },
        manual: '#courses', check: () => C.reach('sk-w', 10) },
    ],
  },
];

export const MISSIONS = [
  {
    id: 'lighthouse', kind: 'mission',
    ru: {
      title: 'Причал маяка',
      intro: 'Войдите в Маячную бухточку между красным и зелёным знаками и остановитесь у мостков причала.',
    },
    zone: { mark: 'ms-lh-zone', r: 25 },
    steps: [
      { ru: { task: 'Войдите в бухточку между знаками', say: 'Красный знак оставьте слева, зелёный — справа.' },
        manual: '#safety', check: () => C.gate('lateral-red@Маячная бухточка', 'lateral-green@Маячная бухточка') },
      { ru: { task: 'Остановитесь у мостков', say: 'Подойдите против ветра и потравите шкот (с авто-матросом — «стоп»): лодка встанет.' },
        manual: '#turns', bot: { stop: true }, check: () => C.stopNear('ms-lh-berth', 12, 0.3) },
    ],
  },
];

export const QUESTS = [...LESSONS, ...MISSIONS];
export const COURSE = LESSONS.map((q) => q.id);
