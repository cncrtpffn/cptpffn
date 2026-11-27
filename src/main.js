import * as THREE from 'three';
import { BOAT, SEA, SCENE, DEG } from './config.js';
import { Wind } from './physics/wind.js';
import { Waves } from './physics/waves.js';
import { Boat, crewMove } from './physics/boat.js';
import { createAssist } from './physics/assist.js';
import { createTrimAdvisor } from './physics/trim.js';
import { createWater } from './scene/water.js';
import { createPlanarReflection, markReflected } from './scene/planar-reflection.js';
import { createWake } from './scene/wake.js';
import { bakeShoreMap, shoreDamp } from './scene/shore-map.js';
import { createBoatMesh, hullGeometry } from './scene/boat-mesh.js';
import { createParticles } from './scene/particles.js';
import { createBowSpray } from './scene/spray.js';
import { createBowWave } from './scene/bow-wave.js';
import { createTestBowls } from './debug/test-bowl.js';
import { createShoreSpray } from './scene/shore-spray.js';
import { createCrestSpray } from './scene/crest-spray.js';
import { createEnvironment } from './scene/environment.js';
import { buildWorldAsync } from './scene/terrain/world.js';
import { createObstacles } from './physics/obstacles.js';
import { LESSONS, MISSIONS, QUESTS, COURSE } from './tutorial/quests.js';
import { createQuestRunner } from './tutorial/runner.js';
import { createProgress } from './tutorial/progress.js';
import { readSave, mergeStart, snapshot, writeSave, exportBundle, importBundle, clearProgress, ASSIST_KEY } from './save.js';
import { createQuestUi } from './ui/quest-ui.js';
import { createQuestMarker } from './scene/quest-marker.js';
import { MAPS } from './maps/index.js';
import { FollowCamera } from './scene/camera.js';
import { Input } from './input.js';
import { Hud } from './ui/hud.js';
import { createWeatherPanel } from './ui/weather-panel.js';
import { createTouchControls, isTouchDevice } from './ui/touch.js';
import { makeCollapsible } from './ui/collapse.js';
import { setupFullscreen } from './ui/fullscreen.js';
import { applyIcons } from './ui/icons.js';
import { createPerf, createAdaptiveResolution, createPerfOverlay } from './perf.js';
import { readParams } from './params.js';
import { createLoading } from './ui/loading.js';
import { register, optional, critical, criticalAsync, tick, guardFrame, installShaderGuard, processShaderErrors, compileAndCheck } from './diag/features.js';
import './debug/polar.js';

const STEP = 1 / 120;
// экран загрузки: этапы и их веса для полосы (≈ мс на десктопе, демо). Между этапами — await loading.frame():
// старт — синхронный код, без паузы браузер не покажет новый текст
const loading = createLoading({
  'Настройки': 10, 'Рендерер': 15, 'Поле высот': 320, 'Биомы': 60, 'План поселений': 220, 'Рельеф': 35,
  'Поселения': 175, 'Растительность': 30, 'Небо и свет': 5, 'Карта берега': 440, 'Вода': 5,
  'Лодка и брызги': 70, 'Интерфейс': 10, 'Промотка': 0, 'Шейдеры': 150, 'Первый кадр': 70,
});
const WORLD_STEPS = { heights: 'Поле высот', biomes: 'Биомы', plan: 'План поселений', terrain: 'Рельеф', settlements: 'Поселения', vegetation: 'Растительность' };
loading.step('Настройки');
// стартовый сетап: время суток, погода, положение лодки
const START_JSON = await fetch('start.json').then((r) => {
  if (!r.ok) throw new Error(`start.json: HTTP ${r.status}`);
  return r.json();
});
// URL-параметры — реестр src/params.js (он же таблица на tools.html).
// ?map=<id> — карта по полю высот (src/maps/index.js), без него — демо; ?pos=x,z[,курс°] — старт лодки
// (без него — старт карты map.start, иначе start.json); туда же возвращает «Вернуть лодку»
const P = readParams();
const MAP = MAPS[P.map] ?? MAPS.demo;
const MAP_ID = MAPS[P.map] ? P.map : 'demo';
// сохранение мира (src/save.js): поверх start.json — погода, время, камера; лодка — на месте прошлой сессии.
// С ?pos, ?t и ?nosave сохранение не читается и не пишется (отладочный старт не затирает прогресс)
const useSave = !P.nosave && !P.pos && !('t' in P);
let store = null;
try { store = localStorage; } catch { /* хранилище недоступно */ }
const saved = useSave ? readSave(store, MAP_ID) : null;
const START = mergeStart(START_JSON, saved);
// старт карты — для «Вернуть лодку»; сохранённая позиция — только при загрузке
const startBoat = { ...START.boat, ...MAP.start };
if (P.pos) {
  const [x, z, h] = P.pos;
  Object.assign(startBoat, { x, z }, Number.isFinite(h) && { headingDeg: h });
}

