export const earthVert = /* glsl */ `
varying vec2 vUv;
varying vec3 vPos;
varying vec3 vNormal;
varying vec3 vWorld;

void main() {
  vUv = uv;
  vPos = position;
  vNormal = normalize(normalMatrix * normal);
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const earthFrag = /* glsl */ `
uniform sampler2D tDay;
uniform sampler2D tNight;
uniform sampler2D tSpec;
uniform sampler2D tNormal;
uniform float uTime;
uniform vec3 uAccent;
uniform float uLive;
uniform float uScan;
uniform float uAlert;
uniform float uFrozen;
varying vec2 vUv;
varying vec3 vPos;
varying vec3 vNormal;
varying vec3 vWorld;

void main() {
  vec3 n = normalize(vNormal);
  vec3 bump = texture2D(tNormal, vUv).xyz * 2.0 - 1.0;
  n = normalize(n + bump * 0.35);

  vec3 light = normalize(vec3(0.22, 0.28, 0.92));
  vec3 view = normalize(cameraPosition - vWorld);
  float ndl = dot(n, light);
  float dayF = smoothstep(-0.2, 0.38, ndl);
  float nightF = 1.0 - dayF;
  float dusk = smoothstep(0.0, 0.22, dayF) * (1.0 - smoothstep(0.38, 0.88, dayF));

  vec3 dayC = texture2D(tDay, vUv).rgb;
  vec3 lights = texture2D(tNight, vUv).rgb;
  lights *= lights * 3.4;
  vec3 nightC = dayC * 0.09 + lights * mix(vec3(1.12), uAccent, 0.4);
  vec3 dayLit = dayC * (0.16 + 0.84 * smoothstep(-0.14, 1.0, ndl));
  dayLit += vec3(0.28, 0.12, 0.04) * dusk * 0.42;

  vec3 col = mix(nightC, dayLit, dayF);

  float specMask = texture2D(tSpec, vUv).r;
  vec3 halfV = normalize(light + view);
  float spec = pow(max(dot(n, halfV), 0.0), 48.0) * specMask * dayF;
  col += vec3(0.55, 0.78, 0.9) * spec * 0.72;

  float lon = vUv.x + uTime * 0.04;
  float scan = smoothstep(0.018, 0.0, abs(fract(lon) - 0.5)) * uScan;
  col += uAccent * scan * 0.55;

  vec2 hex = vUv * vec2(56.0, 28.0);
  float hx = abs(fract(hex.x) - 0.5);
  float hy = abs(fract(hex.y + 0.5 * floor(hex.x)) - 0.5);
  float hexLine = smoothstep(0.07, 0.02, min(hx, hy));
  col += uAccent * hexLine * 0.07 * nightF * uLive;

  float fres = pow(1.0 - abs(dot(view, normalize(vNormal))), 2.2);
  col += uAccent * fres * (0.14 + 0.28 * uAlert);

  float facing = max(dot(normalize(vNormal), view), 0.0);
  float bowl = mix(1.0, 0.48, pow(facing, 1.25));
  float rim = mix(0.72, 1.0, pow(1.0 - facing, 1.1));
  col *= bowl * rim;

  float g = dot(col, vec3(0.22, 0.48, 0.08));
  col = mix(col, vec3(g * 0.7, g * 0.78, g * 0.85), uFrozen * 0.72);
  col *= 0.78 + 0.22 * uLive;

  gl_FragColor = vec4(col, 1.0);
}
`;

export const atmoVert = /* glsl */ `
varying vec3 vNormal;
varying vec3 vWorld;
void main() {
  vNormal = normalize(normalMatrix * normal);
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const atmoFrag = /* glsl */ `
uniform vec3 uAccent;
uniform float uFrozen;
uniform float uAlert;
uniform float uLive;
varying vec3 vNormal;
varying vec3 vWorld;

void main() {
  vec3 view = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - abs(dot(view, normalize(vNormal))), 2.05);
  vec3 col = mix(uAccent, vec3(0.38, 0.55, 0.82), 0.4 + 0.4 * uFrozen);
  float a = smoothstep(0.08, 0.92, fres) * (0.22 + 0.18 * uLive + 0.28 * uAlert);
  gl_FragColor = vec4(col * (0.35 + 0.65 * fres), a);
}
`;

export const cloudVert = /* glsl */ `
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorld;
void main() {
  vUv = uv;
  vNormal = normalize(normalMatrix * normal);
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const cloudFrag = /* glsl */ `
uniform sampler2D tClouds;
uniform vec3 uAccent;
uniform float uLive;
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorld;

void main() {
  float c = texture2D(tClouds, vUv).r;
  vec3 view = normalize(cameraPosition - vWorld);
  float ndl = max(dot(normalize(vNormal), normalize(vec3(0.68, 0.18, 0.52))), 0.0);
  vec3 col = mix(vec3(0.75, 0.82, 0.88), uAccent, 0.08 * uLive);
  float a = c * (0.1 + 0.16 * ndl);
  float fres = pow(1.0 - abs(dot(view, normalize(vNormal))), 3.0);
  a *= 1.0 - fres * 0.35;
  gl_FragColor = vec4(col, a);
}
`;
