import { createRef } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import type { SandboxSceneDefinition } from "../scenes/types";

export type SandboxSceneHost = {
  sceneRoot: HTMLElement;
  markReady(): void;
  showError(error: unknown): void;
};

export function renderSandboxSceneHost(
  rootElement: HTMLElement,
  activeScene: SandboxSceneDefinition,
  scenes: readonly SandboxSceneDefinition[]
): SandboxSceneHost {
  const sceneRootRef = createRef<HTMLElement>();
  const statusRef = createRef<HTMLSpanElement>();
  const root = createRoot(rootElement);

  flushSync(() => {
    root.render(
      <div className="sandbox-scene-host">
        <aside className="scene-rail" aria-label="Sandbox scenes">
          <div className="scene-rail__brand" aria-label="GameKits Sandbox">
            <span>GK</span>
            <strong>LAB</strong>
          </div>
          <nav className="scene-rail__nav">
            {scenes.map((scene, index) => (
              <a
                key={scene.id}
                className="scene-rail__link"
                data-active={scene.id === activeScene.id ? "true" : "false"}
                href={`?scene=${scene.id}`}
                aria-current={scene.id === activeScene.id ? "page" : undefined}
                title={`${scene.title} — ${scene.description}`}
              >
                <span className="scene-rail__index">{String(index + 1).padStart(2, "0")}</span>
                <strong>{scene.shortLabel}</strong>
                <small>{scene.title}</small>
              </a>
            ))}
          </nav>
          <div className="scene-rail__status">
            <span ref={statusRef} />
            <small>loading</small>
          </div>
        </aside>
        <section className="sandbox-scene-mount" data-scene={activeScene.id} ref={sceneRootRef} />
      </div>
    );
  });

  const sceneRoot = sceneRootRef.current;
  const status = statusRef.current;
  if (!sceneRoot || !status) {
    throw new Error("Sandbox scene host did not mount required elements");
  }

  return {
    sceneRoot,
    markReady() {
      status.parentElement?.classList.add("scene-rail__status--ready");
      const label = status.nextElementSibling;
      if (label) {
        label.textContent = "ready";
      }
    },
    showError(error) {
      status.parentElement?.classList.add("scene-rail__status--error");
      const label = status.nextElementSibling;
      if (label) {
        label.textContent = "failed";
      }
      sceneRoot.replaceChildren();
      const message = document.createElement("pre");
      message.className = "sandbox-scene-error";
      message.textContent = error instanceof Error ? (error.stack ?? error.message) : String(error);
      sceneRoot.append(message);
    }
  };
}
