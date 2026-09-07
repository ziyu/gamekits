import type { DataTypeDefinition } from "@gamekits/data";
import type { TcaRule } from "./types";

export const TCA_RULE_TYPE = "tca.rule";

export function createTcaRuleDataType(type = TCA_RULE_TYPE): DataTypeDefinition<TcaRule> {
  return {
    type,
    getTags: (rule) => rule.tags ?? [],
    validate(document) {
      const diagnostics = [];
      const rule = document.data;

      if (!rule.id || typeof rule.id !== "string") {
        diagnostics.push({
          code: "tca.rule_missing_id",
          message: "TCA rule requires id",
          severity: "error" as const,
          key: document
        });
      }

      if (!rule.trigger || typeof rule.trigger.type !== "string") {
        diagnostics.push({
          code: "tca.rule_missing_trigger",
          message: "TCA rule requires trigger.type",
          severity: "error" as const,
          key: document
        });
      }

      if (!Array.isArray(rule.actions) || rule.actions.length === 0) {
        diagnostics.push({
          code: "tca.rule_missing_actions",
          message: "TCA rule requires at least one action",
          severity: "error" as const,
          key: document
        });
      }

      return diagnostics;
    }
  };
}