loading.step('Рендерер');
await loading.frame();
const canvas = document.getElementById('c');
// стенсил — «дырка» в воде внутри открытых лодок (waterline.js, createWaterlineCap)
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, stencil: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
// на таче — карта теней 1024 и простой PCF (createEnvironment): мягкий PCF — 4× выборок на пиксель
renderer.shadowMap.type = isTouchDevice() ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.localClippingEnabled = true;
// шапка лога: версия three и GPU — первое, что нужно при разборе ошибок шейдеров
{
  const gl = renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  diag.info('three', `r${THREE.REVISION}, ${renderer.capabilities.isWebGL2 ? 'WebGL2' : 'WebGL1'}`);
  diag.info('GPU', dbg ? `${gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL)} / ${gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)}` : gl.getParameter(gl.RENDERER));
  diag.info('MAX_TEXTURE_SIZE', gl.getParameter(gl.MAX_TEXTURE_SIZE));
}
// ошибки шейдеров — не в консоль three, а в лог с отключением фичи-владельца (processShaderErrors)
installShaderGuard(renderer);
canvas.addEventListener('webglcontextlost', () => diag.fail('WebGL', 'потерян контекст WebGL (нехватка памяти GPU или сброс драйвера)'));
canvas.addEventListener('webglcontextrestored', () => console.warn('[WebGL] контекст восстановлен'));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.3, 5000);

// --- модель ---
const wind = new Wind(START.weather.wind);
const waves = new Waves();
const boat = new Boat(BOAT);
function placeBoat(b = startBoat) {
  boat.reset(b.x, b.z, b.headingDeg * DEG);
  boat.sail.setReef(b.reefs);
  boat.board = b.board;
}
placeBoat(saved ? { ...startBoat, ...saved.boat } : startBoat);
const sea = { ...SEA, ...START.weather.sea };

// --- сцена ---
// мир — до окружения: буи берутся из него (ручные из описания карты и навигационные знаки плана);
// тень — окном вокруг камеры (на таче меньше и грубее)
// без мира, окружения (небо, свет), карты берега, кильватера и воды игры нет: при ошибке — экран с логами.
// Остальное необязательно: при ошибке создаётся заглушка с тем же API (src/diag/features.js)
const world = await criticalAsync('world', 'мир', () => buildWorldAsync(MAP, { density: P.veg ?? 1 }, (k) => {
  loading.step(WORLD_STEPS[k]);
  return loading.frame();
}));
loading.step('Небо и свет');
await loading.frame();
// препятствия на воде (src/physics/obstacles.js): регатные знаки лёгкие — лодка их отталкивает,
// навигационные буи и мостки неподвижны. Буй в сцене следует за своим препятствием (d.obs)
// Знаки квестов (world.marks): race — лёгкие, start — неподвижные, point — невидимые (без препятствия).
// id: знаки квестов — свой, навигационные — «вид@название», регатные карты — buoy-N
const obstacles = createObstacles();
const BUOY_R = { 'lateral-red': 0.7, 'lateral-green': 0.7, race: 0.9, start: 0.6 };
const LIGHT = { undefined: 40, race: 40 }; // кг; остальные неподвижны
const buoyDefs = [...world.buoys, ...world.marks.filter((m) => m.kind !== 'point')].map((d, i) => ({ ...d, obs: obstacles.addCircle({
  id: d.id ?? (d.name ? `${d.kind}@${d.name}` : `buoy-${i}`), kind: !d.kind || d.kind === 'race' ? 'mark' : 'buoy', x: d.x, z: d.z,
  r: d.kind ? BUOY_R[d.kind] ?? 0.75 : 0.55, mass: LIGHT[d.kind] ?? Infinity }) }));
// знаки для квестов по id (якорная точка; лёгкий знак может отъехать на пару метров)
const questMarks = new Map([...world.marks.map((m) => [m.id, m]), ...buoyDefs.map((d) => [d.obs.id, { x: d.x, z: d.z }])]);
world.piers.forEach((p, i) => obstacles.addBox({ id: `pier-${i}`, ...p, kind: 'pier' }));
const env = critical('env', 'окружение', () => createEnvironment(scene, { ...SCENE, timeOfDay: START.timeOfDay, shadowSize: isTouchDevice() ? 1024 : 4096,
  buoys: buoyDefs, shadowRange: isTouchDevice() ? 70 : 120 }));
scene.add(world.group);
console.log(world.summary());
loading.step('Карта берега');
await loading.frame();
const bakeT0 = performance.now();
// карта берега — на весь мир: тексель ≈0.4 м у демо 1.5 км, ≈0.75 м у карты 3 км (на таче вдвое крупнее)
const shoreMap = critical('shore', 'карта берега', () => bakeShoreMap([world.shore], { maxSize: isTouchDevice() ? 2048 : 4096 }));
const bakeMs = performance.now() - bakeT0;
// физика гасит волны у берега так же, как вершинный шейдер воды
waves.damp = (x, z) => shoreDamp(shoreMap.depthAt(x, z));
loading.step('Вода');
await loading.frame();
const wake = critical('wake', 'кильватер', () => createWake());
// без отражения объектов вода живёт: пустая текстура и render-пустышка, галка «Объекты» снята
const planar = optional('planar', 'отражение объектов', () => createPlanarReflection(renderer),
  () => ({ texture: null, matrix: new THREE.Matrix4(), render() {}, state: { scale: 0.5 }, failed: true }));
