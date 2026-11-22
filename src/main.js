import * as THREE from 'three';
import { BOAT, SEA, SCENE, DEG } from './config.js';
import { Wind } from './physics/wind.js';
import { Waves } from './physics/waves.js';
import { Boat, crewMove } from './physics/boat.js';
import { createWater } from './scene/water.js';
import { createWake } from './scene/wake.js';
import { bakeShoreMap, shoreDamp } from './scene/shore-map.js';
import { createBoatMesh } from './scene/boat-mesh.js';
import { createParticles } from './scene/particles.js';
import { createBowSpray } from './scene/spray.js';
import { createShoreSpray } from './scene/shore-spray.js';
import { createCrestSpray } from './scene/crest-spray.js';
import { createEnvironment } from './scene/environment.js';
import { buildWorld } from './scene/terrain/world.js';
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
import './debug/polar.js';

const STEP = 1 / 120;
// стартовый сетап: время суток, погода, положение лодки
const START = await (await fetch('start.json')).json();
// URL-параметры — реестр src/params.js (он же таблица на tools.html).
// ?map=<id> — карта по полю высот (src/maps/index.js), без него — демо; ?pos=x,z[,курс°] — старт лодки
// (без него — старт карты map.start, иначе start.json); туда же возвращает «Вернуть лодку»
const P = readParams();
const MAP = MAPS[P.map] ?? MAPS.demo;
const startBoat = { ...START.boat, ...MAP.start };
if (P.pos) {
  const [x, z, h] = P.pos;
  Object.assign(startBoat, { x, z }, Number.isFinite(h) && { headingDeg: h });
}

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
// на таче — карта теней 1024 и простой PCF (createEnvironment): мягкий PCF — 4× выборок на пиксель
renderer.shadowMap.type = isTouchDevice() ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.localClippingEnabled = true;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.3, 5000);

// --- модель ---
const wind = new Wind(START.weather.wind);
const waves = new Waves();
const boat = new Boat(BOAT);
function placeBoat() {
  const b = startBoat;
  boat.reset(b.x, b.z, b.headingDeg * DEG);
  boat.sail.setReef(b.reefs);
  boat.board = b.board;
}
placeBoat();
const sea = { ...SEA, ...START.weather.sea };

// --- сцена ---
// мир — до окружения: буи берутся из него (ручные из описания карты и навигационные знаки плана);
// тень — окном вокруг камеры (на таче меньше и грубее)
const world = buildWorld(MAP, { density: P.veg ?? 1 });
const env = createEnvironment(scene, { ...SCENE, timeOfDay: START.timeOfDay, shadowSize: isTouchDevice() ? 1024 : 4096,
  buoys: world.buoys, shadowRange: isTouchDevice() ? 70 : 120 });
scene.add(world.group);
console.log(world.summary());
const bakeT0 = performance.now();
// карта берега — на весь мир: тексель ≈0.4 м у демо 1.5 км, ≈0.75 м у карты 3 км (на таче вдвое крупнее)
const shoreMap = bakeShoreMap([world.shore], { maxSize: isTouchDevice() ? 2048 : 4096 });
const bakeMs = performance.now() - bakeT0;
// физика гасит волны у берега так же, как вершинный шейдер воды
waves.damp = (x, z) => shoreDamp(shoreMap.depthAt(x, z));
const wake = createWake();
const water = createWater(waves, {
  size: SCENE.waterSize, segments: SCENE.waterSegments, shoreMap, wake,
  shadowCamera: env.sun.shadow.camera, shadowTaps: isTouchDevice() ? 8 : 12,
});
scene.add(water.mesh, water.far);
const boatMesh = createBoatMesh();
scene.add(boatMesh.group);
// брызги: общая система частиц и эмиттеры; на таче частиц вдвое меньше
const particles = createParticles({ scale: isTouchDevice() ? 0.5 : 1 });
scene.add(...particles.meshes);
const bowSpray = createBowSpray(particles);
const shoreSpray = createShoreSpray(particles, shoreMap);
const crestSpray = createCrestSpray(particles);
const followCam = new FollowCamera(camera, canvas);

