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

  // Sun catches only the upper limb. The facing disc stays night.
  float dayF = smoothstep(0.12, 0.55, ndl);
  vec3 dayLit = dayC * (0.12 + 1.05 * max(ndl, 0.0));
  col = mix(col, dayLit, dayF);

  vec3 halfV = normalize(sun + view);
  float spec = pow(max(dot(nb, halfV), 0.0), 48.0) * ocean * dayF;
  col += vec3(0.75, 0.86, 1.0) * spec * 0.35;

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

/** Blue limb, bright where the sun rakes the top, thin everywhere else. */
export const stageAtmoFrag = /* glsl */ `
uniform vec3 uSunDir;
varying vec3 vWorldNormal;
varying vec3 vWorld;

void main() {
  vec3 n = normalize(vWorldNormal);
  vec3 view = normalize(cameraPosition - vWorld);
  vec3 sun = normalize(uSunDir);
  float fres = pow(1.0 - abs(dot(view, n)), 3.6);
  float lit = smoothstep(-0.15, 0.65, dot(n, sun));
  vec3 nightCol = vec3(0.05, 0.12, 0.32);
  vec3 dayCol = vec3(0.55, 0.78, 1.0);
  vec3 col = mix(nightCol, dayCol, lit);
  float a = fres * (0.12 + lit * 1.15);
  gl_FragColor = vec4(col * (0.45 + fres), a);
}
`;
