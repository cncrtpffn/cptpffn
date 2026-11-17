import * as THREE from 'three';
import { WAKE_POINTS, FX_UNIFORMS_GLSL, NOISE_GLSL, WAKE_GLSL, GLINT_GLSL } from './water-fx.js';

// Вода: MeshStandardMaterial + вершинный шейдер Герстнера (те же параметры, что в физике).
// Плоское затенение даёт гранёный low-poly вид; цвет по высоте с пятнами оттенка,
// рваная пена на гребнях и полосы по ветру, кильватерный след, блики солнца.
export function createWater(waves, { size = 440, segments = 176 } = {}) {
  const geo = new THREE.PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const cell = size / segments;

  const uniforms = {
    uWaveDir: { value: [new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2(), new THREE.Vector2()] },
    uWaveA: { value: new Float32Array(4) },
    uWaveK: { value: new Float32Array(4) },
    uWavePhase: { value: new Float32Array(4) },
    uWaveQ: { value: new Float32Array(4) },
    uCenter: { value: new THREE.Vector2() },
    uRadius: { value: size * 0.5 },
    uAmp: { value: 0.3 },
    uDeep: { value: new THREE.Color(0x1f6f9f) },
    uShallow: { value: new THREE.Color(0x4fb3d9) },
    uFoam: { value: new THREE.Color(0xf4fbff) },
    uTime: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3) },
    uSunColor: { value: new THREE.Color(0xffffff) },
    uWindDir: { value: new THREE.Vector2(0, 1) },
    uWhitecap: { value: 0 },
    uTrail: { value: Array.from({ length: WAKE_POINTS }, () => new THREE.Vector4()) },
    uTrailCount: { value: 0 },
    uWakeCenter: { value: new THREE.Vector2() },
  };

  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.38, metalness: 0.02, flatShading: true,
    transparent: true, opacity: 0.94,
  });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        uniform vec2 uWaveDir[4]; uniform float uWaveA[4]; uniform float uWaveK[4];
        uniform float uWavePhase[4]; uniform float uWaveQ[4]; uniform vec2 uCenter; uniform float uRadius;
        varying float vWaveH; varying float vSteep; varying vec3 vWorldPos;`)
      .replace('#include <begin_vertex>', `
        vec3 transformed = vec3(position);
        vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
        float edge = 1.0 - smoothstep(uRadius * 0.72, uRadius * 0.98, length(wp.xz - uCenter));
        vec3 disp = vec3(0.0); float steep = 0.0;
        for (int i = 0; i < 4; i++) {
          float th = uWaveK[i] * dot(uWaveDir[i], wp.xz) - uWavePhase[i];
          float c = cos(th), s = sin(th);
          disp.xz += uWaveQ[i] * uWaveA[i] * uWaveDir[i] * c;
          disp.y += uWaveA[i] * s;
          steep += uWaveA[i] * uWaveK[i] * s;
        }
        transformed += disp * edge;
        vWaveH = disp.y * edge; vSteep = steep * edge;
        vWorldPos = wp + disp * edge;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uFoam; uniform float uAmp;
        varying float vWaveH; varying float vSteep;
        ${FX_UNIFORMS_GLSL}${NOISE_GLSL}${WAKE_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float hh = smoothstep(-uAmp, uAmp, vWaveH);
        diffuseColor.rgb *= mix(uDeep, uShallow, hh);
        vec2 wxz = vWorldPos.xz;
        // крупные пятна оттенка, медленно дрейфуют
        float tint = vnoise(wxz * 0.025 + uTime * 0.012) * 0.65 + vnoise(wxz * 0.11 - uTime * 0.03) * 0.35;
        diffuseColor.rgb *= mix(vec3(0.88, 0.98, 1.05), vec3(1.07, 1.03, 0.92), tint);
        // барашки: порог ниже при сильном ветре, рваные шумом
        vec2 drift = uWindDir * uTime * 0.6;
        float lo = mix(0.36, 0.2, uWhitecap);
        float crest = smoothstep(lo, lo + 0.18, vSteep);
        crest *= smoothstep(0.45, 0.65, vnoise(wxz * 0.7 - drift) * 0.7 + vnoise(wxz * 2.3 + drift) * 0.3 + crest * 0.2);
        // полосы пены вдоль ветра
        vec2 wperp = vec2(-uWindDir.y, uWindDir.x);
        float sn = vnoise(vec2(dot(wxz, uWindDir) * 0.07, dot(wxz, wperp) * 0.9) - vec2(uTime * 0.05, 0.0));
        float streak = smoothstep(0.8, 0.9, sn) * uWhitecap * 0.35 * smoothstep(-0.3, 0.4, hh);
        float waterFoam = clamp(max(max(crest * 0.85, streak), wakeFoam(wxz)), 0.0, 1.0);
        diffuseColor.rgb = mix(diffuseColor.rgb, uFoam, waterFoam);`)
      .replace('#include <opaque_fragment>', `${GLINT_GLSL}
        #include <opaque_fragment>`);
  };
  // чтобы кэш шейдера различал материал с инъекцией
  mat.customProgramCacheKey = () => 'cozy-water';

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;

  // Дальняя вода без волн — до горизонта, растворяется в тумане. Кольцо с дырой под ближней водой:
  // сплошная плоскость торчала бы из ложбин волн плоским полигоном.
  const far = new THREE.Mesh(
    new THREE.RingGeometry(size * 0.5 * 0.97, 3000, 64, 1).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x3a98c4, roughness: 0.5, metalness: 0.02 }),
  );
  far.position.y = -0.08;
  far.receiveShadow = false;

  function update(w, cx, cz, fx) {
    const sx = Math.round(cx / cell) * cell, sz = Math.round(cz / cell) * cell;
    mesh.position.set(sx, 0, sz);
    far.position.set(sx, -0.08, sz);
    uniforms.uCenter.value.set(sx, sz);
    for (let i = 0; i < 4; i++) {
      uniforms.uWaveDir.value[i].set(w.dirX[i], w.dirZ[i]);
      uniforms.uWaveA.value[i] = w.amp[i];
      uniforms.uWaveK.value[i] = w.k[i];
      uniforms.uWavePhase.value[i] = w.phase[i];
      uniforms.uWaveQ.value[i] = w.q[i];
    }
    uniforms.uAmp.value = Math.max(0.15, w.maxAmplitude());
    if (fx) {
      uniforms.uTime.value = fx.time;
      uniforms.uSunDir.value.copy(fx.sunDir);
      uniforms.uSunColor.value.copy(fx.sunColor);
      if (Math.hypot(fx.windDir.x, fx.windDir.z) > 0.01) uniforms.uWindDir.value.set(fx.windDir.x, fx.windDir.z).normalize();
      uniforms.uWhitecap.value = fx.whitecap;
      uniforms.uTrail.value = fx.wake.trail;
      uniforms.uTrailCount.value = fx.wake.count;
      uniforms.uWakeCenter.value.copy(fx.wake.center);
    }
  }

  return { mesh, far, update, uniforms };
}
