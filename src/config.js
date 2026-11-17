// Числовые параметры демо. Стартовый сетап (время суток, погода, положение лодки) — в start.json.
// Система координат физики: x — вперёд, y — на правый борт, крен φ > 0 — на правый борт,
// угловая скорость r > 0 — поворот вправо (по часовой сверху). Курс ψ: 0 = север, 90 = восток.

export const DEG = Math.PI / 180;
export const G = 9.81;
export const RHO_AIR = 1.225;
export const RHO_WATER = 1025;

// Ориентир — Cape Cod catboat 18 футов.
export const BOAT = {
  length: 5.5,
  lwl: 5.2,
  beam: 2.6,
  mass: 900,             // корпус + внутренний балласт
  crewMass: 85,
  crewMaxY: 1.15,        // м от ДП, предел пересадки
  crewRate: 1.6,         // м/с, скорость перебежки
  Ixx: 1300,             // момент инерции по крену
  Izz: 1900,             // по рысканию

  // Парус (гафельный грот)
  sailArea: 23,
  ceHeight: 3.0,         // высота центра парусности над ВЛ (без рифов)
  ceX: 0.55,             // ЦП впереди ЦТ
  reefArea: [1, 0.7, 0.45],
  reefCeHeight: [1, 0.84, 0.68],
  reefTime: 3.0,         // с на взятие/отдачу рифа
  sheetMin: 12 * DEG,     // предельный угол гика при полностью выбранном шкоте
  sheetMax: 88 * DEG,
  sheetRate: 28 * DEG,   // рад/с
  luffAngle: 6 * DEG,    // угол атаки, ниже которого парус полощет
  boomBaseRate: 50 * DEG, // рад/с, базовая скорость перекладки гика

  // Корпус
  hullSpeed: 0.4 * Math.sqrt(9.81 * 5.2), // ≈ 2.86 м/с
  resistC1: 26,          // квадратичное сопротивление, Н·с²/м²
  resistCw: 70,          // волновое сопротивление у корпусной скорости
  resistN: 7,            // крутизна «горба»
  hullLatArea: 2.6,      // боковая проекция корпуса, м²
  hullLatClSlope: 0.15,   // 1/рад, подъёмная сила корпуса как крыла малого удлинения
  hullLatCd: 0.6,        // поперечное сопротивление
  hullLatX: -0.35,       // где приложена боковая сила корпуса (ЦБС корпуса без шверта)
  yawDampLin: 2500,      // Н·м·с/(м) — умножается на r·V
  yawDampQuad: 6500,     // Н·м·с² — умножается на r|r|

  // Шверт
  boardArea: 1.3, 
  boardAR: 2.5,
  boardStall: 14 * DEG,
  boardCd0: 0.012,
  boardX: 0.35,          // впереди ЦТ (опущенный)
  boardXUp: -0.3,        // при подъёме уходит назад (поворотный шверт)
  boardDepth: 0.9,       // плечо боковой силы ниже ВЛ
  boardRate: 0.45,       // доля/с

  // Руль («амбарная дверь»)
  rudderArea: 0.55,
  rudderAR: 1.1,
  rudderStall: 35 * DEG,
  rudderX: -2.7,
  rudderMax: 35 * DEG,
  rudderRate: 55 * DEG,      // рад/с при нажатой клавише
  rudderReturnRate: 20 * DEG, // рад/с самовозврат

  // Остойчивость
  gm: 1.2,               // метацентрическая высота, м
  avs: 100 * DEG,        // угол заката диаграммы остойчивости
  rollDamp: 2800,        // Н·м·с
  swampStart: 48 * DEG,  // крен, при котором вода идёт через комингс
  swampRate: 0.30,       // доля/с на 40° сверх порога
  bailRate: 0.05,        // доля/с откачки при крене < 25°
  swampMassFrac: 0.45,   // прибавка массы при полном заливании
  swampGzLoss: 0.7,      // потеря восстанавливающего плеча при полном заливании

  // Дифферент и вертикальная качка (кинематика от волн)
  pitchK: 5.0,
  pitchC: 3.5,
  heaveLag: 0.25,
};

export const SEA = {
  maxHeight: 2.2,        // значимая высота при state = 1
  growTime: 25,          // с, нарастание ветрового волнения
  decayTime: 45,         // с, затухание (зыбь из волн λ=12 м; длинные живут дольше)
  settleTime: 3,         // с, сколько ветер должен продержаться, чтобы море на него отреагировало
  newTrainAngleDeg: 15,  // поворот ветра, после которого рождается новая система волн
  newTrainLambdaFrac: 0.2, // то же по относительному изменению длины волны
};

export const SCENE = {
  waterSize: 440,
  waterSegments: 176,
  // Острова: см. поля в src/scene/island.js (виды деревьев, цвета листвы и скал, количество объектов).
  islands: [
    { x: 260, z: -140, r: 48, h: 26, trees: 28, lighthouse: true, name: 'Маячный',
      treeKinds: { pine: 2, cypress: 1 }, rockColor: ['gray', 'dark'], rocks: 16 },
    { x: -230, z: 180, r: 70, h: 18, trees: 60, name: 'Сосновый',
      treeKinds: { pine: 5, oak: 1 }, leaf: ['deep', 'green'], treeScale: [0.9, 1.5], rockColor: ['gray', 'grayBrown'] },
    { x: 120, z: 330, r: 36, h: 12, trees: 20, name: 'Пальмовый',
      treeKinds: { palm: 3, oak: 1 }, leaf: ['lime', 'fresh'], rockColor: ['sandstone'], flowers: 0.6,
      grassColor: ['green', 'dry'], sandColor: 0xf0e2b6 },
    { x: -340, z: -260, r: 90, h: 34, trees: 80, name: 'Большой',
      treeKinds: { oak: 3, pine: 2, cypress: 1 }, leaf: { oak: ['fresh', 'olive', 'autumn', 'red'], pine: ['green', 'deep'], cypress: ['deep'] }, rockColor: ['grayBrown', 'gray'],
      rockScale: [0.8, 3.0] },
    { x: 420, z: 220, r: 55, h: 20, trees: 36, name: 'Кипарисовый',
      treeKinds: { cypress: 3, oak: 1 }, leaf: ['deep', 'olive'], rockColor: ['sandstone', 'grayBrown'],
      grassColor: ['dry', 'green'], groundColor: 0x93ad66 },
  ],
  buoys: [
    { x: 60, z: -40, color: 0xe9553b },
    { x: -70, z: 50, color: 0x3bb273 },
    { x: 140, z: 90, color: 0xe9553b },
    { x: -150, z: -110, color: 0x3bb273 },
    { x: 30, z: 170, color: 0xf2c14e },
  ],
};

export function beaufort(ms) {
  const t = [0.3, 1.6, 3.4, 5.5, 8.0, 10.8, 13.9, 17.2, 20.8, 24.5];
  let b = 0;
  while (b < t.length && ms >= t[b]) b++;
  return b;
}

export const BEAUFORT_NAMES = [
  'штиль', 'тихий', 'лёгкий', 'слабый', 'умеренный', 'свежий',
  'сильный', 'крепкий', 'очень крепкий', 'шторм', 'сильный шторм',
];
