import * as THREE from 'three';
import { BOAT, SEA, SCENE, DEG } from './config.js';
import { Wind } from './physics/wind.js';
import { Waves } from './physics/waves.js';
import { Boat } from './physics/boat.js';
import { createWater } from './scene/water.js';
import { createPlanarReflection } from './scene/planar-reflection.js';
import { bakeShoreMap, shoreDamp } from './scene/shore-map.js';
import { createBoatMesh } from './scene/boat-mesh.js';
import { createWake } from './scene/wake.js';
import { createParticles } from './scene/particles.js';
import { createBowSpray } from './scene/spray.js';
import { createShoreSpray } from './scene/shore-spray.js';
import { createCrestSpray } from './scene/crest-spray.js';
import { createEnvironment } from './scene/environment.js';
import { FollowCamera } from './scene/camera.js';
import { Input } from './input.js';
import { Hud } from './ui/hud.js';
import { createWeatherPanel } from './ui/weather-panel.js';
import { createTouchControls, isTouchDevice } from './ui/touch.js';
import { makeCollapsible } from './ui/collapse.js';
import { setupFullscreen } from './ui/fullscreen.js';
import { applyIcons } from './ui/icons.js';
import './debug/polar.js';

const STEP = 1 / 120;
// стартовый сетап: время суток, погода, положение лодки
const START = await (await fetch('start.json')).json();

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
  const b = START.boat;
  boat.reset(b.x, b.z, b.headingDeg * DEG);
  boat.sail.reefTarget = boat.sail.reefLevel = b.reefs;
  boat.board = b.board;
}
placeBoat();
const sea = { ...SEA, ...START.weather.sea };

// --- сцена ---
const env = createEnvironment(scene, { ...SCENE, timeOfDay: START.timeOfDay });
const planar = createPlanarReflection(renderer);
const bakeT0 = performance.now();
const shoreMap = bakeShoreMap(env.islands.map((g) => g.userData.shore));
const bakeMs = performance.now() - bakeT0;
// физика гасит волны у берега так же, как вершинный шейдер воды
waves.damp = (x, z) => shoreDamp(shoreMap.depthAt(x, z));
const water = createWater(waves, { size: SCENE.waterSize, segments: SCENE.waterSegments, sky: env.sky, planar, shoreMap });
// второй рендер дорог: на телефонах и планшетах отражение объектов по умолчанию выключено
water.reflection.planar = !isTouchDevice();
scene.add(water.mesh, water.far);
const boatMesh = createBoatMesh();
scene.add(boatMesh.group);
const wake = createWake();
// брызги: общая система частиц и эмиттеры; на таче частиц вдвое меньше
const particles = createParticles({ scale: isTouchDevice() ? 0.5 : 1 });
scene.add(...particles.meshes);
const bowSpray = createBowSpray(particles);
const shoreSpray = createShoreSpray(particles, shoreMap);
const crestSpray = createCrestSpray(particles);
const followCam = new FollowCamera(camera, canvas);

