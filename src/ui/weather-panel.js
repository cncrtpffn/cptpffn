import GUI from 'three/addons/libs/lil-gui.module.min.js';
import { beaufort, BEAUFORT_NAMES, DEG, SEA } from '../config.js';
import { SMALL_SCREEN, loadState, saveState } from './collapse.js';
import { ICONS } from './icons.js';
import { isTouchDevice } from './touch.js';

const PRESETS = {
  'Штиль': { speed: 1.5, gusts: false, gustStrength: 0.2, shiftDeg: 5 },
  'Лёгкий бриз': { speed: 4, gusts: true, gustStrength: 0.25, shiftDeg: 10 },
  'Умеренный': { speed: 7, gusts: true, gustStrength: 0.3, shiftDeg: 12 },
  'Свежий ветер': { speed: 10.5, gusts: true, gustStrength: 0.3, shiftDeg: 12 },
  'Крепкий ветер': { speed: 14, gusts: true, gustStrength: 0.35, shiftDeg: 15 },
  'Шторм': { speed: 19, gusts: true, gustStrength: 0.4, shiftDeg: 18 },
};

// облачность, которую выставляет пресет ветра (потом её можно сменить вручную)
const PRESET_CLOUDS = {
  'Штиль': 'Ясно',
  'Лёгкий бриз': 'Перистые',
  'Умеренный': 'Кучевые',
  'Свежий ветер': 'Холодный фронт',
  'Крепкий ветер': 'Пасмурно',
  'Шторм': 'Гроза',
};

