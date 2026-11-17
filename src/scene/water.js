import * as THREE from 'three';

// Вода: MeshStandardMaterial + вершинный шейдер Герстнера (те же параметры, что в физике).
// Плоское затенение даёт гранёный low-poly вид; цвет по высоте, пена на крутых гребнях.
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
        varying float vWaveH; varying float vSteep;`)
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
        vWaveH = disp.y * edge; vSteep = steep * edge;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uFoam; uniform float uAmp;
        varying float vWaveH; varying float vSteep;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float hh = smoothstep(-uAmp, uAmp, vWaveH);
        diffuseColor.rgb *= mix(uDeep, uShallow, hh);
        float foam = smoothstep(0.2, 0.42, vSteep);
        diffuseColor.rgb = mix(diffuseColor.rgb, uFoam, foam * 0.85);`);
  };
  // чтобы кэш шейдера различал материал с инъекцией
  mat.customProgramCacheKey = () => 'cozy-water';

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;

  // Дальняя вода без волн — до горизонта, растворяется в тумане.
  const far = new THREE.Mesh(
    new THREE.PlaneGeometry(6000, 6000, 1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x3a98c4, roughness: 0.5, metalness: 0.02 }),
  );
  far.position.y = -0.05;
  far.receiveShadow = false;

  function update(w, cx, cz) {
    const sx = Math.round(cx / cell) * cell, sz = Math.round(cz / cell) * cell;
    mesh.position.set(sx, 0, sz);
    far.position.set(cx, -0.05, cz);
    uniforms.uCenter.value.set(sx, sz);
    for (let i = 0; i < 4; i++) {
      uniforms.uWaveDir.value[i].set(w.dirX[i], w.dirZ[i]);
      uniforms.uWaveA.value[i] = w.amp[i];
      uniforms.uWaveK.value[i] = w.k[i];
      uniforms.uWavePhase.value[i] = w.phase[i];
      uniforms.uWaveQ.value[i] = w.q[i];
    }
    uniforms.uAmp.value = Math.max(0.15, w.maxAmplitude());
  }

  return { mesh, far, update, uniforms };
}
