import { createRoot } from "react-dom/client";
import type { DevToolsRuntime } from "@gamekits/devtools";
import { DevToolsOverlay } from "@gamekits/devtools-ui";
import type { SandboxUiHandles } from "./types";

export function mountSandboxDevToolsOverlay(
  handles: SandboxUiHandles,
  runtime: DevToolsRuntime
): void {
  if (handles.devtoolsReactRoot) {
    handles.devtoolsReactRoot.render(
      <DevToolsOverlay runtime={runtime} uiRuntime={handles.uiRuntime} />
    );
    return;
  }

  const root = createRoot(handles.devtoolsRoot);
  handles.devtoolsReactRoot = root;
  root.render(<DevToolsOverlay runtime={runtime} uiRuntime={handles.uiRuntime} />);
}