export function createWeatherPanel({ wind, sea, waves, env, water, wake, bowWave, particles, actions, start, resolution, perfOverlay }) {
  const gui = new GUI({ title: 'Погода и сцена', width: 270 });
  const state = { preset: start.weather.preset, timeOfDay: start.timeOfDay, clouds: start.weather.clouds };

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
    state.clouds = PRESET_CLOUDS[name];
    env.setCloudType(state.clouds);
    sea.auto = true;
    if (manual.on) { manual.on = false; setManual(); }
    gui.controllersRecursive().forEach((c) => c.updateDisplay());
    updateBf();
  });

  const fs = gui.addFolder('Море');
  const autoCtl = fs.add(sea, 'auto').name('Волнение от ветра');
  const stateCtl = fs.add(sea, 'state', 0, 1, 0.02).name('Волнение вручную');
  // множитель q Герстнера: 0 — синусоида, 1 — гребни острее всего (общий с физикой)
  fs.add(waves, 'sharpness', 0, 1, 0.02).name('Острота гребней');
  // амплитуда ∝ длина^p: 1 — короткие волны так же круты, как длинные (пятнисто), больше — глаже
  fs.add(waves, 'ampPower', 1, 5, 0.05).name('Гладкость волн');

  // ручные волны: две системы, меняются сразу, без нарастания и затухания
  // стартовые значения — как волнение от ветра (main.js, Waves.configure)
  const h0 = (sea.auto ? Math.min(1, 0.006 * wind.baseSpeed ** 2) : sea.state) * SEA.maxHeight;
  const lambda = Math.round(Math.min(40, Math.max(6, 3 + 2.2 * wind.baseSpeed)) * 2) / 2;
  const manual = {
    on: false,
    h1: Math.round(h0 * 20) / 20, dir1: wind.baseDirDeg, len1: lambda,
    on2: true, h2: 0.5, dir2: (wind.baseDirDeg + 60) % 360, len2: Math.min(40, Math.round(lambda * 1.6 * 2) / 2),
  };
  const apply = () => {
    if (!manual.on) return;
    const systems = [{ h: manual.h1, dir: manual.dir1 * DEG, lambda: manual.len1 }];
    if (manual.on2) systems.push({ h: manual.h2, dir: manual.dir2 * DEG, lambda: manual.len2 });
    waves.setManual(systems);
  };
  const setManual = () => {
    autoCtl.enable(!manual.on); stateCtl.enable(!manual.on);
    if (manual.on) apply(); else waves.setManual(null);
  };
  fs.add(manual, 'on').name('Волны вручную').onChange(setManual);
  const fs1 = fs.addFolder('Система 1');
  fs1.add(manual, 'h1', 0, 4, 0.05).name('Высота, м').onChange(apply);
  fs1.add(manual, 'dir1', 0, 360, 1).name('Откуда, °').onChange(apply);
  fs1.add(manual, 'len1', 6, 40, 0.5).name('Длина волны, м').onChange(apply);
  const fs2 = fs.addFolder('Система 2');
  fs2.add(manual, 'on2').name('Включена').onChange(apply);
  fs2.add(manual, 'h2', 0, 4, 0.05).name('Высота, м').onChange(apply);
  fs2.add(manual, 'dir2', 0, 360, 1).name('Откуда, °').onChange(apply);
  fs2.add(manual, 'len2', 6, 40, 0.5).name('Длина волны, м').onChange(apply);

  const fwater = gui.addFolder('Вода');
  fwater.addColor(water.settings, 'color').name('Цвет');
  fwater.addColor(water.settings, 'shadowColor').name('Цвет тени');
  fwater.add(water.settings, 'shadowStrength', 0, 1, 0.02).name('Сила тени');
  // за сколько метров от предмета до воды тень слабеет
  fwater.add(water.settings, 'shadowFade', 1, 30, 0.5).name('Затухание, м');
  // размытие растёт с расстоянием от предмета
  fwater.add(water.settings, 'shadowBlur', 0, 0.3, 0.01).name('Размытие');
  fwater.add(water.settings, 'wireframe').name('Сетка волн');
  // мелкая рябь по направлению ветровых волн, сила — множитель к силе от ветра
  fwater.add(water.settings, 'ripple').name('Рябь');
  fwater.add(water.settings, 'rippleStrength', 0, 3, 0.05).name('Сила ряби');
  // по положению на волне: ложбина и подветренный склон слабее, гребень и наветренный — сильнее
  fwater.add(water.settings, 'rippleLow', 0, 2, 0.05).name('Рябь в ложбине/подветр.');
  fwater.add(water.settings, 'rippleHigh', 0, 3, 0.05).name('Рябь на гребне/наветр.');
  // 1 — только по высоте, 0 — только по склону
  fwater.add(water.settings, 'rippleModH', 0, 1, 0.05).name('Гребень ↔ склон');
  fwater.add(water.settings, 'rippleModMin', 0, 20, 0.5).name('Рябь: мин. длина волны, м');
  // контраст гребень/ложбина полный до «полный до» (лёгкий бриз), дальше убывает до «в шторм» при «шторм с»
  fwater.add(water.settings, 'rippleContrastFrom', 0, 15, 0.1).name('Контраст полный до, м/с');
  fwater.add(water.settings, 'rippleContrastTo', 5, 30, 0.5).name('Контраст: шторм с, м/с');
  fwater.add(water.settings, 'rippleContrastStorm', 0, 1, 0.05).name('Контраст ряби в шторм');
  // до 10 м/с сила ряби растёт по степени (больше — слабее в слабый ветер),
  // выше — по экспоненте до «в шторм» при «ветре шторма»
  fwater.add(water.settings, 'rippleCalmPow', 1, 3, 0.1).name('Рябь: степень до 10 м/с');
  fwater.add(water.settings, 'rippleStormGain', 1, 4, 0.05).name('Рябь в шторм, ×');
  fwater.add(water.settings, 'rippleStormExp', 0.1, 4, 0.1).name('Рябь: экспонента');
  fwater.add(water.settings, 'rippleStormWind', 11, 30, 0.5).name('Рябь: ветер шторма, м/с');
  fwater.add(water.settings, 'rippleShow').name('Показать силу ряби');
  // отладка: линии по гребням и по дну ложбин, волны короче «Мин. длины» не учитываются
  fwater.add(water.settings, 'ridges').name('Гребни и ложбины');
  fwater.add(water.settings, 'ridgeWidth', 0.5, 6, 0.5).name('Толщина линий, px');
  fwater.add(water.settings, 'ridgeMin', 0, 20, 0.5).name('Мин. длина волны, м');
  // штрихи поперёк гребня по наветренному склону, цветом гребня
  fwater.add(water.settings, 'ridgeHatch').name('Штрихи на склоне');
  fwater.add(water.settings, 'ridgeHatchStep', 1, 40, 0.5).name('Шаг штрихов, м');
  fwater.addColor(water.settings, 'crestColor').name('Цвет гребней');
  fwater.addColor(water.settings, 'troughColor').name('Цвет ложбин');

  const fr = gui.addFolder('Отражения');
  const R = water.reflection;
  fr.add(R, 'sky').name('Небо');
  fr.add(R, 'strength', 0, 1, 0.05).name('Сила неба');
  // больше — цвет воды у лодки тянется дальше к горизонту
  fr.add(R, 'fresnel', 3, 25, 1).name('Дальность');
  // второй рендер сцены: лодка, берег, постройки, буи
  fr.add(R, 'objects').name('Объекты');
  fr.add(R, 'objectStrength', 0, 2, 0.05).name('Сила объектов');
  fr.add(R, 'distort', 0, 0.1, 0.005).name('Искажение волнами');
  fr.add(R, 'resolution', { '¼': 0.25, '½': 0.5, 'полное': 1 }).name('Разрешение');
  fr.add(R, 'clouds').name('Облака в отражении');
  // мерцающие искры солнца на дорожке
  fr.add(R, 'sparkles').name('Искры');
  // сила линейно по ветру: от «в штиль» до «в шторм» при ветре «шторма», дальше не растёт
  fr.add(R, 'sparkleCalmStrength', 0, 3, 0.05).name('Сила искр в штиль');
  fr.add(R, 'sparkleStormStrength', 0, 5, 0.05).name('Сила искр в шторм');
  fr.add(R, 'sparkleStormWind', 1, 30, 0.5).name('Ветер шторма, м/с');
  // количество: до этого ветра четверть ячеек, дальше растёт на «рост» за каждый м/с
  fr.add(R, 'sparkleCalm', 0, 20, 0.5).name('Искры: ветер без роста, м/с');
  fr.add(R, 'sparkleGrowth', 0, 0.2, 0.005).name('Искры: рост на м/с');
  // дорожка из искр у низкого солнца и луны; высоты светила — в sky.path
  fr.add(R, 'path').name('Дорожка');
  fr.add(R, 'pathStrength', 0, 3, 0.05).name('Сила дорожки');
  fr.add(R, 'pathWidth', 0.3, 3, 0.05).name('Ширина дорожки');
  const pathChanged = () => env.setTimeOfDay(state.timeOfDay);
  fr.add(env.sky.path, 'full', 0, 30, 1).name('Дорожка: полная ниже, °').onChange(pathChanged);
  fr.add(env.sky.path, 'start', 1, 60, 1).name('Дорожка: с высоты, °').onChange(pathChanged);

  const fp = gui.addFolder('Прибой');
  fp.add(water.surf, 'enabled').name('Прибой');
  fp.add(water.surf, 'strength', 0, 2, 0.05).name('Сила');
  fp.add(water.surf, 'shallows').name('Мелководье');

  const fk = gui.addFolder('Кильватер');
  fk.add(wake.settings, 'enabled').name('Кильватер');
  fk.add(wake.settings, 'lace').name('Дыры');
  fk.add(wake.settings, 'hull').name('У борта');
  fk.add(wake.settings, 'hullWidth', 0, 2, 0.05).name('Ширина у борта');
  fk.add(wake.settings, 'segments').name('Границы сегментов');
  fk.addColor(wake.settings, 'color').name('Цвет');
  fk.addColor(wake.settings, 'edgeColor').name('Цвет контура');
  // 0 — без контура, один тон
  fk.add(wake.settings, 'edge', 0, 0.2, 0.01).name('Контур');
  // сплошной край ленты у кормы, дальше его прорывают дыры
  fk.add(wake.settings, 'rim', 0, 1, 0.05).name('Край');
  fk.add(wake.settings, 'width', 0.5, 2.5, 0.05).name('Ширина');
  fk.add(wake.settings, 'spread', 0, 0.15, 0.005).name('Расширение, /м');
  fk.add(wake.settings, 'life', 5, 60, 1).name('Длина, с');
  fk.add(wake.settings, 'holes', 1, 5, 0.1).name('Ячейки, м');

  const fbw = gui.addFolder('Бурун');
  fbw.add(bowWave.settings, 'enabled').name('Бурун');
  fbw.add(bowWave.settings, 'bow', 0, 2, 0.05).name('У носа');
  fbw.add(bowWave.settings, 'lumps', 0, 2, 0.05).name('Барашки');
  // отладка: контур пересечения корпуса с водой поверх сцены
  fbw.add(bowWave.settings, 'waterline').name('Ватерлиния');

  const fb = gui.addFolder('Брызги');
  fb.add(particles.settings, 'enabled').name('Брызги');
  fb.add(particles.settings, 'strength', 0, 2, 0.05).name('Сила');
  fb.add(particles.settings, 'bow').name('От носа');
  fb.add(particles.settings, 'shore').name('Прибой и скалы');
  fb.add(particles.settings, 'crest').name('Срыв гребней');

  const fc = gui.addFolder('Сцена');
  fc.add(state, 'timeOfDay', 0, 1, 0.01).name('Время суток').onChange((v) => env.setTimeOfDay(v));
  fc.add(state, 'clouds', env.cloudTypes).name('Облачность').onChange((v) => env.setCloudType(v));
  // луна в сумерках напротив солнца и её искры на воде
  const moonChanged = () => env.setTimeOfDay(state.timeOfDay);
  fc.add(env.sky.moon, 'enabled').name('Луна').onChange(moonChanged);
  fc.add(env.sky.moon, 'lift', 0, 40, 1).name('Высота луны, °').onChange(moonChanged);
  fc.add(env.sky.moon, 'size', 0.3, 3, 0.05).name('Размер луны, °').onChange(moonChanged);
  fc.add(env.sky.moon, 'glint', 0, 3, 0.05).name('Искры луны').onChange(moonChanged);
  fc.add({ f: actions.righten }, 'f').name('Поставить лодку');
  fc.add({ f: actions.resetBoat }, 'f').name('Вернуть в начало');

  // разрешение рендера: авто держит GPU-время кадра в бюджете (perf.js)
  const fq = gui.addFolder('Производительность');
  const rs = resolution.state;
  fq.add(rs, 'auto').name('Авто-разрешение');
  fq.add(rs, 'ratio', 0.75, Math.max(1, rs.max), 0.25).name('Плотность пикселей').listen()
    .onChange(() => { rs.auto = false; gui.controllersRecursive().forEach((c) => c.updateDisplay()); });
  fq.add(perfOverlay.state, 'visible').name('Счётчик кадра');

  // папки по умолчанию свёрнуты, их состояние запоминается между сессиями
  const path = (f) => (f.parent && f.parent !== gui ? `${path(f.parent)}/` : '') + f._title;
  for (const f of gui.foldersRecursive()) {
    const key = `weather.${path(f)}`;
    f.open(!(loadState(key) ?? true));
    f.$title.addEventListener('click', () => saveState(key, f._closed));
  }

  // на маленьких экранах панель свёрнута
  const small = matchMedia(SMALL_SCREEN).matches;
  const saved = loadState('weather');
  if (saved ?? small) gui.close();
  gui.title(`<i class="ico">${ICONS.weather}</i><span class="gui-title-text">Погода и сцена</span>`);
  gui.$title.title = 'Погода и сцена';

  // на таче свёрнутая панель — кнопка-облачко, развёрнутая — диалог поверх всего
  let backdrop = null;
  if (isTouchDevice()) {
    backdrop = document.createElement('div');
    backdrop.id = 'weather-backdrop';
    backdrop.addEventListener('click', () => { gui.close(); sync(); });
    document.body.appendChild(backdrop);
    // без анимации раскрытия: при переходе из кнопки в диалог openAnimated
    // застревает с нулевой высотой содержимого
    gui.domElement.addEventListener('click', (e) => {
      if (!gui.$title.contains(e.target)) return;
      e.stopPropagation();
      gui.open(gui._closed);
      sync();
    }, true);
  }
  const sync = () => {
    saveState('weather', gui._closed);
    if (backdrop) backdrop.classList.toggle('hidden', gui._closed);
  };
  if (backdrop) backdrop.classList.toggle('hidden', gui._closed);
  // встроенная в three версия lil-gui без onOpenClose — слушаем заголовок
  gui.$title.addEventListener('click', sync);

  env.setTimeOfDay(state.timeOfDay);
  env.setCloudType(state.clouds, true);
  return gui;
}
