import { describe, expect, it } from "vitest";
import type { RendererAdapter } from "@gamekits/renderer-core";

function createTestContainer(): HTMLElement {
  if (typeof document !== "undefined") {
    return document.createElement("div");
  }

  return {
    append() {
      // Test-only stand-in for environments without DOM globals.
    }
  } as unknown as HTMLElement;
}

export function defineRendererConformanceTests(
  name: string,
  createRenderer: () => RendererAdapter
): void {
  describe(`${name} RendererAdapter conformance`, () => {
    it("boots, exposes a view and native bridge, and resizes", async () => {
      const renderer = createRenderer();
      const container = createTestContainer();
      const diagnostics: string[] = [];

      await renderer.boot({
        container,
        width: 320,
        height: 240,
        onDiagnostic: (event) => diagnostics.push(event.type)
      });
      renderer.resize(640, 480);

      expect(renderer.getView()).toBeTruthy();
      expect(renderer.native()).toBeTruthy();
      expect(diagnostics).toContain("renderer.booted");
      renderer.destroy();
    });

    it("creates, resolves handles, commands, resolves nodes, and destroys render objects", async () => {
      const renderer = createRenderer();
      const container = createTestContainer();

      await renderer.boot({ container, width: 320, height: 240 });
      const objectId = renderer.createObject({
        type: "container",
        transform: { position: { x: 10, y: 20 } },
        children: [
          {
            id: "body",
            type: "debug.square",
            transform: { position: { x: 1, y: 2 } },
            props: { width: 16, height: 16 }
          }
        ]
      });

      expect(objectId).toBeTruthy();
      expect(renderer.getObjectHandle?.(objectId)).toMatchObject({ id: objectId });
      expect(renderer.getNodeHandle?.(objectId, "body")).toMatchObject({ id: objectId });
      expect(() =>
        renderer.command?.(objectId, { type: "animation.play", args: { animationId: "idle" } })
      ).not.toThrow();
      expect(() => renderer.destroyObject(objectId)).not.toThrow();
      expect(() => renderer.getObjectHandle?.(objectId)).toThrow();
      renderer.destroy();
    });

    it("fails clearly for unsupported object types", async () => {
      const renderer = createRenderer();
      const container = createTestContainer();

      await renderer.boot({ container, width: 320, height: 240 });

      expect(() =>
        renderer.createObject({
          type: "unsupported.test_object",
          transform: { position: { x: 0, y: 0 } }
        })
      ).toThrow();
      renderer.destroy();
    });

    it("fails clearly for missing nodes and unsupported commands", async () => {
      const renderer = createRenderer();
      const container = createTestContainer();

      await renderer.boot({ container, width: 320, height: 240 });
      const objectId = renderer.createObject({
        type: "container",
        children: [{ id: "body", type: "debug.square" }]
      });

      expect(() => renderer.getNodeHandle?.(objectId, "missing")).toThrow();
      expect(() => renderer.command?.(objectId, { type: "unknown.command" })).toThrow();
      renderer.destroy();
    });
  });
}
