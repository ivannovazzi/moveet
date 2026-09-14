import "@testing-library/jest-dom";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";

// jsdom lacks APIs that Radix UI (slider, select, dialog) and cmdk rely on.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {};
}

// The shell persists two preferences (the console's width and the section it
// was left on). They are real `localStorage`, which in jsdom lives for the
// whole file — so one test opening a section would seed the next test's first
// render. Every test starts from a fresh preference set instead.
beforeEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    // No storage in this environment; nothing to clear.
  }
});

// Cleanup after each test
afterEach(() => {
  cleanup();
});
