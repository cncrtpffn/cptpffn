import * as THREE from 'three';
import { MAX_COMP } from '../physics/waves.js';
import { SHORE_DAMP_GLSL } from './water-fx.js';

// Вода: один цвет, только рассеянный свет (Lambert, без бликов), без текстур, пены и отражений
// (эксперимент, панель «Вода»).
// Вершинный шейдер Герстнера с теми же параметрами, что в физике: лодка качается на тех же волнах,
// свет ложится по аналитическим нормалям, так что волны видны по затенению.
// shoreMap — из bakeShoreMap: по глубине волны гаснут у берега.
export function createWater(waves, { size = 440, segments = 176, shoreMap } = {}) {
  const geo = new THREE.PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const cell = size / segments;

  const uniforms = {
    uWaveDir: { value: Array.from({ length: MAX_COMP }, () => new THREE.Vector2()) },
    uWaveA: { value: new Float32Array(MAX_COMP) },
    uWaveK: { value: new Float32Array(MAX_COMP) },
    uWavePhase: { value: new Float32Array(MAX_COMP) },
    uWaveQ: { value: new Float32Array(MAX_COMP) },
    uCenter: { value: new THREE.Vector2() },
    uRadius: { value: size * 0.5 },
    uShoreTex: { value: shoreMap.texture },
    uShoreBounds: { value: shoreMap.bounds },
    uShoreDepth: { value: shoreMap.maxDepth },
  };
  const settings = { color: '#2f86b5' };

  const mat = new THREE.MeshLambertMaterial({ color: settings.color });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform vec2 uWaveDir[${MAX_COMP}]; uniform float uWaveA[${MAX_COMP}]; uniform float uWaveK[${MAX_COMP}];
        uniform float uWavePhase[${MAX_COMP}]; uniform float uWaveQ[${MAX_COMP}]; uniform vec2 uCenter; uniform float uRadius;
        ${SHORE_DAMP_GLSL}`)
      // beginnormal_vertex идёт раньше begin_vertex: здесь и смещение, и аналитическая нормаль
      .replace('#include <beginnormal_vertex>', `
        vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
        float edge = 1.0 - smoothstep(uRadius * 0.72, uRadius * 0.98, length(wp.xz - uCenter));
        // у берега волны затухают по глубине (как waves.damp на CPU): не выходят пластами на пляж
        edge *= shoreDampAt(wp.xz);
        vec3 disp = vec3(0.0); vec3 nd = vec3(0.0);
        for (int i = 0; i < ${MAX_COMP}; i++) {
          float th = uWaveK[i] * dot(uWaveDir[i], wp.xz) - uWavePhase[i];
          float c = cos(th), s = sin(th);
          float wa = uWaveK[i] * uWaveA[i];
          disp.xz += uWaveQ[i] * uWaveA[i] * uWaveDir[i] * c;
          disp.y += uWaveA[i] * s;
          nd.xz += uWaveDir[i] * wa * c;
          nd.y += uWaveQ[i] * wa * s;
        }
        // сетка только сдвигается, так что нормаль в объекте = мировая
        vec3 objectNormal = normalize(vec3(-nd.x * edge, 1.0 - nd.y * edge, -nd.z * edge));`)
      .replace('#include <begin_vertex>', `
        vec3 transformed = vec3(position) + disp * edge;`);
  };
  // чтобы кэш шейдера различал материал с инъекцией
  mat.customProgramCacheKey = () => 'cozy-water';

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;

  // Дальняя вода без волн — до горизонта, растворяется в тумане. Кольцо с дырой под ближней водой:
  // сплошная плоскость торчала бы из ложбин волн плоским полигоном. К краю ближней воды волны
  // гаснут (edge → 0), нормали там уже смотрят вверх — шва по освещению нет.
  const farMat = new THREE.MeshLambertMaterial({ color: settings.color });
  const far = new THREE.Mesh(
    new THREE.RingGeometry(size * 0.5 * 0.97, 3000, 64, 1).rotateX(-Math.PI / 2),
    farMat,
  );
  far.position.y = -0.08;
  far.receiveShadow = false;

  function update(w, cx, cz) {
    const sx = Math.round(cx / cell) * cell, sz = Math.round(cz / cell) * cell;
    mesh.position.set(sx, 0, sz);
    far.position.set(sx, -0.08, sz);
    uniforms.uCenter.value.set(sx, sz);
    for (let i = 0; i < MAX_COMP; i++) {
      uniforms.uWaveDir.value[i].set(w.dirX[i], w.dirZ[i]);
      uniforms.uWaveA.value[i] = w.amp[i];
      uniforms.uWaveK.value[i] = w.k[i];
      uniforms.uWavePhase.value[i] = w.phase[i];
      uniforms.uWaveQ.value[i] = w.q[i];
    }
    mat.color.set(settings.color); farMat.color.copy(mat.color);
  }

  return { mesh, far, update, uniforms, settings };
}