const water = critical('water', 'вода', () => createWater(waves, {
  size: SCENE.waterSize, segments: SCENE.waterSegments, shoreMap, wake, sky: env.sky, planar,
  shadowCamera: env.sun.shadow.camera,
}));
// второй рендер дорог: на телефонах и планшетах отражение объектов по умолчанию выключено
water.reflection.objects = !isTouchDevice() && !planar.failed;
scene.add(water.mesh, water.far);
loading.step('Лодка и брызги');
await loading.frame();
const boatMesh = critical('boat', 'лодка', () => createBoatMesh());
scene.add(boatMesh.group);
// бурун у носа, вдоль борта и у кормы
const bowWave = optional('bowwave', 'бурун', () => createBowWave(wake, hullGeometry()), () => ({
  mesh: null, lines: null, waterline: { contour: null }, settings: { enabled: false, bow: 1, lumps: 1, waterline: false },
  update() {}, reset() {},
}));
if (bowWave.mesh) scene.add(bowWave.mesh, bowWave.lines);
// ?bowl=N — N открытых «мисок» на воде рядом со стартом: проверка контура ватерлинии, дырки в воде и цены
const bowl = P.bowl ? createTestBowls(Math.max(1, Math.round(P.bowl)), startBoat.x + 6, startBoat.z - 6) : null;
if (bowl) scene.add(...bowl.objects);
// брызги: общая система частиц и эмиттеры; на таче частиц вдвое меньше
const particles = optional('particles', 'брызги', () => createParticles({ scale: isTouchDevice() ? 0.5 : 1 }), () => ({
  meshes: [], settings: { enabled: false, strength: 1, bow: true, shore: true, crest: true },
  update() {}, clear() {}, stats: { drops: 0, mist: 0, lod: 0, ms: 0 }, failed: true,
}));
if (particles.meshes.length) scene.add(...particles.meshes);
// эмиттеры без системы частиц не создаются: она уже в тосте
const noEmitter = () => ({ update() {}, stats: {} });
const emitter = (id, label, create) => (particles.failed ? noEmitter() : optional(id, label, create, noEmitter));
const bowSpray = emitter('bowspray', 'брызги от носа', () => createBowSpray(particles));
const shoreSpray = emitter('shorespray', 'брызги прибоя', () => createShoreSpray(particles, shoreMap));
const crestSpray = emitter('crestspray', 'срыв гребней', () => createCrestSpray(particles));
const followCam = critical('camera', 'камера', () => new FollowCamera(camera, canvas));
// в отражение — крупное: суша, постройки, деревья, буи, облака, лодка без мелочи; свет — весь.
// Трава, кусты и камни (прототип мельче 1.5 м) — почти миллион треугольников, в отражении на половинном разрешении не видны
scene.traverse((o) => { if (o.isLight) markReflected(o); });
markReflected(world.terrain);
markReflected(world.settle.group);
markReflected(world.veg.group, { minRadius: 1.5 });
for (const g of env.buoys) markReflected(g);
markReflected(env.clouds.group);
markReflected(boatMesh.group, { minRadius: 0.25 });
markReflected(boatMesh.sailor.group, { minRadius: 0.1 }); // моряк мельче, но заметен: тело, голова, шапка
const cloudsHidden = [env.clouds.group], noHide = [];

loading.step('Интерфейс');
await loading.frame();
// фичи для мягкой деградации: корни объектов (по ним сломанный шейдер находит владельца) и как выключить.
// Без своего disable прячутся только объекты со сломанным шейдером
register('water', 'вода (простая заливка)', [water.mesh, water.far], () => water.degrade());
register('sky', 'небо', [env.sky.mesh], () => { env.sky.mesh.visible = false; scene.background = scene.fog.color; });
register('clouds', 'облака', [env.clouds.group], () => { env.clouds.group.visible = false; });
const hideAll = (list) => { for (const o of list) o.visible = false; };
register('particles', 'брызги', particles.meshes, () => { particles.settings.enabled = false; particles.clear(); hideAll(particles.meshes); });
for (const [id, label] of [['bowspray', 'брызги от носа'], ['shorespray', 'брызги прибоя'], ['crestspray', 'срыв гребней']]) register(id, label);
register('bowwave', 'бурун', [bowWave.mesh, bowWave.lines], () => {
  Object.assign(bowWave.settings, { enabled: false, waterline: false });
  if (bowWave.mesh) hideAll([bowWave.mesh, bowWave.lines]);
});
register('wake', 'кильватер', [], () => { wake.settings.enabled = false; wake.reset(); });
register('planar', 'отражение объектов', [], () => { water.reflection.objects = false; });
register('world', 'суша, постройки, растительность', [world.group]);
register('buoys', 'буи', env.buoys);
register('boat', 'лодка (часть модели)', [boatMesh.group]);

