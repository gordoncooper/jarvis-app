/**
 * The theme contract.
 *
 * Everything a theme is allowed to depend on is exported here. Themes import
 * from "@core" and never reach into src/ by relative path; esbuild asserts
 * both directions of that boundary before it builds (see esbuild.mjs).
 */
export * from "./api.js";
export * from "./chat.js";
export * from "./pulse.js";
export * from "./session.js";
export * from "./useJarvis.js";
