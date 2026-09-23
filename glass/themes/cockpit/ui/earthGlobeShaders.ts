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

/** Night side over the facing disc, daylight only on the upper limb.
 *  The day plate is crushed so continents still read in the dark. */
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
  vec3 nb = normalize(n + bump * 0.35);

  vec3 sun = normalize(uSunDir);
  vec3 view = normalize(cameraPosition - vWorld);
  float ndl = dot(nb, sun);

  vec3 dayC = texture2D(tDay, vUv).rgb;
  float ocean = texture2D(tSpec, vUv).r;

  // Dark marble: land a touch lighter than ocean so the coastlines survive.
  vec3 land = dayC * vec3(0.055, 0.062, 0.07);
  vec3 sea = dayC * vec3(0.012, 0.02, 0.045);
  vec3 base = mix(land, sea, smoothstep(0.2, 0.65, ocean));
  base = min(base, vec3(0.07));

  vec3 nt = texture2D(tNight, vUv).rgb;
  nt = max(nt - vec3(0.02), 0.0);
  float nightMask = 1.0 - smoothstep(-0.08, 0.22, ndl);
  vec3 lights = nt * vec3(1.0, 0.78, 0.42) * uLights * nightMask;

  vec3 col = base + lights;

  float dayF = smoothstep(0.05, 0.85, ndl);
  vec3 dayLit = dayC * (0.08 + 0.45 * max(ndl, 0.0));
  col = mix(col, dayLit, dayF * 0.22);

  vec3 halfV = normalize(sun + view);
  float spec = pow(max(dot(nb, halfV), 0.0), 48.0) * ocean * dayF;
  col += vec3(0.75, 0.86, 1.0) * spec * 0.18;

  gl_FragColor = vec4(col, 1.0);
}
`;

export const stageCloudVert = stageEarthVert;

export const stageCloudFrag = /* glsl */ `
uniform sampler2D tCloud;
uniform vec3 uSunDir;
varying vec2 vUv;
varying vec3 vWorldNormal;

void main() {
  float ndl = dot(normalize(vWorldNormal), normalize(uSunDir));
  float lit = smoothstep(-0.35, 0.45, ndl);
  float c = texture2D(tCloud, vUv).r;
  float alpha = c * mix(0.16, 0.55, lit);
  vec3 col = mix(vec3(0.45, 0.5, 0.58), vec3(0.9, 0.93, 0.97), lit);
  gl_FragColor = vec4(col, alpha);
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

/** One layer, in front of the planet. Impact parameter x is 0 on the limb,
 *  negative over the disc, positive out in space. One curve, so the face and
 *  the tail cannot form two edges. */
export const stageAtmoFrag = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uCenter;
uniform float uEarthR;
uniform float uAtmoR;
varying vec3 vWorld;

void main() {
  vec3 sun = normalize(uSunDir);
  vec3 ro = cameraPosition - uCenter;
  vec3 rd = normalize(vWorld - cameraPosition);
  float dist = length(cross(rd, ro));
  float span = max(uAtmoR - uEarthR, 0.001);
  float x = (dist - uEarthR) / span;
  if (x > 1.0) discard;

  // Inside the limb the curve climbs toward it. Outside it falls the whole
  // way to the shell edge, so the tail has no last-step cliff.
  float scatter = x <= 0.0 ? exp(x * 1.05) : exp(-x * 2.1) * pow(max(1.0 - x, 0.0), 1.55);

  vec3 closest = ro + rd * dot(-ro, rd);
  float sunAmt = smoothstep(-0.08, 0.38, dot(normalize(closest), sun));
  float crown = pow(max(sunAmt, 0.0), 0.4);
  vec3 col = mix(vec3(0.12, 0.26, 0.55), vec3(0.75, 0.88, 1.0), crown);
  float a = scatter * (0.018 + 0.58 * crown);
  float dither = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  col += (dither - 0.5) * 0.02;
  gl_FragColor = vec4(max(col * a, 0.0), 1.0);
}
`;
