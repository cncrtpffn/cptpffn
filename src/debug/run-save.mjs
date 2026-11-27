// Запуск: jsc -m src/debug/run-save.mjs  (из корня проекта)
// Сохранение мира (src/save.js): снимок → чтение → слияние со start.json, проверка битых данных, файл сохранения.
import { readSave, mergeStart, snapshot, writeSave, exportBundle, importBundle, clearProgress, saveKey, ASSIST_KEY } from '../save.js';
import { PROGRESS_KEY } from '../tutorial/progress.js';

const out = (s) => (typeof print === 'function' ? print(s) : console.log(s));
let fails = 0;
const check = (ok, msg) => { out(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) fails++; };
const near = (a, b, e = 0.06) => Math.abs(a - b) <= e;

// хранилище-заглушка с API localStorage
function memStore(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    map: m,
  };
}

const START = {
  timeOfDay: 0.21,
  weather: { preset: 'Умеренный', clouds: 'Кучевые', wind: { speed: 7, dirDeg: 0, gusts: true, gustStrength: 0.3, shiftDeg: 12 }, sea: { auto: true, state: 0.3 } },
  boat: { x: 160, z: -90, headingDeg: 90, reefs: 0, board: 1 },
  camera: { mode: 'orbit', angleDeg: 45, distance: 32 },
};
const DEG = Math.PI / 180;
const boat = { x: 412.345, z: -77.7, psi: -30 * DEG, board: 0.5, sail: { reefTarget: 2 } };
const wind = { baseSpeed: 10.5, baseDirDeg: 270, gusts: false, gustStrength: 0.35, shiftDeg: 8 };
const sea = { auto: false, state: 0.62 };
const scene = { timeOfDay: 0.8, clouds: 'Пасмурно', preset: 'Свежий ветер' };
const cam = { mode: 'chase', azimuth: -30 * DEG + 200 * DEG, distance: 21.3, deckYaw: 0 };

// --- круговой путь ---
{
  const st = memStore();
  const w = snapshot({ mapId: 'demo', boat, wind, sea, scene, cam, now: 123 });
  check(writeSave(st, w), 'снимок записан');
  const r = readSave(st, 'demo');
  check(!!r && r.at === 123 && r.map === 'demo', 'снимок прочитан');
  check(near(r.boat.x, 412.35) && near(r.boat.z, -77.7), `позиция ${r.boat.x}, ${r.boat.z}`);
  check(near(r.boat.headingDeg, 330), `курс ${r.boat.headingDeg}° (−30° → 330°)`);
  check(r.boat.reefs === 2 && r.boat.board === 0.5, 'рифы и шверт');
  check(r.camera.mode === 'chase' && near(r.camera.angleDeg, 200) && near(r.camera.distance, 21.3), `камера ${r.camera.mode} ${r.camera.angleDeg}° ${r.camera.distance} м`);
  const m = mergeStart(START, r);
  check(m.timeOfDay === 0.8 && m.weather.clouds === 'Пасмурно' && m.weather.preset === 'Свежий ветер', 'время, облака, пресет');
  check(m.weather.wind.speed === 10.5 && m.weather.wind.dirDeg === 270 && m.weather.wind.gusts === false, 'ветер');
  check(m.weather.sea.auto === false && m.weather.sea.state === 0.62, 'море');
  check(m.boat === START.boat, 'лодка start.json не тронута (старт карты для «Вернуть лодку»)');
  check(START.weather.wind.speed === 7, 'start.json не изменён слиянием');
  check(readSave(st, 'archipelago') === null, 'у другой карты своего сохранения нет');
  const deck = snapshot({ mapId: 'demo', boat, wind, sea, scene, cam: { mode: 'deck', azimuth: 5, deckYaw: -0.5, distance: 16 } });
  check(near(deck.camera.angleDeg, 360 - 0.5 / DEG, 0.1), `палуба: угол из deckYaw ${deck.camera.angleDeg}°`);
}

