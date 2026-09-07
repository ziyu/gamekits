import type { AppProfile } from "@gamekits/app-host";
import {
  createOutpostNonVisualProfile,
  type CreateOutpostNonVisualProfileOptions,
  type OutpostNonVisualContext
} from "./nonvisual";

export type OutpostDeterministicTestContext = OutpostNonVisualContext;

export type CreateOutpostDeterministicTestProfileOptions = Omit<
  CreateOutpostNonVisualProfileOptions,
  "profileId"
>;

export function createOutpostDeterministicTestProfile(
  context: OutpostDeterministicTestContext,
  options: CreateOutpostDeterministicTestProfileOptions = {}
): AppProfile<OutpostDeterministicTestContext> {
  return createOutpostNonVisualProfile(context, {
    clock: () => 0,
    seed: "outpost.deterministic-test.seed",
    ...options,
    profileId: "deterministic-test"
  });
}