// --- замеры и разрешение ---
// вода — самое дорогое на GPU, и цена растёт с числом пикселей: на таче потолок DPR 1.5,
// дальше разрешение подстраивается под бюджет GPU (?dpr=1.5 — зафиксировать вручную)
const perf = createPerf(renderer);
const resolution = createAdaptiveResolution(renderer, perf, { max: Math.min(window.devicePixelRatio, isTouchDevice() ? 1.5 : 2) });
if ('dpr' in P) { resolution.state.auto = false; resolution.state.ratio = P.dpr; }
const perfOverlay = optional('perfoverlay', 'счётчик кадра', () => createPerfOverlay(perf, resolution, renderer, { visible: !!P.perf }),
  () => ({ state: { visible: false }, update() {} }));
register('perfoverlay', 'счётчик кадра', [], () => { perfOverlay.state.visible = false; });

// --- UI ---
const input = critical('input', 'управление', () => new Input());
// без HUD — только справка по паузе
const hud = optional('hud', 'приборы', () => new Hud(), () => ({
  update() {},
  toast() {},
  showHelp(v, min = false) { document.getElementById('help').classList.toggle('hidden', !v || min); },
}));
register('hud', 'приборы');
let paused = false;
const actions = {
  righten: () => { if (boat.capsized) boat.righten(wind.dir); },
  resetBoat: () => { placeBoat(); wake.reset(); bowWave.reset(); advisor.reset(); },
  // снять с мели (кнопка рядом с сообщением о мели): на глубину рядом, кормой к берегу;
  // шкот потравлен, у ассистента — «стоп»
  rescue: () => {
    if (boat.capsized) return;
    if (!boat.rescue(shoreMap, obstacles)) { hud.toast('Не нашли глубину рядом', ''); return; }
    wake.reset(); bowWave.reset(); advisor.reset();
    if (assistOn) { assist.reset(); assist.telegraph = 0; }
    hud.toast('Лодку вывели на глубину');
  },
};
const panel = optional('panel', 'панель настроек', () => createWeatherPanel({ wind, sea, waves, env, water, wake, bowWave, particles, actions, start: START, resolution, perfOverlay }));
input.bindKeyHints(document.getElementById('hud'));
// ассистент («авто-матрос», src/physics/assist.js): ведёт всё, кроме руля; шкот заменяет телеграф.
// По умолчанию выключен, выбор помнится; ?assist=0|1 — задать на этот запуск
const assist = createAssist();
// советчик настройки (тот же источник целей, что у ассистента): отметки оптимума и подсказки в HUD
const advisor = createTrimAdvisor();
let advice = null;
register('advice', 'подсказки настройки', [], () => { advice = null; document.querySelectorAll('.ctl.hint, #touch-ui .hint').forEach((el) => el.classList.remove('hint')); });
let assistOn = false;
try { assistOn = localStorage.getItem(ASSIST_KEY) === '1'; } catch { /* хранилище недоступно */ }
if ('assist' in P) assistOn = !!P.assist;
const btnAssist = document.getElementById('btn-assist');
// канал ведёт ассистент: включён и канал не отдан игроку (маска assist.channels — уроки обучения)
const auto = (ch) => assistOn && assist.channels[ch];
// body.assist — ассистент включён; body.auto-<канал> — канал на ассистенте (CSS прячет клавиши и тач-кнопки)
const syncAssistUi = () => {
  document.body.classList.toggle('assist', assistOn);
  for (const ch of Object.keys(assist.channels)) document.body.classList.toggle(`auto-${ch}`, auto(ch));
};
const setAssistChannels = (mask) => { assist.setChannels(mask); syncAssistUi(); };
const setAssist = (v, save = true) => {
  assistOn = v;
  if (v) assist.reset();
  syncAssistUi();
  btnAssist.classList.toggle('on', v);
  btnAssist.setAttribute('aria-pressed', String(v));
  if (!save) return; // начальное состояние — без тоста
  try { localStorage.setItem(ASSIST_KEY, v ? '1' : '0'); } catch { /* хранилище недоступно */ }
  hud.toast(v ? 'Авто-матрос включён — вам руль и ход' : 'Авто-матрос выключен — всё управление ваше');
};
setAssist(assistOn, false);
input.on('assist', () => {
  // в уроке помощь задаёт урок
  if (quests?.lessonActive) { hud.toast('Помощь в уроке задаёт инструктор', 'soft'); return; }
  setAssist(!assistOn);
});
btnAssist.addEventListener('click', () => input.trigger('assist'));
// каналы на ассистенте — его, ручные команды не действуют
input.on('reef', (d) => { if (!auto('reef')) boat.sail.reef(d); });
input.on('crew', (a) => { if (!auto('crew') && boat.crewPos) boat.crewPos = crewMove(boat.crewPos, a); });
input.on('camera', () => followCam.nextMode());
// пауза показывает справку; закрыть справку — продолжить, свернуть — остаться на паузе
let helpMin = false;
const setPaused = (v, min = false) => {
  paused = v; helpMin = v && min; hud.showHelp(paused, helpMin);
  if (paused) { saveNow(); syncSaveStatus(); }
};
input.on('pause', () => setPaused(!paused));
input.on('help', () => (helpMin ? setPaused(true) : setPaused(!paused)));
input.on('escape', () => { if (quests?.ui.menuOpen) quests.ui.closeMenu(); else setPaused(false); });
input.on('righten', actions.righten);
document.getElementById('btn-righten').addEventListener('click', actions.righten);
document.getElementById('btn-rescue').addEventListener('click', actions.rescue);
document.getElementById('btn-pause').addEventListener('click', () => input.trigger('pause'));
document.getElementById('btn-camera').addEventListener('click', () => input.trigger('camera'));
document.getElementById('btn-resume').addEventListener('click', () => setPaused(false));
document.getElementById('btn-logs').addEventListener('click', () => diag.open());
document.getElementById('btn-help-close').addEventListener('click', () => setPaused(false));
document.getElementById('btn-help-min').addEventListener('click', () => setPaused(true, true));
document.getElementById('btn-help-expand').addEventListener('click', () => setPaused(true));
document.getElementById('btn-resume-chip').addEventListener('click', () => setPaused(false));
document.getElementById('help').addEventListener('click', (e) => { if (e.target.id === 'help') setPaused(false); });

