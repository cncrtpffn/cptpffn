import GUI from 'three/addons/libs/lil-gui.module.min.js';
import { beaufort, BEAUFORT_NAMES } from '../config.js';
import { SMALL_SCREEN, loadState, saveState } from './collapse.js';

const PRESETS = {
  'Штиль': { speed: 1.5, gusts: false, gustStrength: 0.2, shiftDeg: 5 },
  'Лёгкий бриз': { speed: 4, gusts: true, gustStrength: 0.25, shiftDeg: 10 },
  'Умеренный': { speed: 7, gusts: true, gustStrength: 0.3, shiftDeg: 12 },
  'Свежий ветер': { speed: 10.5, gusts: true, gustStrength: 0.3, shiftDeg: 12 },
  'Крепкий ветер': { speed: 14, gusts: true, gustStrength: 0.35, shiftDeg: 15 },
  'Шторм': { speed: 19, gusts: true, gustStrength: 0.4, shiftDeg: 18 },
};

export function createWeatherPanel({ wind, sea, env, actions }) {
  const gui = new GUI({ title: 'Погода и сцена', width: 270 });
  const state = { preset: 'Умеренный', timeOfDay: 0.4 };

  const fw = gui.addFolder('Ветер');
  const speedCtl = fw.add(wind, 'baseSpeed', 0, 22, 0.5).name('Скорость, м/с');
  const bfCtl = fw.add({ bf: '' }, 'bf').name('Бофорт').disable();
  const updateBf = () => { const b = beaufort(wind.baseSpeed); bfCtl.setValue(`${b} — ${BEAUFORT_NAMES[b]}`); };
  speedCtl.onChange(updateBf); updateBf();
  fw.add(wind, 'baseDirDeg', 0, 360, 1).name('Откуда, °');
  fw.add(wind, 'gusts').name('Порывы');
  fw.add(wind, 'gustStrength', 0, 0.6, 0.05).name('Сила порывов');
  fw.add(wind, 'shiftDeg', 0, 40, 1).name('Заходы, ±°');
  fw.add(state, 'preset', Object.keys(PRESETS)).name('Пресет').onChange((name) => {
    Object.assign(wind, PRESETS[name]);
    wind.baseSpeed = PRESETS[name].speed;
    sea.auto = true;
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
    updateBf();
  });

  const fs = gui.addFolder('Море');
  fs.add(sea, 'auto').name('Волнение от ветра');
  fs.add(sea, 'state', 0, 1, 0.02).name('Волнение вручную');

  const fc = gui.addFolder('Сцена');
  fc.add(state, 'timeOfDay', 0, 1, 0.01).name('Время суток').onChange((v) => env.setTimeOfDay(v));
  fc.add({ f: actions.righten }, 'f').name('Поставить лодку');
  fc.add({ f: actions.resetBoat }, 'f').name('Вернуть в начало');

  // на маленьких экранах панель и второстепенные папки свёрнуты
  const small = matchMedia(SMALL_SCREEN).matches;
  if (small) { fs.close(); fc.close(); }
  const saved = loadState('weather');
  if (saved ?? small) gui.close();
  // встроенная в three версия lil-gui без onOpenClose — слушаем заголовок
  gui.$title.addEventListener('click', () => saveState('weather', gui._closed));

  env.setTimeOfDay(state.timeOfDay);
  return gui;
}
