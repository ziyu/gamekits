import {
  defineWorldCheckpointConformanceTests,
  defineWorldConformanceTests
} from "@gamekits/test-utils";
import { createKootaWorld } from "../src/index";

defineWorldConformanceTests("Koota", createKootaWorld);
defineWorldCheckpointConformanceTests("Koota", createKootaWorld);