// тач-управление и сворачиваемые панели
optional('icons', 'иконки', () => applyIcons());
const touchUi = optional('touch', 'тач-управление', () => createTouchControls(input));
register('touchind', 'индикаторы руля и шкота');
const touch = isTouchDevice();
optional('fullscreen', 'полный экран', () => setupFullscreen([...document.querySelectorAll('.btn-fullscreen')], { lockPortrait: touch }));
// на телефонах только портрет: в ландшафте поверх игры заглушка (CSS #rotate), симуляция стоит
const phoneLandscape = matchMedia('(orientation: landscape) and (max-height: 500px)');
optional('collapse', 'сворачивание панелей', () => {
  const hudMain = document.getElementById('hud-main'), hudControls = document.getElementById('hud-controls');
  if (touch) {
    // на таче приборы и органы управления — одна плашка у верхнего края: органы управления
    // встают внутрь приборов после легенды, в свёрнутом виде от них остаётся только статус (CSS)
    hudControls.classList.replace('panel', 'merged');
    hudMain.querySelector('.rose-legend').after(hudControls);
    const bar = document.createElement('div');
    bar.id = 'top-bar';
    bar.append(hudMain);
    document.getElementById('hud').prepend(bar);
  } else {
    makeCollapsible(hudControls, { key: 'controls', title: 'Органы управления' });
  }
  makeCollapsible(hudMain, { key: 'main', title: 'Приборы' });
});

