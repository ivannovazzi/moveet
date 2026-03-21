// Register luma.gl WebGL2 adapter before any deck.gl code loads
import { luma } from "@luma.gl/core";
import { webgl2Adapter } from "@luma.gl/webgl";
luma.registerAdapters([webgl2Adapter]);

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
