import React from "react";
import type { RenderOptions } from "@testing-library/react";
import { render } from "@testing-library/react";
import DataProvider from "@/data";

type WrapperOptions = Record<string, never>;

function createWrapper(_options: WrapperOptions = {}) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <DataProvider>{children}</DataProvider>;
  };
}

export function renderWithProviders(
  ui: React.ReactElement,
  options?: WrapperOptions & Omit<RenderOptions, "wrapper">
) {
  const { ...renderOptions } = options ?? {};
  return render(ui, {
    wrapper: createWrapper(options),
    ...renderOptions,
  });
}
