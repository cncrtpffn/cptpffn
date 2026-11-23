import * as THREE from 'three';
import { buildHeightfield } from './heightfield.js';
import { classifyBiomes, markSettle } from './biomes.js';
import { planSettlements } from './settlement-plan.js';
import { planSettlements as planSettlementsV1 } from './settlement-plan-v1.js';
import { STRUCTURES } from '../structures/index.js';
import { buildTerrain } from './terrain-mesh.js';
import { buildSettlements } from './settlements.js';
import { buildSettlements as buildSettlementsV1 } from './settlements-v1.js';
import { buildVegetation } from './vegetation.js';

// Мир по описанию карты (src/maps/*.js) — общий для игры и стенда карты:
// поле высот → биомы → план поселений (границы, улицы, резервы, дороги, знаки) → чанки рельефа → поселения
// (и их маска занятости) → растительность в обход построек и дорог.
// opts: regions — области биомов вместо map.biomeRegions (инструмент стенда), tstep — шаг меша рельефа,
//       density — плотность растительности.
// group — всё видимое; shore — «берег» на весь мир для bakeShoreMap; update(camPos, lod) — LOD растительности.
export function buildWorld(map, { regions, tstep, density = 1 } = {}) {
  const ms = {};
  let t = performance.now();
  const lap = (k) => { const n = performance.now(); ms[k] = n - t; t = n; };
  const hf = buildHeightfield(map); lap('heights');
  const bio = classifyBiomes(hf, map, regions ?? map.biomeRegions ?? []); lap('biomes');
  // новая сеть улиц — пока только у карт с plan: 'v2' (демо); остальные — замороженный план шага 3а
  const plan = (map.plan === 'v2' ? planSettlements : planSettlementsV1)(hf, bio, map, { footprint: (id) => STRUCTURES[id].footprint }); lap('plan');
  markSettle(bio, hf, plan);
  const terrain = buildTerrain(hf, bio.paint, { ...(tstep ? { step: tstep } : {}), smooth: !!map.smoothTerrain }); lap('terrain');
  // строитель по плану — тоже только у plan: 'v2'; у остальных — замороженный строитель со своей сеткой улиц
  const settle = map.plan === 'v2' ? buildSettlements(hf, bio, map, plan, { ground: terrain.userData.heightAt }) : buildSettlementsV1(hf, bio, map); lap('settlements');
  const veg = buildVegetation(hf, bio, settle.occ, { density, bare: new Set(map.islands.flatMap((isl, i) => (isl.bare ? [i] : []))) }); lap('vegetation');
  const group = new THREE.Group();
  group.name = map.name;
  group.add(terrain, settle.group, veg.group);
  const shore = { x: 0, z: 0, R: map.size / 2 / 1.3, height: hf.sample, rocks: [] };
  const summary = () => {
    const s = settle.stats, v = veg.stats;
    return `${map.name}: поле высот ${ms.heights.toFixed(0)} мс, биомы ${ms.biomes.toFixed(0)} мс, план ${ms.plan.toFixed(0)} мс (${plan.roads.length} дорог, ${plan.marks.length} знаков), `
      + `рельеф ${ms.terrain.toFixed(0)} мс (${terrain.children.length} чанков, ${(terrain.userData.tris / 1e6).toFixed(2)} млн треуг.), `
      + `поселения ${ms.settlements.toFixed(0)} мс (${s.buildings} построек, дороги ${s.roadKm.toFixed(1)} км, ${(s.tris / 1e6).toFixed(2)} млн треуг., ${settle.group.children.length} батчей), `
      + `растительность ${ms.vegetation.toFixed(0)} мс (${v.instances} экз. в ${v.cells} ячейках, ${v.meshes} инстанс-мешей, без LOD ${(v.fullTris / 1e6).toFixed(2)} млн треуг.)`;
  };
  // буи: ручные из описания карты и навигационные знаки плана
  const buoys = [...(map.buoys ?? []), ...plan.marks];
  return { map, hf, bio, plan, buoys, terrain, settle, veg, group, shore, ms, summary, update: (cam, lod = true) => veg.update(cam, lod) };
}
