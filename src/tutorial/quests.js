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
        manual: '#boat', highlight: 'rudder', check: () => C.reach('sk-s', 10) },
      { ru: { task: 'Теперь к знаку у ворот', say: 'Жёлтый треугольник на краю компаса — направление на цель, под приборами — расстояние.' },
        manual: '#boat', check: () => C.reach('sk-g2', 10) },
      { ru: { task: 'И к западному знаку', say: 'Ветер теперь сзади: гик уходит далеко за борт, лодка идёт ровно.' },
        manual: '#courses', check: () => C.reach('sk-w', 10) },
    ],
  },
  {
    id: 'courses', kind: 'lesson',
    ru: {
      title: 'Курсы к ветру',
      intro: 'Курс к ветру — угол между носом и направлением, откуда дует ветер. Пройдите тремя главными курсами.',
    },
    setup: { x: 40, z: 70, hdg: 0, wind: { speed: 6, dirDeg: 90, gusts: false }, reefs: 0, board: 1, assist: ALL_AUTO },
    steps: [
      { ru: { task: 'Идите галфвиндом 10 секунд', say: 'Галфвинд — ветер точно в борт. Название курса и угол видны внизу панели.' },
        manual: '#courses', bot: { twa: 90 }, check: () => C.hold(C.pointOfSailIs('beam'), 10) },
      { ru: { task: 'Приведитесь в бейдевинд на 10 секунд', say: 'Поверните нос ближе к ветру (к синей стрелке). Острее 45° парус заполощет — это левентик.' },
        manual: '#upwind', bot: { twa: 52 }, check: () => C.hold(C.pointOfSailIs('beat'), 10) },
      { ru: { task: 'Уваливайтесь в бакштаг на 10 секунд', say: 'Отверните нос от ветра: ветер дует сзади-сбоку, это самый быстрый курс.' },
        manual: '#courses', bot: { twa: -130 }, check: () => C.hold(C.pointOfSailIs('broad'), 10) },
    ],
  },
  {
    id: 'speed', kind: 'lesson',
    ru: {
      title: 'Ход и остановка',
      intro: 'Авто-матрос держит ход по «телеграфу»: стоп, средний, полный. Остановить лодку можно только на остром курсе.',
    },
    setup: { x: 20, z: 70, hdg: 0, wind: { speed: 6, dirDeg: 90, gusts: false }, reefs: 0, board: 1, assist: ALL_AUTO },
    steps: [
      { ru: { task: 'Сбавьте ход до среднего', say: '↓ (на таче — слайдер «ход» вниз). Матрос потравит шкот, лодка пойдёт медленнее.' },
        manual: '#trim', highlight: 'telegraph', bot: { telegraph: 1 }, check: () => C.hold(C.telegraphIs(1), 2) },
      { ru: { task: 'Снова полный ход', say: '↑ — матрос выберет шкот до лучшего угла.' },
        manual: '#trim', highlight: 'telegraph', bot: { telegraph: 2 }, check: () => C.hold(C.telegraphIs(2), 2) },
      { ru: { task: 'Остановитесь у северного знака', say: 'Приведитесь носом к ветру метров за 40 до знака и дайте «стоп»: парус заполощет, лодка встанет (меньше 1 узла).' },
        manual: '#turns', highlight: 'telegraph', bot: { stop: true }, check: () => C.stopNear('sk-n') },
    ],
  },
  {
    id: 'tack', kind: 'lesson',
    ru: {
      title: 'Поворот оверштаг',
      intro: 'Прямо против ветра парус не тянет. К цели на ветре идут галсами, поворачивая носом через ветер.',
    },
    setup: { x: 0, z: 25, hdg: 45, wind: { speed: 6, dirDeg: 90, gusts: false }, reefs: 0, board: 1, assist: ALL_AUTO },
    steps: [
      { ru: { task: 'Сделайте поворот оверштаг', say: 'Уверенно положите руль к ветру и держите: нос пройдёт через ветер, гик перейдёт на другой борт.' },
        manual: '#turns', highlight: 'rudder', bot: { tacks: true }, check: () => C.tacks(1) },
      { ru: { task: 'И обратно — ещё один поворот', say: 'Поворачивайте на хорошем ходу: медленная лодка застревает в левентике.' },
        manual: '#turns', bot: { tacks: true }, check: () => C.tacks(1) },
      { ru: { task: 'Лавировкой дойдите до наветренного знака', say: 'Идите бейдевиндом и поворачивайте, когда знак окажется сбоку под 90° — на «лэйлайне».' },
        manual: '#upwind', check: () => C.reach('sk-e', 12) },
    ],
  },
  {
    id: 'gybe', kind: 'lesson',
    ru: {
      title: 'Поворот фордевинд',
      intro: 'По ветру поворачивают кормой через ветер. Гик перелетает резко — поворачивайте плавно.',
    },
    setup: { x: 280, z: 25, hdg: 250, wind: { speed: 6, dirDeg: 90, gusts: false }, reefs: 0, board: 1, assist: ALL_AUTO },
    steps: [
      { ru: { task: 'Сделайте поворот фордевинд', say: 'Уваливайтесь, пока ветер не окажется точно сзади, и чуть дальше: гик перейдёт на другой борт.' },
        manual: '#turns', highlight: 'rudder', bot: { zigzag: 160 }, check: () => C.gybes(1) },
      { ru: { task: 'Ещё один фордевинд', say: 'После перехода гика сразу одерживайте рулём, иначе лодку развернёт к ветру.' },
        manual: '#turns', bot: { zigzag: 160 }, check: () => C.gybes(1) },
      { ru: { task: 'Обогните западный знак, оставляя его слева', say: 'Подходите по ветру, у знака плавно приводитесь — выйдете на острый курс.' },
        manual: '#courses', check: () => C.round('sk-w', 'port'), penalty: () => C.touched() },
    ],
  },
  {
    id: 'sheet', kind: 'lesson',
    ru: {
      title: 'Шкот',
      intro: 'Теперь шкот ваш, остальное — на матросе. Правило: травите, пока парус не заполощет, и чуть выберите обратно.',
    },
    setup: { x: 20, z: 75, hdg: 0, wind: { speed: 6, dirDeg: 90, gusts: false }, reefs: 0, board: 1, assist: { ...ALL_AUTO, sheet: false } },
    steps: [
      { ru: { task: 'Настройте шкот на галфвинде', say: '↑ выбрать, ↓ травить. Зелёная риска на шкале — лучший угол гика.' },
        manual: '#trim', highlight: 'sheet', bot: { twa: 90 }, check: () => C.hold(C.all(C.pointOfSailIs('beam'), C.trimmed('sheet')), 5) },
      { ru: { task: 'Уваливайтесь в бакштаг и потравите шкот', say: 'Чем полнее курс, тем дальше гик за бортом.' },
        manual: '#trim', highlight: 'sheet', bot: { twa: -130 }, check: () => C.hold(C.all(C.pointOfSailIs('broad'), C.trimmed('sheet')), 5) },
      { ru: { task: 'Приведитесь в бейдевинд и выберите шкот', say: 'На остром курсе гик почти над кормой. Перебрали — лодка кренится и тормозит.' },
        manual: '#trim', highlight: 'sheet', bot: { twa: 52 }, check: () => C.hold(C.all(C.pointOfSailIs('beat'), C.trimmed('sheet')), 5) },
    ],
  },
  {
    id: 'balance', kind: 'lesson',
    ru: {
      title: 'Откренка и шверт',
      intro: 'Ветер посвежел. Рулевой и шверт — ваши: откренивайте на крене, поднимайте шверт на полных курсах.',
    },
    setup: { x: 0, z: 70, hdg: 30, wind: { speed: 9, dirDeg: 90, gusts: false }, reefs: 0, board: 1, assist: { ...ALL_AUTO, crew: false, board: false } },
    steps: [
      { ru: { task: 'Бейдевинд с откренкой — 10 секунд', say: 'Крен больше 18° — выходите на откренку (Z / X / C, на таче — ◀ ⇄ ▶). Зелёная риска у «Экипажа» — где сидеть.' },
        manual: '#heel', highlight: 'crew', bot: { twa: 52 }, check: () => C.hold(C.all(C.pointOfSailIs('beat'), C.trimmed('crew'), C.heelBelow(28)), 10) },
      { ru: { task: 'Уваливайтесь и поднимите шверт', say: 'На полном курсе сноса нет, а опущенный шверт тормозит. Шверт — Q / E.' },
        manual: '#foils', highlight: 'board', bot: { twa: -150 }, check: () => C.hold(C.all(C.any(C.pointOfSailIs('broad'), C.pointOfSailIs('run')), C.boardBelow(0.5)), 5) },
      { ru: { task: 'Приведитесь и опустите шверт', say: 'На остром курсе без шверта лодку сносит боком.' },
        manual: '#foils', highlight: 'board', bot: { twa: 52 }, check: () => C.hold(C.all(C.pointOfSailIs('beat'), C.boardAbove(0.9)), 5) },
    ],
  },
  {
    id: 'reef', kind: 'lesson',
    ru: {
      title: 'Рифы',
      intro: 'Свежий ветер с порывами, и всё управление ваше. Уменьшите парус, пока лодку не положило.',
    },
    setup: { x: 0, z: 60, hdg: 0, wind: { speed: 12, dirDeg: 90, gusts: true, gustStrength: 0.3 }, reefs: 0, board: 1, assist: false },
    steps: [
      { ru: { task: 'Возьмите риф', say: 'R (на таче — «+» у рифов). Пока риф берётся, потравите шкот, чтобы не лечь.' },
        manual: '#heel', highlight: 'reef', bot: { twa: 90 }, check: () => C.reefed(1) },
      { ru: { task: 'Дойдите до северного знака', say: 'В порыв травите шкот, после — выбирайте. Крен держите откренкой.' },
        manual: '#heel', check: () => C.reach('sk-n', 12) },
    ],
  },
  {
    id: 'exam', kind: 'lesson',
    ru: {
      title: 'Экзамен',
      intro: 'Всё сами, без матроса: старт в воротах, обход двух знаков, финиш в тех же воротах. Касание знака — 10 секунд штрафа.',
    },
    setup: { x: -10, z: 40, hdg: 60, wind: { speed: 7, dirDeg: 90, gusts: true, gustStrength: 0.25 }, reefs: 0, board: 1, assist: false },
    steps: [
      { ru: { task: 'Старт: пройдите ворота на восток', say: 'Ворота — два жёлтых знака. Время уже идёт.' },
        manual: '#upwind', check: () => C.gate('sk-g1', 'sk-g2'), penalty: () => C.touched() },
      { ru: { task: 'Обогните наветренный знак, оставляя его слева', say: 'Лавировка к восточному знаку.' },
        manual: '#upwind', check: () => C.round('sk-e', 'port'), penalty: () => C.touched() },
      { ru: { task: 'Обогните южный знак, оставляя его справа', say: 'Бакштаг: потравите шкот и поднимите шверт.' },
        manual: '#courses', check: () => C.round('sk-s', 'starboard'), penalty: () => C.touched() },
      { ru: { task: 'Финиш: ворота на запад', say: 'Последний отрезок — полным курсом к воротам.' },
        manual: '#courses', check: () => C.gate('sk-g2', 'sk-g1'), penalty: () => C.touched() },
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
        manual: '#turns', bot: { stop: true }, check: () => C.stopNear('ms-lh-berth'), penalty: () => C.touched() },
    ],
  },
  {
    id: 'sirena', kind: 'mission',
    ru: {
      title: 'Фарватер Порто-Сирены',
      intro: 'Пройдите в бухту Сирены между знаками фарватера и встаньте у деревянного пирса порта.',
    },
    zone: { mark: 'ms-sir-zone', r: 30 },
    steps: [
      { ru: { task: 'Войдите в бухту между знаками фарватера', say: 'Зелёный знак — слева, красный — справа.' },
        manual: '#safety', check: () => C.gate('lateral-green@бухта Сирены', 'lateral-red@бухта Сирены') },
      { ru: { task: 'Остановитесь у деревянного пирса', say: 'Не врежьтесь: к пирсу подходят малым ходом, носом к ветру.' },
        manual: '#turns', bot: { stop: true }, check: () => C.stopNear('ms-sir-berth'), penalty: () => C.touched() },
    ],
  },
  {
    id: 'island', kind: 'mission',
    ru: {
      title: 'Вокруг Маячного',
      intro: 'Обойдите остров Маячный против часовой стрелки через три контрольные точки и вернитесь к старту.',
    },
    zone: { mark: 'ms-isl-zone', r: 30 },
    steps: [
      { ru: { task: 'Восточная точка', say: 'Держитесь подальше от берега: у острова мели.' }, manual: '#safety', check: () => C.seq(C.reach('ms-isl-se', 25), C.reach('ms-isl-e', 25)) },
      { ru: { task: 'Северная точка', say: 'Ветер у острова меняется — следите за парусом.' }, manual: '#trim', check: () => C.seq(C.reach('ms-isl-ne', 25), C.reach('ms-isl-n', 25)) },
      { ru: { task: 'Западная точка', say: 'Мимо входа в Маячную бухточку.' }, manual: '#courses', check: () => C.seq(C.reach('ms-isl-nw', 25), C.reach('ms-isl-w', 25)) },
      { ru: { task: 'Финиш у буя старта', say: 'Последний отрезок.' }, manual: '#courses', check: () => C.seq(C.reach('ms-isl-sw', 25), C.reach('ms-isl-zone', 20)) },
    ],
  },
  {
    id: 'tear', kind: 'mission',
    ru: {
      title: 'Слеза',
      intro: 'Гонка: от буя старта обогните маяк Слеза, оставляя его слева, и вернитесь. Засекаем время.',
    },
    zone: { mark: 'ms-tear-zone', r: 30 },
    steps: [
      { ru: { task: 'Обогните маяк Слеза, оставляя его слева', say: 'До маяка около 400 м. Не срезайте у острова — там камни.' },
        manual: '#upwind', check: () => C.round('ms-tear', 'port', { r: 180, clear: 80 }) },
      { ru: { task: 'Возвращайтесь к бую старта', say: 'Финиш — у оранжевого буя.' }, manual: '#courses', check: () => C.reach('ms-tear-zone', 20) },
    ],
  },
];

export const QUESTS = [...LESSONS, ...MISSIONS];
export const COURSE = LESSONS.map((q) => q.id);
