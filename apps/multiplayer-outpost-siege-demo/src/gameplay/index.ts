import type { DataRegistry } from "@gamekits/data";
import type { OutpostIdentityRegistry } from "../domain";

export type OutpostGameplayContext = {
  data: DataRegistry;
  identities: OutpostIdentityRegistry;
};
export * from "./authority-combat";
export * from "./authority-navigation";
export * from "./authority-runtime";
export * from "./client-shadow-runtime";
export * from "./combat-cue-stream";
export * from "./components";
export * from "./constants";
export * from "./input";
export * from "./player/action-mapping";
export * from "./player/action-types";
export * from "./preview-runtime";
export * from "./rifle-projectile-network";
