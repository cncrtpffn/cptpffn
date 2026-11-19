import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Слияние неподвижных деталей: меши-дети parent, которые не двигаются относительно него, собираются
// в один меш на материал (и флаг тени). Лодка рисуется трижды — основной проход, тени, отражение, —
// поэтому каждый лишний меш — это три draw call'а.
// Не трогаем: меши с userData.dynamic (их двигают, перестраивают или прячут в update), с детьми,
// невидимые, с мультиматериалом и с зеркальной матрицей (запекание перевернуло бы обход граней).
// Атрибуты: position, normal (нужна и при flatShading — по ней normalBias теней), uv — если у материала есть карта.
export function mergeStatic(parent) {
  const buckets = new Map();
  for (const m of parent.children) {
    if (!m.isMesh || m.isInstancedMesh || m.userData.dynamic || m.children.length || !m.visible || Array.isArray(m.material)) continue;
    m.updateMatrix();
    if (m.matrix.determinant() < 0) continue;
    const key = `${m.material.uuid}|${m.castShadow}|${m.receiveShadow}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(m);
  }
  let merged = 0;
  for (const meshes of buckets.values()) {
    if (meshes.length < 2) continue;
    const mat = meshes[0].material;
    const keep = ['position', 'normal'];
    if (mat.map) keep.push('uv');
    if (!meshes.every((m) => keep.every((k) => m.geometry.attributes[k]))) continue;
    const geos = meshes.map((m) => {
      // геометрия бывает общей у нескольких мешей (блоки, кольца) — запекаем в копию
      let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      for (const k of Object.keys(g.attributes)) if (!keep.includes(k)) g.deleteAttribute(k);
      g.morphAttributes = {};
      g.clearGroups();
      return g.applyMatrix4(m.matrix);
    });
    const geo = mergeGeometries(geos);
    if (!geo) continue;
    const out = new THREE.Mesh(geo, mat);
    out.castShadow = meshes[0].castShadow;
    out.receiveShadow = meshes[0].receiveShadow;
    out.name = `merged:${mat.name || mat.type}`;
    for (const m of meshes) parent.remove(m);
    parent.add(out);
    merged += meshes.length - 1;
  }
  return merged;
}
