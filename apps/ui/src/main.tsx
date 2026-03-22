// Register luma.gl WebGL2 adapter before any deck.gl code loads
import { luma } from "@luma.gl/core";
import { webgl2Adapter } from "@luma.gl/webgl";
luma.registerAdapters([webgl2Adapter]);

// Suppress non-fatal luma.gl race condition: ResizeObserver fires before
// the WebGL device's `limits` object is populated during initial mount.
// The error is harmless — luma.gl recovers on the next resize event.
window.addEventListener("error", (e) => {
  if (e.message?.includes("maxTextureDimension2D")) {
    e.preventDefault();
  }
});

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "the-new-css-reset/css/reset.css";
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
