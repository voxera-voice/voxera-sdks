"use client";

export { useVoxera } from "./useVoxera.js";
export type {
  UseVoxera,
  UseVoxeraOptions,
  VoxeraToolCall,
} from "./useVoxera.js";

// Re-exported so a React app never has to install @voxera/sdk-web alongside
// this package to reach the client, its config type or the protocol types.
export * from "@voxera/sdk-web";
