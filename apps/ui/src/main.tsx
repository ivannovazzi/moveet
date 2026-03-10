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