// --- обучающие квесты: курс «Школа шкипера» и миссии (src/tutorial/*, карточка и меню — src/ui/quest-ui.js) ---
// Урок переносит лодку к своему старту, ставит свой ветер и маску ассистента; после урока всё возвращается.
// Миссия: плыть к зоне старта (стрелка на компасе), там «Начать»; ветер и помощь — как у игрока
const obsById = new Map(buoyDefs.map((d) => [d.obs.id, d.obs]));
const questMark = (id) => questMarks.get(id);
const questMarkNow = (id) => obsById.get(id) ?? questMarks.get(id); // лёгкий знак мог отъехать
const quests = optional('quests', 'обучение', () => {
  const runner = createQuestRunner(QUESTS);
  const progress = createProgress({ knownIds: QUESTS.map((q) => q.id), unlockAll: P.quests === 'all' });
  const marker = createQuestMarker(scene);
  let saved = null;      // мир до урока: ветер и ассистент
  let menuPause = false;
  const lesson = () => runner.quest?.kind === 'lesson' && runner.state !== 'idle';
  // ассистент по маске урока: всё false — выключен
  const applyMask = (mask) => {
    const on = !!mask && Object.values(mask).some(Boolean);
    assist.setChannels(mask || {});
    setAssist(on, false);
    if (on) assist.telegraph = 2;
  };
  const restore = () => {
    if (!saved) return;
    Object.assign(wind, saved.wind);
    assist.setChannels(saved.mask);
    setAssist(saved.assistOn, false);
    saved = null;
  };
  // перенос лодки: позиция и курс, рифы и шверт; сброс следов и камера сразу к лодке
  const teleport = (x, z, psi, reefs, board) => {
    boat.reset(x, z, psi);
    boat.sail.setReef(reefs);
    boat.board = board;
    wake.reset(); bowWave.reset(); advisor.reset(); assist.reset();
    followCam.update(100, boat, boatMesh);
  };
  const ui = createQuestUi({
    lessons: LESSONS, missions: MISSIONS, progress,
    h: {
      start: (id) => q.start(id),
      route: (id) => { q.abort(); runner.select(id); hud.toast(`Курс проложен: ${runner.quest.ru.title}`); },
      begin: () => { runner.start(runner.quest.id, boat); progress.started(runner.quest.id); },
      abort: () => q.abort(),
      retry: () => q.retry(),
      menu: () => { q.abort(); q.openMenu(); },
      closed: () => { menuPause = false; },
    },
  });
  const q = {
    runner, progress, ui, marker,
    get halted() { return menuPause || ui.dialogOpen; },
    get lessonActive() { return lesson(); },
    start(id) {
      const quest = runner.get(id);
      if (!quest) return;
      ui.hideDialog();
      document.body.classList.remove('quest-failed');
      if (quest.kind === 'mission') { q.abort(); runner.select(id); return; }
      if (!saved) saved = { wind: { baseSpeed: wind.baseSpeed, baseDirDeg: wind.baseDirDeg, gusts: wind.gusts, gustStrength: wind.gustStrength }, assistOn, mask: { ...assist.channels } };
      const s = quest.setup;
      Object.assign(wind, { baseSpeed: s.wind.speed, baseDirDeg: s.wind.dirDeg, gusts: !!s.wind.gusts, gustStrength: s.wind.gustStrength ?? 0.3 });
      teleport(s.x, s.z, s.hdg * DEG, s.reefs ?? 0, s.board ?? 1);
      applyMask(s.assist);
      runner.start(id, boat);
      progress.started(id);
      hud.toast(quest.ru.intro, 'info', 6000);
    },
    abort() {
      ui.hideDialog();
      document.body.classList.remove('quest-failed');
      runner.abort();
      restore();
    },
    // повтор шага после переворота: на старт шага с теми же рифами и швертом
    retry() {
      document.body.classList.remove('quest-failed');
      if (boat.capsized) boat.righten(wind.dir);
      const cp = runner.checkpoint;
      if (cp) teleport(cp.x, cp.z, cp.psi, boat.sail.reefTarget, boat.board);
      runner.retry(boat);
    },
    openMenu() { menuPause = true; ui.openMenu(boat, questMark); },
    toggleMenu() { if (ui.menuOpen) ui.closeMenu(); else q.openMenu(); },
    // события кадра
    update(dt) {
      for (const e of runner.update(dt, { boat, wind, mark: questMark, advice, assist: assistOn ? assist : null })) {
        const quest = runner.quest;
        if (e.type === 'step' && quest.kind === 'lesson') {
          const st = quest.steps[e.step];
          if (st.assist) applyMask({ ...quest.setup.assist, ...st.assist });
          if (e.step > 0) hud.toast('Готово! ' + st.ru.task, 'info', 3000);
        } else if (e.type === 'ready') hud.toast('Вы в зоне старта — нажмите «Начать»', 'info', 3500);
        else if (e.type === 'penalty') hud.toast(`Задели знак: штраф ${10} с`, 'soft');
        else if (e.type === 'fail') { document.body.classList.add('quest-failed'); ui.showFail(quest); }
        else if (e.type === 'done') {
          const record = progress.record(quest.id, e.total);
          const i = COURSE.indexOf(quest.id);
          ui.showResult(quest, runner.result, record, quest.kind === 'lesson' && i >= 0 && i < COURSE.length - 1 ? COURSE[i + 1] : null);
        }
      }
    },
    target() { return runner.state === 'idle' || runner.state === 'done' ? null : runner.target(boat, questMark); },
    highlight() { return runner.state === 'active' ? runner.step?.highlight ?? null : null; },
  };
  document.getElementById('btn-quests').addEventListener('click', () => input.trigger('quests'));
  document.getElementById('help-quests').addEventListener('click', (e) => { e.preventDefault(); setPaused(false); q.openMenu(); });
  input.on('quests', () => q.toggleMenu());
  return q;
}, () => null);
register('quests', 'обучение', quests ? [quests.marker.group] : []);
if (quests && P.quest) {
  const qq = quests.runner.get(P.quest);
  if (qq) quests.start(P.quest);
}

