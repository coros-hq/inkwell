import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { QuickNoteCapture } from "./components/quicknote/QuickNoteCapture";
import { installExternalLinkHandler } from "./lib/openExternal";
import { applyAppFont, savedAppFont } from "./lib/appFont";
import { SettingsWindow } from "./components/settings/SettingsWindow";
import { isSettingsWindow } from "./lib/settingsSync";
import { restoreSavedTheme } from "./lib/restoreTheme";
import { useAppStore } from "./store/useAppStore";
import { rebasePortablePaths } from "./lib/dataRoot";
import "./styles/globals.css";

installExternalLinkHandler();
// Apply the saved font before first paint (also covers the quick-note window).
applyAppFont(savedAppFont());

// The quick-note popup (opened via the global Cmd+N shortcut / tray menu)
// loads this same SPA entry with a `quicknote` query param, so it renders a
// lightweight capture UI instead of the full app shell.
const isQuickNote = new URLSearchParams(window.location.search).has("quicknote");

// The Settings window mounts no AppShell, so it paints the saved theme itself; later changes
// arrive from the main window (see lib/settingsSync.ts).
if (isSettingsWindow) useAppStore.setState(restoreSavedTheme());

// A portable folder that was moved remembers vaults by their old absolute path; fix those
// before anything reads them (a no-op for normal installs).
rebasePortablePaths().finally(() => {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      {isSettingsWindow ? <SettingsWindow /> : isQuickNote ? <QuickNoteCapture /> : <App />}
    </React.StrictMode>,
  );
});
