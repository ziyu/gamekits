import type { DataRef } from "@gamekits/data";
import type { NavigationPoint } from "./geometry";
import type { NavigationAreaDefinition } from "./profile";

export type NavigationPortalEndpoint = {
  point: NavigationPoint;
  area?: string | undefined;
};

export type NavigationPortalDefinition = {
  id: string;
  from: NavigationPortalEndpoint;
  to: NavigationPortalEndpoint;
  cost?: number | undefined;
  bidirectional?: boolean | undefined;
  enabled?: boolean | undefined;
};

export type NavigationLayoutDefinition = {
  id: string;
  backend: string;
  source: DataRef;
  areas?: NavigationAreaDefinition[] | undefined;
  portals?: NavigationPortalDefinition[] | undefined;
  tags?: string[] | undefined;
};