// --- сохранение мира (src/save.js): раз в 5 с плавания, при сворачивании и закрытии вкладки.
// Во время урока не пишем — лодку перенёс урок; после перезагрузки она там, где была до урока
let saveOn = useSave && !!store, saveTimer = 0, savedAt = saved?.at ?? 0;
const sceneState = () => panel?.state ?? { timeOfDay: START.timeOfDay, clouds: START.weather.clouds, preset: START.weather.preset };
function saveNow() {
  if (!saveOn || quests?.lessonActive) return;
  const w = snapshot({ mapId: MAP_ID, boat, wind, sea, scene: sceneState(), cam: followCam });
  if (writeSave(store, w)) savedAt = w.at;
}
document.addEventListener('visibilitychange', () => { if (document.hidden) saveNow(); });
window.addEventListener('pagehide', saveNow);
// блок «Сохранение» на экране паузы: скачать файл, загрузить из файла (с перезагрузкой), удалить прогресс
const saveStatus = document.getElementById('save-status');
const syncSaveStatus = () => {
  if (!saveStatus) return;
  saveStatus.textContent = !store ? 'Хранилище браузера недоступно — прогресс не сохраняется'
    : !useSave ? 'Отладочный старт — прогресс не сохраняется'
      : savedAt ? `Автосохранение: ${new Date(savedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` : 'Автосохранение включено';
};
const saveFile = document.getElementById('save-file');
document.getElementById('btn-save-download')?.addEventListener('click', () => {
  saveNow();
  const blob = new Blob([JSON.stringify(exportBundle(store, MAP_ID), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `catboat-save-${new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-')}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  hud.toast('Сохранение скачано');
});
document.getElementById('btn-save-load')?.addEventListener('click', () => saveFile.click());
saveFile?.addEventListener('change', async () => {
  const file = saveFile.files[0];
  saveFile.value = '';
  if (!file) return;
  if (!store) { hud.toast('Хранилище браузера недоступно', ''); return; }
  const res = importBundle(store, await file.text());
  if (!res.ok) { hud.toast(res.error === 'storage' ? 'Не удалось записать сохранение' : 'Файл не похож на сохранение', ''); return; }
  saveOn = false; // pagehide не должен затереть загруженное
  if (res.map && res.map !== MAP_ID) {
    // мир другой карты: открыть её (без отладочных параметров)
    location.href = `${location.pathname}${res.map === 'demo' ? '' : `?map=${encodeURIComponent(res.map)}`}`;
  } else location.reload();
});
document.getElementById('btn-save-clear')?.addEventListener('click', () => {
  if (!confirm('Удалить прогресс? Лодка вернётся на старт, пройденные уроки и миссии сбросятся.')) return;
  saveOn = false;
  clearProgress(store);
  location.reload();
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- отладка через URL: ?t=30&twa=60&wind=8&cam=chase&auto=1 ---
let simTime = 0;
const debugAuto = !!P.auto || 't' in P;
if ('wind' in P) wind.baseSpeed = P.wind;
if ('winddir' in P) wind.baseDirDeg = P.winddir;
followCam.configure(START.camera, boat.psi);
if ('cam' in P) followCam.mode = P.cam;
if ('camaz' in P) followCam.azimuth = P.camaz * DEG;
if ('campolar' in P) followCam.polar = P.campolar;
if ('camdist' in P) followCam.distance = P.camdist;
const camPitch = (P.campitch || 0) * DEG;
if ('reefs' in P) boat.sail.setReef(Math.trunc(P.reefs));
if ('board' in P) boat.board = P.board;
if ('tod' in P) env.setTimeOfDay(P.tod);
if ('clouds' in P) env.setCloudType(P.clouds, true);
// автопилот отладки: руль держит угол к ветру, остальное — ассистент
const autoTwa = (P.twa || 60) * DEG;
const autoRudder = { rudder: 0, rudderAngle: 0 };
function autopilotControls() {
  const targetPsi = wind.dir - autoTwa;
  let err = targetPsi - boat.psi;
  err = Math.atan2(Math.sin(err), Math.cos(err));
  autoRudder.rudderAngle = Math.max(-35 * DEG, Math.min(35 * DEG, 1.2 * err - 1.6 * boat.r));
  return autoRudder;
}
if ('t' in P) {
  loading.step('Промотка');
  await loading.frame();
  const secs = P.t;
  for (let i = 0; i < secs / STEP; i++) {
    wind.update(STEP);
    waves.configure(Math.min(1, 0.006 * wind.baseSpeed * wind.baseSpeed) * SEA.maxHeight, wind.baseDirDeg * DEG, wind.baseSpeed);
    waves.update(STEP);
    boat.step(STEP, assist.controls(STEP, boat, wind, autopilotControls()), wind, waves, shoreMap, obstacles);
    simTime += STEP;
  }
  waves.settle();
  boatMesh.update(boat, 0);
  followCam.update(100, boat, boatMesh);
}
const debugLog = !!P.log;
if (debugLog) console.log(`[shore] ${shoreMap.width}×${shoreMap.height}, точек берега ${shoreMap.sites.count} за ${bakeMs.toFixed(0)} мс`);

// --- цикл ---
let last = performance.now();
let acc = 0;
let contactSeen = 0;
let telegraphAxis = 0; // телеграф переключается по фронту: удержание ↑ — один шаг
function frame(now) {
  requestAnimationFrame(frame);
  // ошибка в кадре не останавливает цикл: необязательные фичи выключаются в tick, остальное — в лог (guardFrame)
  guardFrame(() => step(now));
  processShaderErrors(renderer, scene);
}
function step(now) {
  perf.begin(now);
  // метка rAF бывает раньше last (долгая загрузка, компиляция шейдеров) — отрицательный dt разгоняет сглаживание камеры
  let dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
  last = now;
  const halted = paused || (touch && phoneLandscape.matches) || !!quests?.halted;
  if (!halted) {
    acc += dt;
    const seaState = sea.auto ? Math.min(1, 0.006 * wind.baseSpeed * wind.baseSpeed) : sea.state;
    if (sea.auto) sea.state = seaState;
    waves.configure(seaState * SEA.maxHeight, wind.baseDirDeg * DEG, wind.baseSpeed);
    const controls = debugAuto ? autopilotControls() : input.controls;
    const assisted = assistOn || debugAuto;
    if (auto('sheet')) {
      const t = Math.abs(controls.sheet) > 0.3 ? Math.sign(controls.sheet) : 0;
      if (t && t !== telegraphAxis) assist.request(t, boat);
      telegraphAxis = t;
    }
    let n = 0;
    while (acc >= STEP && n < 12) {
      wind.update(STEP);
      waves.update(STEP);
      boat.step(STEP, assisted ? assist.controls(STEP, boat, wind, controls) : controls, wind, waves, shoreMap, obstacles);
      acc -= STEP; n++;
      simTime += STEP;
    }
    if (n === 12) acc = 0;
    saveTimer += dt;
    if (saveTimer > 5) { saveTimer = 0; saveNow(); }
    // касание буя или мостка — тост (слабые касания на малом ходу — без него)
    const k = boat.contact;
    if (k.count !== contactSeen) {
      contactSeen = k.count;
      if (k.speed > 0.3) hud.toast(k.kind === 'pier' ? 'Удар о причал' : k.kind === 'mark' ? 'Задели знак' : 'Удар о буй', k.kind === 'mark' ? 'soft' : '');
    }
  }
  boatMesh.update(boat, simTime);
  if (!halted) {
    tick('bowspray', () => bowSpray.update(dt, boat, waves, boatMesh));
    tick('bowwave', () => bowWave.update(dt, simTime, boat, waves, boatMesh, env));
    bowl?.update(waves, boat.x, boat.z, water.edgeAt);
    tick('shorespray', () => shoreSpray.update(dt, waves, wind, camera));
    tick('crestspray', () => crestSpray.update(dt, waves, wind, camera));
  }
  tick('particles', () => particles.update(halted ? 0 : dt, { waves, wind, env, camera }));
  // волна у борта — лента кильватера вдоль корпуса по контуру ватерлинии буруна
  if (!halted) tick('wake', () => wake.update(simTime, boat, bowWave.waterline.contour));
  water.update(waves, boat.x, boat.z, wind.vector());
  env.update(halted ? 0 : dt, waves, wind, boat, camera);
  followCam.update(dt || 0.016, boat, boatMesh);
  world.update(camera.position);
  if (camPitch) camera.rotateX(camPitch);
  if (!halted) tick('advice', () => { advice = advisor.update(dt, boat, wind); });
  let qTarget = null, qHighlight = null;
  if (quests) tick('quests', () => {
    if (!halted) quests.update(dt);
    qTarget = quests.target(); qHighlight = quests.highlight();
    quests.marker.update(halted ? 0 : dt, qTarget, questMarkNow, waves);
    quests.ui.update(quests.runner, qTarget);
  });
  tick('hud', () => hud.update({ boat, wind, cameraMode: followCam.mode, assist: assistOn ? assist : null, advice, target: qTarget, highlight: qHighlight }));
  if (touchUi) tick('touchind', () => touchUi.update(boat, assistOn ? assist : null, advice, qHighlight));
  const R = water.reflection;
  if (R.objects) tick('planar', () => {
    planar.state.scale = R.resolution;
    planar.render(scene, camera, R.clouds ? noHide : cloudsHidden);
  });
  renderer.render(scene, camera);
  perf.end();
  resolution.update(dt);
  tick('perfoverlay', () => perfOverlay.update(dt));
  if (debugLog && Math.floor(simTime) !== Math.floor(simTime - dt)) {
    console.log(`[sim] t=${simTime.toFixed(1)} boat=(${boat.x.toFixed(1)},${boat.y.toFixed(2)},${boat.z.toFixed(1)}) u=${boat.u.toFixed(2)} heel=${(boat.phi / DEG).toFixed(1)} cam=(${camera.position.x.toFixed(1)},${camera.position.y.toFixed(1)},${camera.position.z.toFixed(1)}) tws=${wind.speed.toFixed(1)} H=${waves.sigHeight.toFixed(2)} spray=${particles.stats.drops}/${particles.stats.mist} lod=${particles.stats.lod} ${particles.stats.ms.toFixed(2)}мс`);
  }
}
// шейдеры — до первого кадра, пока виден экран загрузки: сломанные фичи выключаются заранее
loading.step('Шейдеры');
await loading.frame();
await compileAndCheck(renderer, scene, camera);
// прогревочный кадр под заставкой: загрузка геометрии и текстур в GPU, карта теней, отражение.
// dt ≈ 0 — симуляция не сдвигается. Без него фризом был первый кадр после заставки
loading.step('Первый кадр');
await loading.frame();
last = performance.now();
guardFrame(() => step(last));
processShaderErrors(renderer, scene);
loading.done();
diag.started();
requestAnimationFrame(frame);

// отладка из консоли
window.__sim = { world, planar, perf, resolution, renderer, boatMesh, boat, wind, waves, sea, env, followCam, scene, wake, bowWave, bowl, particles, assist, setAssistChannels, obstacles, quests, bowSpray, shoreSpray, crestSpray, input, water, shoreMap };
