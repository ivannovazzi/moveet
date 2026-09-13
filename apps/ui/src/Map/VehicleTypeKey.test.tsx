import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { VehicleType } from "@/types";
import VehicleTypeKey from "./VehicleTypeKey";

const TYPE_LABELS = ["Car", "Truck", "Moto", "Ambulance", "Bus"];

function renderKey(hidden: VehicleType[] = [], onToggle = vi.fn()) {
  const result = render(
    <VehicleTypeKey hiddenVehicleTypes={new Set(hidden)} onToggle={onToggle} />
  );
  return { ...result, onToggle };
}

const groupKey = () => screen.getByRole("button", { name: "Vehicle types" });
const cluster = () => screen.queryByRole("group", { name: "Vehicle type filters" });

describe("VehicleTypeKey", () => {
  it("is one collapsed key until asked", () => {
    renderKey();

    expect(groupKey()).toHaveAttribute("aria-expanded", "false");
    expect(cluster()).not.toBeInTheDocument();
    for (const label of TYPE_LABELS) {
      expect(screen.queryByRole("button", { name: label })).not.toBeInTheDocument();
    }
  });

  it("spreads the five types on click, and collapses on a second press", () => {
    renderKey();

    fireEvent.click(groupKey());

    expect(cluster()).toBeInTheDocument();
    for (const label of TYPE_LABELS) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(groupKey()).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(groupKey());

    expect(cluster()).not.toBeInTheDocument();
  });

  it("ignores the pointer crossing the key on its way elsewhere in the rail", () => {
    renderKey();
    const wrapper = groupKey().parentElement as HTMLElement;

    fireEvent.pointerEnter(wrapper);
    fireEvent.pointerEnter(groupKey());

    expect(cluster()).not.toBeInTheDocument();
  });

  it("does not close on a pointer leave once opened by a press", () => {
    renderKey();
    const wrapper = groupKey().parentElement as HTMLElement;
    fireEvent.click(groupKey());

    fireEvent.pointerLeave(wrapper);

    expect(cluster()).toBeInTheDocument();
  });

  it("closes on a press outside", () => {
    renderKey();
    fireEvent.click(groupKey());

    fireEvent.mouseDown(document.body);

    expect(cluster()).not.toBeInTheDocument();
  });

  it("stays open for a press inside the cluster", () => {
    renderKey();
    fireEvent.click(groupKey());

    fireEvent.mouseDown(screen.getByRole("button", { name: "Car" }));

    expect(cluster()).toBeInTheDocument();
  });

  it("closes on Escape, claiming the press so the app doesn't act on it too", () => {
    renderKey();
    fireEvent.click(groupKey());

    const handled = fireEvent.keyDown(document, { key: "Escape" });

    expect(cluster()).not.toBeInTheDocument();
    // `fireEvent` returns false once a listener called preventDefault.
    expect(handled).toBe(false);
  });

  it("leaves Escape alone while collapsed", () => {
    renderKey();

    expect(fireEvent.keyDown(document, { key: "Escape" })).toBe(true);
  });

  it("stays open while focus moves within the cluster", () => {
    renderKey();
    fireEvent.click(groupKey());

    const car = screen.getByRole("button", { name: "Car" });
    fireEvent.blur(groupKey(), { relatedTarget: car });

    expect(cluster()).toBeInTheDocument();
  });

  it("closes when focus leaves the cluster entirely", () => {
    renderKey();
    fireEvent.click(groupKey());

    fireEvent.blur(groupKey(), { relatedTarget: document.body });

    expect(cluster()).not.toBeInTheDocument();
  });

  it("reports each type's state as aria-pressed", () => {
    renderKey(["truck", "bus"]);
    fireEvent.click(groupKey());

    expect(screen.getByRole("button", { name: "Truck" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Bus" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "Car" })).toHaveAttribute("aria-pressed", "true");
  });

  it("routes a press through onToggle with the type", () => {
    const { onToggle } = renderKey();
    fireEvent.click(groupKey());

    fireEvent.click(screen.getByRole("button", { name: "Ambulance" }));

    expect(onToggle).toHaveBeenCalledWith("ambulance");
  });

  it("reports the hidden count on the collapsed key", () => {
    renderKey(["truck", "bus", "motorcycle"]);

    expect(groupKey()).toHaveTextContent("3");
    expect(groupKey()).toHaveAttribute("title", "Vehicle types — 3 hidden");
    expect(screen.getByText("3 vehicle types hidden")).toBeInTheDocument();
  });

  it("carries no count while nothing is filtered", () => {
    renderKey();

    expect(groupKey()).toHaveTextContent("");
    expect(groupKey()).toHaveAttribute("title", "Vehicle types — all shown");
  });
});
