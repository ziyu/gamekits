import { createPlatformUnsupportedError } from "@gamekits/platform-core";
import { definePlatformConformanceTests } from "@gamekits/test-utils";
import { describe, expect, it } from "vitest";
import {
  createMemoryStorage,
  createWebPlatform,
  measureElementViewport,
  observeElementViewport,
  type ElementViewportObserver
} from "../src";

definePlatformConformanceTests("Web", () =>
  createWebPlatform({
    appName: "Test Web App",
    storage: createMemoryStorage()
  })
);

describe("createWebPlatform", () => {
  it("fails clearly for unsupported open/save dialogs", async () => {
    const platform = createWebPlatform({ storage: createMemoryStorage() });

    await expect(platform.services.dialog.open()).rejects.toMatchObject({
      code: "platform.unsupported_capability"
    });
    await expect(platform.services.dialog.save()).rejects.toMatchObject({
      code: "platform.unsupported_capability"
    });
  });

  it("creates standard unsupported capability errors", () => {
    expect(createPlatformUnsupportedError("web", "shell.open")).toMatchObject({
      code: "platform.unsupported_capability"
    });
  });

  it("exposes standard capability descriptors", () => {
    const platform = createWebPlatform({ storage: createMemoryStorage() });

    expect(platform.capabilities.list().map((capability) => capability.id)).toContain("storage");
    expect(platform.capabilities.describe("fs.write")).toMatchObject({
      service: "platform.fs"
    });
  });
});

describe("element viewport", () => {
  it("measures logical element dimensions and falls back for hidden elements", () => {
    const element = createElementFixture(701.6, 1199.2);

    expect(measureElementViewport(element)).toEqual({ width: 702, height: 1199 });

    element.setSize(0, Number.NaN);
    expect(measureElementViewport(element, { width: 1280, height: 720 })).toEqual({
      width: 1280,
      height: 720
    });
  });

  it("publishes only changed dimensions and disconnects its observer", () => {
    const element = createElementFixture(640, 960);
    const published: Array<{ width: number; height: number }> = [];
    let notify = () => {};
    let observed: Element | undefined;
    let disconnected = false;
    const observer: ElementViewportObserver = {
      observe(target) {
        observed = target;
      },
      disconnect() {
        disconnected = true;
      }
    };

    const stop = observeElementViewport({
      element,
      onResize(viewport) {
        published.push(viewport);
      },
      createObserver(callback) {
        notify = callback;
        return observer;
      }
    });

    expect(observed).toBe(element);
    expect(published).toEqual([{ width: 640, height: 960 }]);

    notify();
    element.setSize(641, 960);
    notify();
    expect(published).toEqual([
      { width: 640, height: 960 },
      { width: 641, height: 960 }
    ]);

    stop();
    element.setSize(800, 600);
    notify();
    expect(disconnected).toBe(true);
    expect(published).toHaveLength(2);
  });
});

function createElementFixture(width: number, height: number) {
  let currentWidth = width;
  let currentHeight = height;
  return {
    getBoundingClientRect() {
      return {
        width: currentWidth,
        height: currentHeight,
        x: 0,
        y: 0,
        top: 0,
        right: currentWidth,
        bottom: currentHeight,
        left: 0,
        toJSON() {}
      };
    },
    setSize(nextWidth: number, nextHeight: number) {
      currentWidth = nextWidth;
      currentHeight = nextHeight;
    }
  } as Element & { setSize(nextWidth: number, nextHeight: number): void };
}
