import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { createUiRuntime } from "@gamekits/ui-core";
import { createGameKitsUiAnimator, GameKitsUiShell, UiPanelHost, UiTip } from "../src";

describe("react ui", () => {
  it("renders open panels from a UiRuntime", () => {
    const runtime = createUiRuntime();
    runtime.registerPanel({ id: "actor", title: "Actor", kind: "panel" });
    runtime.open("actor", { actorId: "a" });

    const html = renderToStaticMarkup(
      createElement(
        GameKitsUiShell,
        { runtime },
        createElement(UiPanelHost, {
          renderPanel: (panel) => createElement("span", null, String(panel.props))
        })
      )
    );

    expect(html).toContain("Actor");
    expect(html).toContain('data-ui-panel="actor"');
    expect(html).toContain('data-gamekits-ui-shell=""');
    expect(html).toContain('data-gamekits-theme="gamekits"');
  });

  it("exposes a GSAP-backed UI animator facade", () => {
    const animator = createGameKitsUiAnimator({ reducedMotion: true });

    expect(animator.enter).toBeTypeOf("function");
    expect(animator.exit).toBeTypeOf("function");
    expect(animator.emphasize).toBeTypeOf("function");
  });

  it("renders a tip primitive with accessible tooltip content", () => {
    const html = renderToStaticMarkup(
      createElement(UiTip, { content: "Runtime focus scope" }, createElement("button", null, "?"))
    );

    expect(html).toContain("gamekits-ui-tip");
    expect(html).toContain('role="tooltip"');
    expect(html).toContain("Runtime focus scope");
  });
});
