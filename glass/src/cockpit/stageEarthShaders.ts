export const stageEarthVert = /* glsl */ `
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

/** Warm cinematic Earth — gold city lights, amber dusk, soft limb. */
export const stageEarthFrag = /* glsl */ `
uniform sampler2D tDay;
uniform sampler2D tNight;
uniform sampler2D tSpec;
uniform sampler2D tNormal;
uniform float uWarm;
varying vec2 vUv;
varying vec3 vNormal;
varying vec3 vWorld;

void main() {
  vec3 n = normalize(vNormal);
  vec3 bump = texture2D(tNormal, vUv).xyz * 2.0 - 1.0;
  n = normalize(n + bump * 0.28);

  vec3 light = normalize(vec3(0.55, 0.35, 0.72));
  vec3 view = normalize(cameraPosition - vWorld);
  float ndl = dot(n, light);
  float dayF = smoothstep(-0.18, 0.42, ndl);
  float dusk = smoothstep(0.0, 0.28, dayF) * (1.0 - smoothstep(0.35, 0.92, dayF));

  vec3 dayC = texture2D(tDay, vUv).rgb;
  dayC = mix(dayC, dayC * vec3(1.08, 0.98, 0.88), uWarm * 0.55);

  vec3 lights = texture2D(tNight, vUv).rgb;
  lights *= lights;
  vec3 gold = vec3(1.0, 0.72, 0.38);
  vec3 amber = vec3(1.0, 0.55, 0.22);
  lights = lights * mix(gold, amber, 0.35) * 4.2;

  vec3 nightBase = dayC * 0.07 * vec3(0.85, 0.78, 0.7);
  vec3 nightC = nightBase + lights;

  vec3 dayLit = dayC * (0.22 + 0.78 * smoothstep(-0.1, 1.0, ndl));
  dayLit += vec3(0.42, 0.18, 0.06) * dusk * 0.55;

  vec3 col = mix(nightC, dayLit, dayF);

  float specMask = texture2D(tSpec, vUv).r;
  vec3 halfV = normalize(light + view);
  float spec = pow(max(dot(n, halfV), 0.0), 52.0) * specMask * dayF;
  col += vec3(1.0, 0.9, 0.75) * spec * 0.55;

  float fres = pow(1.0 - abs(dot(view, normalize(vNormal))), 2.4);
  col += vec3(0.55, 0.72, 0.85) * fres * 0.12;
  col += vec3(0.95, 0.55, 0.28) * fres * dusk * 0.22;

  float facing = max(dot(normalize(vNormal), view), 0.0);
  col *= mix(1.0, 0.62, pow(facing, 1.35) * 0.55);

  gl_FragColor = vec4(col, 1.0);
}
`;

export const stageAtmoVert = /* glsl */ `
varying vec3 vNormal;
varying vec3 vWorld;
void main() {
  vNormal = normalize(normalMatrix * normal);
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const stageAtmoFrag = /* glsl */ `
varying vec3 vNormal;
varying vec3 vWorld;

void main() {
  vec3 view = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - abs(dot(view, normalize(vNormal))), 2.1);
  vec3 col = mix(vec3(0.35, 0.55, 0.85), vec3(0.95, 0.55, 0.28), 0.28);
  float a = smoothstep(0.05, 0.92, fres) * 0.38;
  gl_FragColor = vec4(col * (0.4 + 0.7 * fres), a);
}
`;
