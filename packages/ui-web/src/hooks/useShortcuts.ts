import { onMount, onCleanup } from "solid-js";
import { useAppStore } from "../store/app";

export function useShortcuts(openPalette: () => void) {
  const { state, closePalette, setMode, createSession, toggleTheme, toggleSidebar } = useAppStore();

  onMount(() => {
    const handler = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey;
      const shift = e.shiftKey;

      // Command Palette: Cmd/Ctrl+Shift+P or Cmd/Ctrl+K
      if (meta && shift && e.key.toLowerCase() === "p") {
        e.preventDefault();
        openPalette();
        return;
      }

      if (e.key === "k" && meta) {
        e.preventDefault();
        openPalette();
        return;
      }

      // Escape closes palette and any open modal-like surfaces
      if (e.key === "Escape") {
        if (state().paletteOpen) {
          e.preventDefault();
          closePalette();
          return;
        }
        window.dispatchEvent(new CustomEvent("openstar:close-popovers"));
        return;
      }

      if (e.key === "b" && meta) {
        e.preventDefault();
        toggleSidebar();
        return;
      }

      if (e.key === "n" && meta) {
        e.preventDefault();
        createSession();
        setMode("chat");
        return;
      }

      if (e.key === "l" && meta && shift) {
        e.preventDefault();
        toggleTheme();
        return;
      }

      const viewMap: Record<string, Parameters<typeof setMode>[0]> = {
        "1": "chat",
        "2": "terminal",
        "3": "canvas",
        "4": "browser",
        "5": "swarm",
        "6": "templates",
        "7": "settings",
      };

      if (meta && viewMap[e.key]) {
        e.preventDefault();
        setMode(viewMap[e.key]);
      }
    };

    document.addEventListener("keydown", handler);
    onCleanup(() => document.removeEventListener("keydown", handler));
  });
}
