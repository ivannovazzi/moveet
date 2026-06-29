// Register luma.gl WebGL2 adapter before any deck.gl code loads
import { luma } from "@luma.gl/core";
import { webgl2Adapter } from "@luma.gl/webgl";
luma.registerAdapters([webgl2Adapter]);

// Non-fatal luma.gl race: a ResizeObserver callback can fire before the WebGL
// device's `limits` object is populated during initial mount, throwing while
// reading `maxTextureDimension2D`. luma recovers on the next resize, so the
// error is cosmetic — but blanket-swallowing it forever would also hide a
// genuine later regression that happens to mention the same property.
//
// The proper fix lives upstream (luma should not read limits before the device
// is initialized) and can't be applied safely from here without risking the GL
// init path. As a targeted mitigation we only suppress the message, and only
// during the brief startup window, then detach the listener so later errors
// surface normally.
const suppressInitGlRace = (e: ErrorEvent) => {
  if (e.message?.includes("maxTextureDimension2D")) {
    e.preventDefault();
  }
};
window.addEventListener("error", suppressInitGlRace);
// 5s comfortably covers lazy-loading the deck.gl chunk + first GL context init.
window.setTimeout(() => window.removeEventListener("error", suppressInitGlRace), 5000);

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import DataProvider from "./data";
import ErrorBoundary from "./components/ErrorBoundary";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <DataProvider>
        <App />
      </DataProvider>
    </ErrorBoundary>
  </StrictMode>
);
