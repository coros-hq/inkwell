import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { QuickNoteCapture } from "./components/quicknote/QuickNoteCapture";
import { installExternalLinkHandler } from "./lib/openExternal";

installExternalLinkHandler();

// The quick-note popup (opened via the global Cmd+N shortcut / tray menu)
// loads this same SPA entry with a `quicknote` query param, so it renders a
// lightweight capture UI instead of the full app shell.
const isQuickNote = new URLSearchParams(window.location.search).has("quicknote");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isQuickNote ? <QuickNoteCapture /> : <App />}
  </React.StrictMode>,
);