// --- замеры и разрешение ---
// вода — самое дорогое на GPU, и цена растёт с числом пикселей: на таче потолок DPR 1.5,
// дальше разрешение подстраивается под бюджет GPU (?dpr=1.5 — зафиксировать вручную)
const perf = createPerf(renderer);
const resolution = createAdaptiveResolution(renderer, perf, { max: Math.min(window.devicePixelRatio, isTouchDevice() ? 1.5 : 2) });
if ('dpr' in P) { resolution.state.auto = false; resolution.state.ratio = P.dpr; }
const perfOverlay = createPerfOverlay(perf, resolution, renderer, { visible: !!P.perf });

// --- UI ---
const input = new Input();
const hud = new Hud();
let paused = false;
const actions = {
  righten: () => { if (boat.capsized) boat.righten(wind.dir); },
  resetBoat: () => { placeBoat(); wake.reset(); },
};
createWeatherPanel({ wind, sea, waves, env, water, wake, particles, actions, start: START, resolution, perfOverlay });
input.on('reef', (d) => boat.sail.reef(d));
input.on('crew', (a) => { if (boat.crewPos) boat.crewPos = crewMove(boat.crewPos, a); });
input.on('camera', () => followCam.nextMode());
// пауза показывает справку; закрыть справку — продолжить, свернуть — остаться на паузе
let helpMin = false;
const setPaused = (v, min = false) => { paused = v; helpMin = v && min; hud.showHelp(paused, helpMin); };
input.on('pause', () => setPaused(!paused));
input.on('help', () => (helpMin ? setPaused(true) : setPaused(!paused)));
input.on('escape', () => setPaused(false));
input.on('righten', actions.righten);
document.getElementById('btn-righten').addEventListener('click', actions.righten);
document.getElementById('btn-pause').addEventListener('click', () => input.trigger('pause'));
document.getElementById('btn-resume').addEventListener('click', () => setPaused(false));
document.getElementById('btn-help-close').addEventListener('click', () => setPaused(false));
document.getElementById('btn-help-min').addEventListener('click', () => setPaused(true, true));
document.getElementById('btn-help-expand').addEventListener('click', () => setPaused(true));
document.getElementById('btn-resume-chip').addEventListener('click', () => setPaused(false));
document.getElementById('help').addEventListener('click', (e) => { if (e.target.id === 'help') setPaused(false); });

