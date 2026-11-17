// GLSL-фрагменты для воды: шум, кильватерный след, блики. Подключаются в water.js.

export const WAKE_POINTS = 40;

export const FX_UNIFORMS_GLSL = `
  uniform float uTime; uniform vec3 uSunDir; uniform vec3 uSunColor;
  uniform vec2 uWindDir; uniform float uWhitecap;
  uniform vec4 uTrail[${WAKE_POINTS}]; uniform int uTrailCount; uniform vec2 uWakeCenter;
  varying vec3 vWorldPos; varying vec3 vWaveN;
`;

export const NOISE_GLSL = `
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
               mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
  }
`;

// След: точки uTrail (x, z, возраст, скорость) записаны у форштевня, от новой к старой.
// Усы Кельвина расходятся под ~19.5°, за кормой — турбулентная полоса.
export const WAKE_GLSL = `
  float wakeFoam(vec2 p) {
    if (uTrailCount < 2 || distance(p, uWakeCenter) > 80.0) return 0.0;
    float n = vnoise(p * 1.4 + uTime * 0.15);
    float f = 0.0;
    for (int i = 0; i < ${WAKE_POINTS - 1}; i++) {
      if (i >= uTrailCount - 1) break;
      vec4 A = uTrail[i], B = uTrail[i + 1];
      vec2 ab = B.xy - A.xy;
      float l2 = dot(ab, ab);
      if (l2 < 1e-4) continue;
      // только поперечное расстояние в пределах сегмента — иначе на концах получаются кольца
      float t = dot(p - A.xy, ab) / l2;
      if (t < -0.02 || t > 1.02) continue;
      float d = abs(ab.x * (p.y - A.y) - ab.y * (p.x - A.x)) / sqrt(l2);
      t = clamp(t, 0.0, 1.0);
      float a = mix(A.z, B.z, t), s = mix(A.w, B.w, t);
      float sk = clamp(s / 3.0, 0.0, 1.0);
      // усы
      float w = 0.5 + s * a * 0.354;
      float arm = 1.0 - smoothstep(0.0, 0.22 + 0.09 * a, abs(d - w));
      arm *= (1.0 - smoothstep(4.0, 12.0, a)) * smoothstep(0.05 * a, 0.05 * a + 0.35, n);
      // турбулентная полоса за кормой
      float wash = 1.0 - smoothstep(0.0, 0.55 + 0.14 * a, d);
      wash *= smoothstep(2.0, 3.2, s * a) * (1.0 - smoothstep(1.5, 6.0, a)) * smoothstep(0.1 * a, 0.1 * a + 0.35, n);
      f = max(f, (arm * 0.9 + wash * 0.8) * sk);
    }
    return f;
  }
`;

// Блики солнца: мягкий отблеск на гранях + мерцающие искры.
export const GLINT_GLSL = `
  {
    vec3 nf = normalize(vWaveN);
    vec3 vd = normalize(cameraPosition - vWorldPos);
    float rl = max(dot(reflect(-vd, nf), normalize(uSunDir)), 0.0);
    // отблеск волн — пятнами, а не по всей поверхности сразу
    float sheen = pow(rl, 300.0) * 0.45 * smoothstep(0.45, 0.75, vnoise(vWorldPos.xz * 0.08 + uTime * 0.05));
    // искра — маленькая точка в случайном месте ячейки
    vec2 g = vWorldPos.xz * 1.6;
    vec2 cell = floor(g);
    float h = hash12(cell);
    vec2 c = vec2(hash12(cell + 17.0), hash12(cell + 31.0)) * 0.6 + 0.2;
    float dot_ = 1.0 - smoothstep(0.04, 0.1, length(fract(g) - c));
    float tw = max(0.0, sin(uTime * (3.0 + h * 6.0) + h * 40.0));
    float sparkle = step(0.75, h) * dot_ * tw * pow(rl, 16.0) * 3.0;
    outgoingLight += uSunColor * (sheen + sparkle) * (1.0 - waterFoam);
  }
`;
