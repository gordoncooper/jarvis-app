export const stageEarthVert = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorldNormal;
varying vec3 vWorld;

void main() {
  vUv = uv;
  // World-space normal: the lit crescent must stay put on the disc while the
  // globe spins underneath it. An object-space normal would sweep the
  // terminator across the camera and hand us a daylight Earth half the time.
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

/** Night Earth: gold city lights, a thin dawn crescent on the limb. */
export const stageEarthFrag = /* glsl */ `
uniform sampler2D tDay;
uniform sampler2D tNight;
uniform sampler2D tSpec;
uniform sampler2D tNormal;
uniform vec3 uSunDir;
uniform float uLights;
varying vec2 vUv;
varying vec3 vWorldNormal;
varying vec3 vWorld;

void main() {
  vec3 n = normalize(vWorldNormal);
  vec3 bump = texture2D(tNormal, vUv).xyz * 2.0 - 1.0;
  vec3 nb = normalize(n + bump * 0.22);

  vec3 sun = normalize(uSunDir);
  vec3 view = normalize(cameraPosition - vWorld);

  float ndl = dot(nb, sun);
  // Narrow terminator: most of the facing disc stays night.
  float dayF = smoothstep(-0.04, 0.26, ndl);
  // Tight dawn band: a wide one washes the whole limb orange.
  float dusk = smoothstep(-0.11, 0.0, ndl) * (1.0 - smoothstep(0.0, 0.17, ndl));

  vec3 dayC = texture2D(tDay, vUv).rgb;

  // City lights only where the sun is actually down, ramped through dusk.
  float nightMask = 1.0 - smoothstep(-0.14, 0.12, ndl);
  // night.jpg is not a clean black marble: it carries a blue-teal terrain base
  // (Sahara and Antarctica both read ~(11,59,81)) that lights the whole globe
  // if used raw. Real cities are the near-neutral, red-carrying pixels, so pull
  // the lights out by how far red runs ahead of that blue floor.
  vec3 nt = texture2D(tNight, vUv).rgb;
  float city = max(nt.r - 0.28 * nt.b - 0.02, 0.0);
  city = pow(city, 0.85);
  vec3 gold = vec3(1.0, 0.78, 0.44);
  vec3 lights = gold * city * uLights * nightMask;

  // Faint earthshine so continents read against the ocean on the dark side.
  // Desaturated and compressed, or bright deserts glow like they are still lit.
  vec3 ash = mix(vec3(dot(dayC, vec3(0.299, 0.587, 0.114))), dayC, 0.4);
  vec3 nightBase = min(ash, vec3(0.55)) * vec3(0.20, 0.225, 0.30);
  vec3 nightC = nightBase + lights;

  vec3 dayLit = dayC * (0.10 + 1.05 * smoothstep(-0.05, 0.85, ndl));
  vec3 col = mix(nightC, dayLit, dayF);

  // Dawn band along the terminator.
  col += vec3(1.0, 0.58, 0.28) * dusk * 0.26;

  // Sun glint on water, gated by daylight so it cannot bloom over the night side.
  float specMask = texture2D(tSpec, vUv).r;
  vec3 halfV = normalize(sun + view);
  float spec = pow(max(dot(nb, halfV), 0.0), 64.0) * specMask * dayF;
  col += vec3(1.0, 0.94, 0.82) * spec * 0.18;

  // Rim: cool scatter everywhere, warm only where the sun is up.
  float fres = pow(1.0 - abs(dot(view, n)), 3.4);
  col += vec3(0.26, 0.46, 0.78) * fres * 0.22;
  col += vec3(1.0, 0.66, 0.36) * fres * dayF * 0.10;

  gl_FragColor = vec4(col, 1.0);
}
`;

export const stageAtmoVert = /* glsl */ `
varying vec3 vWorldNormal;
varying vec3 vWorld;
void main() {
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

/** Atmospheric limb. Bright blue where the sun is up, deep indigo on the night side. */
export const stageAtmoFrag = /* glsl */ `
uniform vec3 uSunDir;
varying vec3 vWorldNormal;
varying vec3 vWorld;

void main() {
  vec3 n = normalize(vWorldNormal);
  vec3 view = normalize(cameraPosition - vWorld);
  vec3 sun = normalize(uSunDir);

  float fres = pow(1.0 - abs(dot(view, n)), 4.2);
  float lit = smoothstep(-0.30, 0.25, dot(n, sun));

  vec3 nightCol = vec3(0.10, 0.20, 0.42);
  vec3 dayCol = vec3(0.55, 0.78, 1.0);
  vec3 col = mix(nightCol, dayCol, lit);

  float a = smoothstep(0.30, 1.0, fres) * (0.08 + lit * 1.05);
  gl_FragColor = vec4(col * (0.35 + 0.85 * fres), a);
}
`;
