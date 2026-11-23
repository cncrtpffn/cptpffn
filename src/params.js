// Реестр URL-параметров игры: по нему их разбирает main.js и строится таблица на tools.html.
// Новый параметр — сюда (имя, тип, группа, описание, пример), иначе readParams его не увидит.
// Без three и DOM: модуль грузится и со страницы tools.html, и в jsc.
//   kind: num — число, flag — есть/нет, str — строка, list — числа через запятую

export const PARAM_GROUPS = ['Карта и старт', 'Ветер и лодка', 'Камера', 'Сцена', 'Отладка'];

export const GAME_PARAMS = [
  { name: 'map', kind: 'str', group: 'Карта и старт', values: 'demo | archipelago', example: 'archipelago',
    desc: 'карта из src/maps/index.js; без параметра — демо' },
  { name: 'pos', kind: 'list', group: 'Карта и старт', values: 'x,z[,курс°]', example: '160,-90,180',
    desc: 'поставить лодку в точку (м) с курсом; туда же возвращает «Вернуть лодку»' },
  { name: 'veg', kind: 'num', group: 'Карта и старт', default: 1, example: '0.3',
    desc: 'множитель плотности растительности' },

  { name: 'wind', kind: 'num', group: 'Ветер и лодка', values: 'м/с', example: '9', desc: 'сила ветра' },
  { name: 'winddir', kind: 'num', group: 'Ветер и лодка', values: '°', example: '90', desc: 'откуда дует ветер' },
  { name: 'reefs', kind: 'num', group: 'Ветер и лодка', values: '0..2', example: '1', desc: 'взять рифы' },
  { name: 'board', kind: 'num', group: 'Ветер и лодка', values: '0..1', example: '0', desc: 'шверт: 0 — поднят, 1 — опущен' },

  { name: 'cam', kind: 'str', group: 'Камера', values: 'orbit | chase | top | deck', example: 'chase', desc: 'режим камеры' },
  { name: 'camaz', kind: 'num', group: 'Камера', values: '°', example: '120', desc: 'азимут орбитальной камеры' },
  { name: 'campolar', kind: 'num', group: 'Камера', values: 'рад', example: '1.3', desc: 'угол от зенита' },
  { name: 'camdist', kind: 'num', group: 'Камера', values: 'м', example: '25', desc: 'расстояние до лодки' },
  { name: 'campitch', kind: 'num', group: 'Камера', values: '°', default: 0, example: '10', desc: 'наклон взгляда' },

  { name: 'tod', kind: 'num', group: 'Сцена', values: '0..1', example: '0.9', desc: 'время суток: 0.5 — полдень, края — сумерки' },
  { name: 'clouds', kind: 'str', group: 'Сцена', values: 'Ясно | Кучевые | …', example: 'Кучевые',
    desc: 'тип облачности (имена — CLOUD_TYPES в src/scene/clouds.js)' },
  { name: 'dpr', kind: 'num', group: 'Сцена', example: '1.5', desc: 'зафиксировать плотность пикселей, без авто-разрешения' },
  { name: 'touch', kind: 'flag', group: 'Сцена', example: '1', desc: 'тач-управление на десктопе' },

  { name: 't', kind: 'num', group: 'Отладка', values: 'с', example: '30', desc: 'промотать столько секунд под автопилотом' },
  { name: 'twa', kind: 'num', group: 'Отладка', values: '°', default: 60, example: '120', desc: 'курс к ветру для автопилота' },
  { name: 'auto', kind: 'flag', group: 'Отладка', example: '1', desc: 'оставить автопилот включённым (с t — всегда)' },
  { name: 'perf', kind: 'flag', group: 'Отладка', example: '1', desc: 'счётчик кадра: GPU/CPU, draw call’ы, треугольники' },
  { name: 'log', kind: 'flag', group: 'Отладка', example: '1', desc: 'отладочный лог в консоль' },
  { name: 'bowl', kind: 'num', group: 'Отладка', example: '30', desc: 'N открытых «мисок» на воде у старта: контур ватерлинии, дырка в воде, цена' },
];

const PARSE = {
  num: parseFloat,
  flag: () => true,
  str: (v) => v,
  list: (v) => v.split(',').map(Number),
};

// заданные в адресе параметры реестра, уже приведённые к типу: { wind: 9, perf: true, pos: [0, 0, 90] }
export function readParams(search = location.search) {
  const q = new URLSearchParams(search);
  const out = {};
  for (const p of GAME_PARAMS) if (q.has(p.name)) out[p.name] = PARSE[p.kind](q.get(p.name));
  return out;
}
