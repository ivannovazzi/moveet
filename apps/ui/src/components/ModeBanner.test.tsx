import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ModeBanner from "./ModeBanner";
import { DispatchState } from "@/hooks/useDispatchState";
import type { InteractionMode } from "@/hooks/useInteractionMode";

const BROWSE: InteractionMode = { kind: "browse" };
const DISPATCH: InteractionMode = { kind: "dispatch" };
const DRAW: InteractionMode = { kind: "draw-geofence" };

function renderBanner(overrides: Partial<React.ComponentProps<typeof ModeBanner>> = {}) {
  const onExit = vi.fn();
  const utils = render(
    <ModeBanner
      mode={BROWSE}
      dispatchState={DispatchState.BROWSE}
      selectedCount={0}
      stopCount={0}
      drawVertexCount={0}
      onExit={onExit}
      {...overrides}
    />
  );
  return { onExit, ...utils };
}

describe("ModeBanner", () => {
  it("renders nothing in browse mode", () => {
    const { container } = renderBanner();
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the dispatch select hint while no vehicles are selected", () => {
    renderBanner({ mode: DISPATCH, dispatchState: DispatchState.SELECT });
    expect(screen.getByText(/click vehicles in the list/i)).toBeInTheDocument();
    expect(screen.getByText("Dispatch")).toBeInTheDocument();
  });

  it("shows the routing hint with pending stops", () => {
    renderBanner({
      mode: DISPATCH,
      dispatchState: DispatchState.ROUTE,
      selectedCount: 2,
      stopCount: 1,
    });
    expect(screen.getByText(/add another stop/i)).toBeInTheDocument();
    expect(screen.getByText(/enter to dispatch/i)).toBeInTheDocument();
  });

  it("shows per-phase draw hints from the vertex count", () => {
    const { rerender } = render(
      <ModeBanner
        mode={DRAW}
        dispatchState={DispatchState.BROWSE}
        selectedCount={0}
        stopCount={0}
        drawVertexCount={0}
        onExit={() => {}}
      />
    );
    expect(screen.getByText(/at least 3/i)).toBeInTheDocument();
    expect(screen.getByText("Draw zone")).toBeInTheDocument();

    rerender(
      <ModeBanner
        mode={DRAW}
        dispatchState={DispatchState.BROWSE}
        selectedCount={0}
        stopCount={0}
        drawVertexCount={2}
        onExit={() => {}}
      />
    );
    expect(screen.getByText(/2 points — add 1 more/i)).toBeInTheDocument();

    rerender(
      <ModeBanner
        mode={DRAW}
        dispatchState={DispatchState.BROWSE}
        selectedCount={0}
        stopCount={0}
        drawVertexCount={3}
        onExit={() => {}}
      />
    );
    expect(screen.getByText(/press enter to finish/i)).toBeInTheDocument();
  });

  it("always offers an Exit button (with the Esc hint) that fires onExit", () => {
    const { onExit } = renderBanner({ mode: DISPATCH, dispatchState: DispatchState.SELECT });

    const exit = screen.getByRole("button", { name: /exit/i });
    expect(exit).toHaveTextContent("Esc");
    fireEvent.click(exit);
    expect(onExit).toHaveBeenCalledOnce();
  });

  it("keeps the Exit button visible in the RESULTS phase", () => {
    const { onExit } = renderBanner({ mode: DISPATCH, dispatchState: DispatchState.RESULTS });
    expect(screen.getByText(/dispatch complete/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /exit/i }));
    expect(onExit).toHaveBeenCalledOnce();
  });
});
