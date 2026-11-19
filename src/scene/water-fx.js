import { SHORE_DAMP } from './shore-map.js';

// GLSL-фрагменты: шум (небо, облака) и гашение волн у берега (вода).

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

// Гашение волн у берега для вершинного шейдера: синхронно с shoreDamp в shore-map.js.
export const SHORE_DAMP_GLSL = `
  uniform sampler2D uShoreTex; uniform vec4 uShoreBounds; uniform float uShoreDepth;
  float shoreDampAt(vec2 p) {
    vec2 uv = (p - uShoreBounds.xy) / uShoreBounds.zw;
    if (any(lessThan(uv, vec2(0.0))) || any(greaterThan(uv, vec2(1.0)))) return 1.0;
    float depth = texture2D(uShoreTex, uv).g * uShoreDepth;
    return ${SHORE_DAMP.min.toFixed(3)} + ${(1 - SHORE_DAMP.min).toFixed(3)} * smoothstep(0.0, ${SHORE_DAMP.depth.toFixed(3)}, depth);
  }
`;