// --- битые данные ---
{
  const st = memStore({ [saveKey('demo')]: '{не json' });
  check(readSave(st, 'demo') === null, 'битый JSON — нет сохранения');
  st.setItem(saveKey('demo'), JSON.stringify({ v: 2, boat: { x: 1, z: 2 } }));
  check(readSave(st, 'demo') === null, 'чужая версия — нет сохранения');
  st.setItem(saveKey('demo'), JSON.stringify({ v: 1, boat: { x: null, z: 2 } }));
  check(readSave(st, 'demo') === null, 'без координат — нет сохранения');
  st.setItem(saveKey('demo'), JSON.stringify({ v: 1, timeOfDay: 7, weather: { wind: { speed: 'быстро', dirDeg: 45 } }, boat: { x: 1, z: 2, headingDeg: 'N' }, camera: { mode: 'drone', distance: 20 } }));
  const r = readSave(st, 'demo');
  const m = mergeStart(START, r);
  check(r.boat.headingDeg === undefined && r.camera.mode === undefined, 'битые поля отброшены');
  check(m.timeOfDay === 1 && m.weather.wind.speed === 7 && m.weather.wind.dirDeg === 45 && m.camera.mode === 'orbit' && m.camera.distance === 20, 'годные поля применены, время в 0..1');
  check(mergeStart(START, null) === START, 'без сохранения — start.json');
  check(readSave(null, 'demo') === null, 'без хранилища — без ошибок');
  const thrower = { getItem() { throw new Error('denied'); } };
  check(readSave(thrower, 'demo') === null, 'хранилище бросает — без ошибок');
}

// --- файл сохранения ---
{
  const quests = { v: 1, done: { helm: { best: 42, at: 1, tries: 2 } } };
  const st = memStore({ [PROGRESS_KEY]: JSON.stringify(quests), [ASSIST_KEY]: '1', 'catboat.ui.main': '1' });
  writeSave(st, snapshot({ mapId: 'demo', boat, wind, sea, scene, cam }));
  const file = JSON.stringify(exportBundle(st, 'demo'));
  const b = JSON.parse(file);
  check(b.kind === 'catboat-save' && b.world.boat.reefs === 2 && b.quests.done.helm.best === 42 && b.assist === true, 'экспорт: мир, обучение, авто-матрос');

  clearProgress(st);
  check(st.getItem(saveKey('demo')) === null && st.getItem(PROGRESS_KEY) === null, 'удаление: мир и обучение стёрты');
  check(st.getItem(ASSIST_KEY) === '1' && st.getItem('catboat.ui.main') === '1', 'удаление: настройки остались');

  const st2 = memStore({ [ASSIST_KEY]: '0', [saveKey('archipelago')]: '{}' });
  const res = importBundle(st2, file);
  check(res.ok && res.map === 'demo', 'импорт прошёл');
  check(readSave(st2, 'demo')?.boat.reefs === 2 && JSON.parse(st2.getItem(PROGRESS_KEY)).done.helm.best === 42 && st2.getItem(ASSIST_KEY) === '1', 'импорт: всё разложено по ключам');
  check(st2.getItem(saveKey('archipelago')) === null, 'импорт заменяет прогресс целиком (старые миры стёрты)');

  check(importBundle(memStore(), 'привет').error === 'not-save', 'не JSON — отказ');
  check(importBundle(memStore(), '{"kind":"other"}').error === 'not-save', 'чужой JSON — отказ');
  check(importBundle(memStore(), '{"kind":"catboat-save","v":9}').error === 'version', 'чужая версия — отказ');
  const bad = memStore({ [PROGRESS_KEY]: 'старое' });
  check(importBundle(bad, '{"kind":"catboat-save","v":1,"world":{"v":1,"boat":{"x":"a"}}}').error === 'broken' && bad.getItem(PROGRESS_KEY) === 'старое', 'битый мир — отказ, хранилище не тронуто');
  check(importBundle(memStore(), '{"kind":"catboat-save","v":1,"world":null,"quests":null}').ok, 'пустое сохранение (только что начатая игра) — принимается');
}

out(fails ? `\n${fails} FAIL` : '\nвсё ok');
