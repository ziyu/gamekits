import type { AppProfile } from "@gamekits/app-host";
import {
  createOutpostNonVisualProfile,
  type CreateOutpostNonVisualProfileOptions,
  type OutpostNonVisualContext
} from "./nonvisual";

export type OutpostHeadlessServerContext = OutpostNonVisualContext;

export type CreateOutpostHeadlessServerProfileOptions = Omit<
  CreateOutpostNonVisualProfileOptions,
  "profileId"
>;

export function createOutpostHeadlessServerProfile(
  context: OutpostHeadlessServerContext,
  options: CreateOutpostHeadlessServerProfileOptions = {}
): AppProfile<OutpostHeadlessServerContext> {
  return createOutpostNonVisualProfile(context, {
    ...options,
    profileId: "headless-server"
  });
}
