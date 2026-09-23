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

/** Day on the sunlit face, city lights only where the sun is down. */
export const stageEarthFrag = /* glsl */ `
uniform sampler2D tDay;
uniform sampler2D tNight;
uniform sampler2D tSpec;
uniform sampler2D tNormal;
uniform vec3 uSunDir;
uniform vec3 uFillDir;
uniform float uLights;
varying vec2 vUv;
varying vec3 vWorldNormal;
varying vec3 vWorld;

void main() {
  vec3 n = normalize(vWorldNormal);
  vec3 bump = texture2D(tNormal, vUv).xyz * 2.0 - 1.0;
  vec3 nb = normalize(n + bump * 0.28);

  vec3 sun = normalize(uSunDir);
  vec3 view = normalize(cameraPosition - vWorld);
  float ndl = dot(nb, sun);

  vec3 dayC = texture2D(tDay, vUv).rgb;
  float ocean = texture2D(tSpec, vUv).r;

  // A wide ramp, not a line. Day and city lights overlap through the twilight.
  float shade = smoothstep(-0.85, 0.75, ndl);
  vec3 dayLit = dayC * (0.06 + 1.05 * shade);
  vec3 nt = texture2D(tNight, vUv).rgb;
  nt = max(nt - vec3(0.015), 0.0);
  float nightMask = 1.0 - smoothstep(-0.55, 0.9, ndl);
  nt = pow(nt, vec3(1.2));
  vec3 lights = nt * vec3(0.92, 0.76, 0.5) * uLights * nightMask;
  vec3 col = dayLit * shade + lights;

  vec3 halfV = normalize(sun + view);
  float spec = pow(max(dot(nb, halfV), 0.0), 40.0) * ocean * shade;
  col += vec3(0.85, 0.92, 1.0) * spec * 0.35;

  float fillN = smoothstep(-0.2, 0.8, dot(nb, normalize(uFillDir)));
  col += dayC * fillN * 0.06;

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
  float lit = smoothstep(-0.7, 0.75, ndl);
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

/** Thin limb only. The shell is a few percent larger than the earth, and the
 *  light dies inside that skin, so it cannot become a dome or a hard ring. */
export const stageAtmoFrag = /* glsl */ `
uniform vec3 uSunDir;
uniform vec3 uFillDir;
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
  // Stay off the face of the disc. A wide inward term is the pillow.
  if (x < -0.22 || x > 1.0) discard;

  float inner = smoothstep(-0.4, 0.18, x);
  float outer = exp(-max(x, 0.0) * 1.6) * pow(max(1.0 - max(x, 0.0), 0.0), 1.2);
  float scatter = x < 0.0 ? inner : outer;

  vec3 closest = ro + rd * dot(-ro, rd);
  vec3 limbN = normalize(closest);
  float sunAmt = smoothstep(-0.55, 0.85, dot(limbN, sun));
  float crown = pow(max(sunAmt, 0.0), 0.85);
  float fillAmt = smoothstep(-0.15, 0.7, dot(limbN, normalize(uFillDir)));
  vec3 col = mix(vec3(0.16, 0.34, 0.62), vec3(0.55, 0.74, 0.95), crown);
  col = mix(col, vec3(0.20, 0.38, 0.66), fillAmt * (1.0 - crown));
  float a = scatter * (0.05 + 0.55 * crown + 0.22 * fillAmt);
  float dither = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
  col += (dither - 0.5) * 0.015;
  gl_FragColor = vec4(max(col * a, 0.0), 1.0);
}
`;
