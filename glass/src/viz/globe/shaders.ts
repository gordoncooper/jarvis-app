export const earthVert = /* glsl */ `
varying vec3 vPos;
varying vec3 vNormal;
varying vec3 vWorld;

void main() {
  vPos = position;
  vNormal = normalize(normalMatrix * normal);
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const earthFrag = /* glsl */ `
uniform float uTime;
uniform vec3 uAccent;
uniform vec3 uInk;
uniform float uLive;
uniform float uScan;
uniform float uAlert;
uniform float uFrozen;
varying vec3 vPos;
varying vec3 vNormal;
varying vec3 vWorld;

float hash(vec3 p) {
  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);
}

float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i), hash(i + vec3(1.0, 0.0, 0.0)), f.x),
        mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x),
        mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
    f.z
  );
}

float fbm(vec3 p) {
  float a = 0.0;
  float w = 0.5;
  for (int i = 0; i < 6; i++) {
    a += w * noise(p);
    p = p * 2.13;
    w *= 0.5;
  }
  return a;
}

void main() {
  vec3 n = normalize(vPos);
  vec3 light = normalize(vec3(0.62, 0.22, 0.72));
  float ndotl = clamp(dot(n, light), 0.0, 1.0);
  float night = 1.0 - smoothstep(0.0, 0.28, ndotl);

  vec3 warped = n + 0.18 * vec3(noise(n * 1.7), noise(n * 1.7 + 4.1), noise(n * 1.7 + 8.3));
  float continents = fbm(warped * 2.05 + vec3(0.31, -0.12, 0.44));
  float land = smoothstep(0.50, 0.58, continents);
  float poles = smoothstep(0.74, 0.9, abs(n.y));
  float coast = smoothstep(0.0, 0.12, land) * (1.0 - smoothstep(0.12, 0.35, land));

  vec3 ocean = vec3(0.012, 0.04, 0.05);
  vec3 deep = vec3(0.006, 0.014, 0.02);
  vec3 ground = vec3(0.05, 0.09, 0.1);
  vec3 ice = vec3(0.38, 0.46, 0.5);
  vec3 col = mix(mix(deep, ocean, 0.4 + 0.6 * ndotl), ground, land);
  col = mix(col, ice, poles * (0.55 + 0.45 * land));
  col += uAccent * coast * 0.22 * uLive;

  float cities = step(0.987, hash(floor(n * 180.0))) * land * night;
  col += uAccent * cities * (0.7 + 0.3 * uLive);

  float lon = atan(n.z, n.x);
  float scanLine = abs(fract(lon / 6.2831853 + uTime * 0.12) - 0.5);
  float scan = smoothstep(0.045, 0.0, scanLine) * uScan;
  col += uAccent * scan * 0.65;

  float lat = abs(n.y);
  float gridLat = smoothstep(0.012, 0.0, abs(fract(lat * 12.0) - 0.5) - 0.46);
  float gridLon = smoothstep(0.012, 0.0, abs(fract((lon / 3.14159 + 1.0) * 6.0) - 0.5) - 0.46);
  col += uAccent * (gridLat + gridLon) * 0.07 * uLive;

  vec3 view = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - abs(dot(view, normalize(vNormal))), 2.8);
  col += uAccent * fres * (0.12 + 0.2 * uAlert);

  float shade = 0.16 + 0.84 * ndotl;
  col *= mix(0.45, shade, 1.0 - night * 0.55);
  col = mix(col, vec3(0.22, 0.26, 0.3), uFrozen * 0.55);
  col = mix(col, uInk, 0.04);

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
  float fres = pow(1.0 - abs(dot(view, normalize(vNormal))), 2.2);
  vec3 col = mix(uAccent, vec3(0.55, 0.62, 0.7), uFrozen);
  float a = fres * (0.42 + 0.28 * uLive + 0.35 * uAlert);
  gl_FragColor = vec4(col * fres, a);
}
`;
