import * as THREE from 'three';
import { PropBatch, propMaterial, addTree, addBush, addGrass, addRock, TREE_KINDS } from '../flora.js';
import { STYLES } from './kit.js';
import { HOUSES } from './houses.js';
import { HARBOR } from './harbor.js';
import { FARM } from './farm.js';
import { STREET } from './street.js';
import { ROADS } from './roads.js';

// Реестр библиотеки объектов: флора из flora.js и постройки из structures/*.
// Каталог и статус моделей: docs/changes/structures-library/catalog.md.
//
// STRUCTURES[id] = {
//   name, category,
//   styles    — true, если у объекта есть варианты south | north | atlantic (opts.style);
//   footprint — { w, d } в метрах (СК объекта: фасад к +Z, начало — на земле в центре);
//   water     — объект стоит у воды: начало на кромке, вода в сторону +Z;
//   params    — числовые параметры для стенда: { key: { min, max, step, value, label } };
//   variants  — число вариантов (opts.variant 0..variants-1);
//   road      — лента по точкам: opts.points = [[x, y, z], …] в СК base (без них — демо-отрезок, см. roads.js);
//   build(batch, base, opts, rng) — пишет в PropBatch; может вернуть { extras: [Object3D] } (с применённой base,
//                                   как и геометрия батча — см. glow в kit.js).
// }

export { STYLES };
export const CATEGORIES = {
  nature: 'Природа', housing: 'Жильё', public: 'Общественные', farm: 'Хозяйство',
  piers: 'Причалы', port: 'Порт', roads: 'Дороги', street: 'Городская среда',
};
export const STYLE_NAMES = { south: 'Юг', north: 'Север', atlantic: 'Атлантика' };

const TREE_NAMES = { pine: 'Сосна', oak: 'Дуб', palm: 'Пальма', cypress: 'Кипарис' };
const nature = (name, footprint, build) => ({ name, category: 'nature', footprint, build });
const FLORA = {
  ...Object.fromEntries(Object.keys(TREE_KINDS).map((k) => [k, nature(TREE_NAMES[k] ?? k, { w: 3, d: 3 },
    (b, base, o, rng) => addTree(b, k, base, o, rng))])),
  bush: nature('Куст', { w: 2, d: 2 }, (b, base, o, rng) => addBush(b, base, { flowers: true, ...o }, rng)),
  grass: nature('Трава', { w: 1, d: 1 }, (b, base, o, rng) => addGrass(b, base, o, rng)),
  rock: nature('Камень', { w: 3, d: 3 }, (b, base, o, rng) => addRock(b, base, { scale: 1.4, ...o }, rng)),
};

export const STRUCTURES = { ...FLORA, ...HOUSES, ...FARM, ...HARBOR, ...ROADS, ...STREET };

// Параметры по умолчанию из params, поверх — opts
function withDefaults(def, opts) {
  const o = { ...opts };
  for (const [k, p] of Object.entries(def.params ?? {})) if (o[k] === undefined) o[k] = p.value;
  return o;
}

// Объект в общий батч (например, батч острова). base — матрица установки.
// Возвращает extras (в СК батча) — их надо добавить в ту же группу, что и меш батча.
export function addStructure(batch, id, base, opts = {}, rng = Math.random) {
  const def = STRUCTURES[id];
  return def.build(batch, base, withDefaults(def, opts), rng)?.extras ?? [];
}

// Отдельная группа одного объекта (стенд, ручная расстановка).
export function createStructure(id, opts = {}, rng = Math.random) {
  const b = new PropBatch();
  const extras = addStructure(b, id, new THREE.Matrix4(), opts, rng);
  const g = new THREE.Group();
  if (b.pos.length) {
    const mesh = b.toMesh(propMaterial());
    mesh.castShadow = id !== 'grass';
    mesh.receiveShadow = true;
    g.add(mesh);
  }
  if (extras.length) g.add(...extras);
  g.userData.id = id;
  return g;
}