// тач-управление и сворачиваемые панели
applyIcons();
createTouchControls(input);
const touch = isTouchDevice();
setupFullscreen([...document.querySelectorAll('.btn-fullscreen')], { lockPortrait: touch });
// на телефонах только портрет: в ландшафте поверх игры заглушка (CSS #rotate), симуляция стоит
const phoneLandscape = matchMedia('(orientation: landscape) and (max-height: 500px)');
const hudMain = document.getElementById('hud-main'), hudControls = document.getElementById('hud-controls');
makeCollapsible(hudMain, { key: 'main', title: 'Приборы' });
const controlsPanel = makeCollapsible(hudControls, { key: 'controls', title: 'Органы управления', ...(touch && { defaultCollapsed: true }) });
if (touch) {
  // на таче приборы и состояние лодки — полоса вдоль верхнего края; пока одна
  // панель развёрнута, вторая скрыта (CSS), поэтому развёрнутой бывает только одна
  const bar = document.createElement('div');
  bar.id = 'top-bar';
  bar.append(hudMain, hudControls);
  document.getElementById('hud').prepend(bar);
  if (!hudMain.classList.contains('collapsed') && !hudControls.classList.contains('collapsed')) controlsPanel.set(true);
}
makeCollapsible(document.getElementById('hint'), { key: 'hint', title: 'Подсказка', ...(touch && { defaultCollapsed: true }) });

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
if ('cam' in P) followCam.mode = P.cam;
if ('camaz' in P) followCam.azimuth = P.camaz * DEG;
if ('campolar' in P) followCam.polar = P.campolar;
if ('camdist' in P) followCam.distance = P.camdist;
const camPitch = (P.campitch || 0) * DEG;
if ('reefs' in P) boat.sail.setReef(Math.trunc(P.reefs));
if ('board' in P) boat.board = P.board;
if ('tod' in P) env.setTimeOfDay(P.tod);
if ('clouds' in P) env.setCloudType(P.clouds, true);
const autoTwa = (P.twa || 60) * DEG;
function autopilotControls() {
  const targetPsi = wind.dir - autoTwa;
  let err = targetPsi - boat.psi;
  err = Math.atan2(Math.sin(err), Math.cos(err));
  const rudderAngle = Math.max(-35 * DEG, Math.min(35 * DEG, 1.2 * err - 1.6 * boat.r));
  const sheetAngle = Math.abs(boat.aw.awa) - 24 * DEG;
  return { rudderAngle, sheetAngle, crewPos: 2 * Math.sign(boat.aw.twa || 1), board: 0, rudder: 0, sheet: 0 };
}
if ('t' in P) {
  const secs = P.t;
  for (let i = 0; i < secs / STEP; i++) {
    wind.update(STEP);
    waves.configure(Math.min(1, 0.006 * wind.baseSpeed * wind.baseSpeed) * SEA.maxHeight, wind.baseDirDeg * DEG, wind.baseSpeed);
    waves.update(STEP);
    boat.step(STEP, autopilotControls(), wind, waves, shoreMap);
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
function frame(now) {
  requestAnimationFrame(frame);
  perf.begin(now);
  // метка rAF бывает раньше last (долгая загрузка, компиляция шейдеров) — отрицательный dt разгоняет сглаживание камеры
  let dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
  last = now;
  const halted = paused || (touch && phoneLandscape.matches);
  if (!halted) {
    acc += dt;
    const seaState = sea.auto ? Math.min(1, 0.006 * wind.baseSpeed * wind.baseSpeed) : sea.state;
    if (sea.auto) sea.state = seaState;
    waves.configure(seaState * SEA.maxHeight, wind.baseDirDeg * DEG, wind.baseSpeed);
    const controls = debugAuto ? autopilotControls() : input.controls;
    let n = 0;
    while (acc >= STEP && n < 12) {
      wind.update(STEP);
      waves.update(STEP);
      boat.step(STEP, controls, wind, waves, shoreMap);
      acc -= STEP; n++;
      simTime += STEP;
    }
    if (n === 12) acc = 0;
  }
  boatMesh.update(boat, simTime);
  if (!halted) {
    bowSpray.update(dt, boat, waves, boatMesh);
    shoreSpray.update(dt, waves, wind, camera);
    crestSpray.update(dt, waves, wind, camera);
  }
  particles.update(halted ? 0 : dt, { waves, wind, env, camera });
  if (!halted) wake.update(simTime, boat);
  water.update(waves, boat.x, boat.z, wind.vector());
  env.update(halted ? 0 : dt, waves, wind, boat, camera);
  followCam.update(dt || 0.016, boat, boatMesh);
  world.update(camera.position);
  if (camPitch) camera.rotateX(camPitch);
  hud.update({ boat, wind, cameraMode: followCam.mode });
  renderer.render(scene, camera);
  perf.end();
  resolution.update(dt);
  perfOverlay.update(dt);
  if (debugLog && Math.floor(simTime) !== Math.floor(simTime - dt)) {
    console.log(`[sim] t=${simTime.toFixed(1)} boat=(${boat.x.toFixed(1)},${boat.y.toFixed(2)},${boat.z.toFixed(1)}) u=${boat.u.toFixed(2)} heel=${(boat.phi / DEG).toFixed(1)} cam=(${camera.position.x.toFixed(1)},${camera.position.y.toFixed(1)},${camera.position.z.toFixed(1)}) tws=${wind.speed.toFixed(1)} H=${waves.sigHeight.toFixed(2)} spray=${particles.stats.drops}/${particles.stats.mist} lod=${particles.stats.lod} ${particles.stats.ms.toFixed(2)}мс`);
  }
}
document.getElementById('loading').remove();
requestAnimationFrame(frame);

// отладка из консоли
window.__sim = { world, perf, resolution, renderer, boatMesh, boat, wind, waves, sea, env, followCam, scene, wake, particles, bowSpray, shoreSpray, crestSpray, input, water, shoreMap };
