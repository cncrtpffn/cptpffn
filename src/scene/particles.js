import * as THREE from 'three';
import { createPool } from './particle-pool.js';

// непрозрачность клуба пыли; капля-спрайт почти непрозрачна
const MIST_OPACITY = 0.5, DROP_SPRITE_OPACITY = 0.9;
// дальше этого от камеры капля рисуется спрайтом, а не икосаэдром (LOD)
const DROP_LOD = 30;
// минимальный угловой размер капли-спрайта (рад, ~2–3 px): брызги у далёкого берега не тонут в субпикселе
const DROP_SPRITE_MIN = 0.0025;

// Общая система брызг: эмиттеры (нос, прибой, гребни) кладут частицы в два пула —
//   drop — low-poly капли, падают по баллистике и гибнут в воде;
//   mist — водяная пыль: мягкие спрайты, их подхватывает ветер, расплываются и тают.
// Спрайты рисуют и пыль, и далёкие капли. scale — доля частиц от эмиттеров (на таче меньше).
export function createParticles({ scale = 1, maxDrops = 1500, maxMist = 1200 } = {}) {
  const drop = createPool(maxDrops, { gravity: 9.81, drag: 0.9 });
  const mist = createPool(maxMist, { gravity: 0.6, drag: 2.5 });
  const maxSprites = maxMist + maxDrops;

  const dropMesh = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 0),
    new THREE.MeshStandardMaterial({ color: 0xf4fbff, roughness: 0.5, flatShading: true, emissive: 0x5a7a8a, emissiveIntensity: 0.35 }),
    maxDrops,
  );

  const fade = new THREE.InstancedBufferAttribute(new Float32Array(maxSprites), 1);
  const minSize = new THREE.InstancedBufferAttribute(new Float32Array(maxSprites), 1);
  const quad = new THREE.PlaneGeometry(1, 1);
  quad.setAttribute('aFade', fade);
  quad.setAttribute('aMin', minSize);
  const spriteMat = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTint: { value: new THREE.Color(1, 1, 1) } }]),
    vertexShader: /* glsl */`
      attribute float aFade; attribute float aMin;
      varying float vFade; varying float vDrop; varying vec2 vUv;
      #include <fog_pars_vertex>
      void main() {
        vUv = position.xy * 2.0;
        vec4 mvPosition = modelViewMatrix * vec4(instanceMatrix[3].xyz, 1.0);
        float dist = max(-mvPosition.z, 0.01);
        // размер на экране: снизу — для далёких капель, сверху — клуб не шире ~1/5 поля зрения
        float s = clamp(instanceMatrix[0].x, dist * aMin, dist * 0.2);
        // вплотную к камере пыль гаснет: нет слоёв полупрозрачности на весь экран
        vFade = aFade * smoothstep(0.6, 2.5, dist);
        vDrop = step(1e-6, aMin);
        // квад всегда лицом к камере
        mvPosition.xy += position.xy * s;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uTint;
      varying float vFade; varying float vDrop; varying vec2 vUv;
      #include <fog_pars_fragment>
      void main() {
        float r2 = dot(vUv, vUv);
        if (r2 > 1.0 || vFade < 0.004) discard;
        float a = 1.0 - r2;
        // пыль — мягкий клуб; капля-спрайт — плотная светлая точка
        gl_FragColor = vec4(uTint * (1.0 + 0.3 * vDrop), mix(a * a, smoothstep(0.0, 0.4, a), vDrop) * vFade);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    fog: true,
  });
  const spriteMesh = new THREE.InstancedMesh(quad, spriteMat, maxSprites);
  // вода тоже прозрачная; прозрачные сортируются по центру объекта, а центр спрайтов —
  // начало координат, поэтому без renderOrder вода рисовалась поверх брызг
  spriteMesh.renderOrder = 1;

  // InstancedMesh начинает с единичных матриц; дальше пишем только масштаб на диагональ и позицию
  for (const mesh of [dropMesh, spriteMesh]) {
    mesh.frustumCulled = false;
    mesh.count = 0;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  }
  fade.setUsage(THREE.DynamicDrawUsage);
  minSize.setUsage(THREE.DynamicDrawUsage);

  const settings = { enabled: true, strength: 1, bow: true, shore: true, crest: true };
  const stats = { drops: 0, mist: 0, lod: 0, ms: 0 };
  const sky = new THREE.Color();

  function put(a, i, x, y, z, s) {
    const o = i * 16;
    a[o] = a[o + 5] = a[o + 10] = s;
    a[o + 12] = x; a[o + 13] = y; a[o + 14] = z;
  }

  // загружать на видеокарту только живые инстансы
  function upload(attr, count, size) {
    attr.clearUpdateRanges();
    if (count) attr.addUpdateRange(0, count * size);
    attr.needsUpdate = true;
  }

  // сколько частиц выпускать относительно номинала: 0 — источник выключен
  function amount(source) {
    return settings.enabled && settings[source] ? settings.strength * scale : 0;
  }

  function update(dt, { waves, wind, env, camera }) {
    const t0 = performance.now();
    if (dt > 0) {
      const w = wind.vector();
      const top = waves.maxAmplitude();
      // капля гибнет, уйдя под воду; heightAt дорог, поэтому сначала дешёвая проверка
      drop.step(dt, w.x, w.z, (i) => drop.vy[i] < 0 && drop.py[i] < top && drop.py[i] < waves.heightAt(drop.px[i], drop.pz[i]) - 0.05);
      mist.step(dt, w.x, w.z, null);
    }
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
    const da = dropMesh.instanceMatrix.array, sa = spriteMesh.instanceMatrix.array;
    let nd = 0, ns = 0;
    for (let i = 0; i < mist.alive; i++) {
      put(sa, ns, mist.px[i], mist.py[i], mist.pz[i], mist.size[i]);
      // быстро проявляется и медленно тает
      const t = mist.life[i] / mist.maxLife[i];
      fade.array[ns] = MIST_OPACITY * Math.min(1, (1 - t) / 0.12) * Math.pow(t, 0.8);
      minSize.array[ns++] = 0;
    }
    for (let i = 0; i < drop.alive; i++) {
      const x = drop.px[i], y = drop.py[i], z = drop.pz[i];
      const k = Math.sqrt(drop.life[i] / drop.maxLife[i]);
      const dx = x - cx, dy = y - cy, dz = z - cz;
      if (dx * dx + dy * dy + dz * dz < DROP_LOD * DROP_LOD) {
        put(da, nd++, x, y, z, drop.size[i] * k);
      } else {
        put(sa, ns, x, y, z, drop.size[i] * 1.5);
        fade.array[ns] = DROP_SPRITE_OPACITY * k;
        minSize.array[ns++] = DROP_SPRITE_MIN;
      }
    }
    dropMesh.count = nd;
    spriteMesh.count = ns;
    upload(dropMesh.instanceMatrix, nd, 16);
    upload(spriteMesh.instanceMatrix, ns, 16);
    upload(fade, ns, 1);
    upload(minSize, ns, 1);
    // спрайты освещены небом и солнцем, как матовый белый шар
    if (env) {
      sky.copy(env.hemi.color).multiplyScalar(env.hemi.intensity);
      spriteMat.uniforms.uTint.value.copy(env.sun.color).multiplyScalar(env.sun.intensity * Math.max(0, env.sunDir.y) * 0.45).add(sky);
    }
    stats.drops = drop.alive; stats.mist = mist.alive; stats.lod = ns - mist.alive;
    stats.ms = performance.now() - t0;
  }

  function clear() { drop.clear(); mist.clear(); }

  return { drop, mist, meshes: [dropMesh, spriteMesh], settings, amount, update, clear, stats };
}