// --- UI ---
const input = new Input();
const hud = new Hud();
let paused = false;
const actions = {
  righten: () => { if (boat.capsized) boat.righten(wind.dir); },
  resetBoat: () => { placeBoat(); input.crew = 0; wake.reset(); },
};
createWeatherPanel({ wind, sea, env, water, particles, actions, start: START });
input.on('reef', (d) => boat.sail.reef(d));
input.on('camera', () => followCam.nextMode());
// пауза показывает справку; закрыть справку — продолжить
const setPaused = (v) => { paused = v; hud.showHelp(v); };
input.on('pause', () => setPaused(!paused));
input.on('help', () => setPaused(!paused));
input.on('escape', () => setPaused(false));
input.on('righten', actions.righten);
document.getElementById('btn-righten').addEventListener('click', actions.righten);
document.getElementById('btn-pause').addEventListener('click', () => input.trigger('pause'));
document.getElementById('btn-resume').addEventListener('click', () => setPaused(false));
document.getElementById('btn-help-close').addEventListener('click', () => setPaused(false));
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
const params = new URLSearchParams(location.search);
let simTime = 0;
const debugAuto = params.has('auto') || params.has('t');
// pos — первым: reset() сбрасывает шверт и рифы, заданные ниже
if (params.has('pos')) {
  // pos=x,z[,курс°] — поставить лодку в точку
  const [x, z, h = 0] = params.get('pos').split(',').map(Number);
  boat.reset(x, z, h * DEG);
}
if (params.has('wind')) wind.baseSpeed = parseFloat(params.get('wind'));
if (params.has('winddir')) wind.baseDirDeg = parseFloat(params.get('winddir'));
if (params.has('cam')) followCam.mode = params.get('cam');
if (params.has('camaz')) followCam.azimuth = parseFloat(params.get('camaz')) * DEG;
if (params.has('campolar')) followCam.polar = parseFloat(params.get('campolar'));
if (params.has('camdist')) followCam.distance = parseFloat(params.get('camdist'));
const camPitch = parseFloat(params.get('campitch') || '0') * DEG;
if (params.has('reefs')) { boat.sail.reefTarget = boat.sail.reefLevel = parseInt(params.get('reefs'), 10); }
if (params.has('board')) boat.board = parseFloat(params.get('board'));
if (params.has('tod')) env.setTimeOfDay(parseFloat(params.get('tod')));
if (params.has('clouds')) env.setCloudType(params.get('clouds'), true);
const autoTwa = parseFloat(params.get('twa') || '60') * DEG;
function autopilotControls() {
  const targetPsi = wind.dir - autoTwa;
  let err = targetPsi - boat.psi;
  err = Math.atan2(Math.sin(err), Math.cos(err));
  const rudderAngle = Math.max(-35 * DEG, Math.min(35 * DEG, 1.2 * err - 1.6 * boat.r));
  const sheetAngle = Math.abs(boat.aw.awa) - 24 * DEG;
  return { rudderAngle, sheetAngle, crew: Math.sign(boat.aw.twa || 1), board: 0, rudder: 0, sheet: 0 };
}
if (params.has('t')) {
  const secs = parseFloat(params.get('t'));
  for (let i = 0; i < secs / STEP; i++) {
    wind.update(STEP);
    waves.configure(Math.min(1, 0.006 * wind.baseSpeed * wind.baseSpeed) * SEA.maxHeight, wind.baseDirDeg * DEG, wind.baseSpeed);
    waves.update(STEP);
    boat.step(STEP, autopilotControls(), wind, waves, shoreMap);
    simTime += STEP;
    wake.update(simTime, boat);
  }
  waves.settle();
  boatMesh.update(boat, 0);
  followCam.update(100, boat, boatMesh);
}
const debugLog = params.has('log');
if (debugLog) console.log(`[shore] ${shoreMap.width}×${shoreMap.height}, точек берега ${shoreMap.sites.count} за ${bakeMs.toFixed(0)} мс`);

// --- цикл ---
let last = performance.now();
let acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.1, (now - last) / 1000);
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
  wake.update(simTime, boat);
  boatMesh.update(boat, simTime);
  if (!halted) {
    bowSpray.update(dt, boat, waves, boatMesh);
    shoreSpray.update(dt, waves, wind, camera);
    crestSpray.update(dt, waves, wind, camera);
  }
  particles.update(halted ? 0 : dt, { waves, wind, env, camera });
  water.update(waves, boat.x, boat.z, {
    time: waves.time, sunDir: env.sunDir, sunColor: env.sunGlint, windDir: wind.vector(),
    whitecap: THREE.MathUtils.clamp((wind.speed - 5) / 10, 0, 1), wake, overcast: env.overcast,
    ripple: THREE.MathUtils.clamp((wind.speed - 1) / 9, 0.05, 1),
  });
  env.update(halted ? 0 : dt, waves, wind, boat);
  followCam.update(dt || 0.016, boat, boatMesh);
  if (camPitch) camera.rotateX(camPitch);
  hud.update({ boat, wind, cameraMode: followCam.mode });
  const R = water.reflection;
  if (R.planar) {
    planar.state.scale = R.resolution;
    const hide = [water.mesh, water.far, env.sky.mesh, ...particles.meshes];
    if (!R.clouds) hide.push(env.clouds.group);
    planar.render(scene, camera, hide);
  }
  renderer.render(scene, camera);
  if (debugLog && Math.floor(simTime) !== Math.floor(simTime - dt)) {
    console.log(`[sim] t=${simTime.toFixed(1)} boat=(${boat.x.toFixed(1)},${boat.y.toFixed(2)},${boat.z.toFixed(1)}) u=${boat.u.toFixed(2)} heel=${(boat.phi / DEG).toFixed(1)} cam=(${camera.position.x.toFixed(1)},${camera.position.y.toFixed(1)},${camera.position.z.toFixed(1)}) tws=${wind.speed.toFixed(1)} H=${waves.sigHeight.toFixed(2)} spray=${particles.stats.drops}/${particles.stats.mist} lod=${particles.stats.lod} ${particles.stats.ms.toFixed(2)}мс`);
  }
}
document.getElementById('loading').remove();
requestAnimationFrame(frame);

// отладка из консоли
window.__sim = { boat, wind, waves, sea, env, followCam, scene, wake, particles, bowSpray, shoreSpray, crestSpray, input, water, shoreMap };
