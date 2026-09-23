export const stageEarthVert = /* glsl */ `
varying vec2 vUv;
varying vec3 vWorldNormal;
varying vec3 vWorld;

void main() {
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

/** Night marble. The facing disc is the night map; day is a sliver on the limb. */
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
  vec3 nb = normalize(n + bump * 0.45);

  vec3 sun = normalize(uSunDir);
  vec3 view = normalize(cameraPosition - vWorld);
  float ndl = dot(nb, sun);

  vec3 nt = texture2D(tNight, vUv).rgb;
  nt = max(nt - vec3(0.015), 0.0);
  // #ffd89a. Intensity lives in uLights (about 2).
  vec3 lights = nt * vec3(1.0, 0.847, 0.604) * uLights;

  // Oceans stay black. No earthshine from the day plate.
  vec3 col = lights;

  // Thin terminator only. The facing disc (ndl well below zero) gets none of it.
  float term = smoothstep(-0.02, 0.06, ndl) * (1.0 - smoothstep(0.06, 0.16, ndl));
  vec3 dayC = texture2D(tDay, vUv).rgb;
  col = mix(col, dayC * vec3(0.55, 0.50, 0.42), term * 0.55);

  float ocean = texture2D(tSpec, vUv).r;
  vec3 halfV = normalize(sun + view);
  float spec = pow(max(dot(nb, halfV), 0.0), 56.0) * ocean;
  spec *= smoothstep(-0.05, 0.35, ndl);
  col += vec3(0.82, 0.90, 0.95) * spec * 0.28;

  gl_FragColor = vec4(col, 1.0);
}
`;

export const stageCloudVert = stageEarthVert;

/** Clouds stay faint and go nearly black on the night side so they don't fog the lights. */
export const stageCloudFrag = /* glsl */ `
uniform sampler2D tCloud;
uniform vec3 uSunDir;
varying vec2 vUv;
varying vec3 vWorldNormal;
varying vec3 vWorld;

void main() {
  vec3 n = normalize(vWorldNormal);
  float ndl = dot(n, normalize(uSunDir));
  float night = 1.0 - smoothstep(-0.15, 0.25, ndl);
  float c = texture2D(tCloud, vUv).r;
  float alpha = c * 0.10 * (1.0 - 0.88 * night);
  gl_FragColor = vec4(vec3(0.75, 0.78, 0.82), alpha);
}
`;

export const stageAtmoVert = /* glsl */ `
varying vec3 vWorldNormal;
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

/** Tight teal limb. #5eead4. Not a haze plane. */
export const stageAtmoFrag = /* glsl */ `
varying vec3 vWorldNormal;
varying vec3 vWorld;

void main() {
  vec3 n = normalize(vWorldNormal);
  vec3 view = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - abs(dot(view, n)), 5.2);
  vec3 teal = vec3(0.369, 0.918, 0.831);
  float a = smoothstep(0.25, 1.0, fres);
  gl_FragColor = vec4(teal * fres * 1.35, a);
}
`;
