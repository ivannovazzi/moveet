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

  it("spreads the five types on hover", () => {
    renderKey();

    fireEvent.pointerEnter(groupKey().parentElement as HTMLElement);

    expect(cluster()).toBeInTheDocument();
    for (const label of TYPE_LABELS) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(groupKey()).toHaveAttribute("aria-expanded", "true");
  });

  it("collapses again when the pointer leaves", () => {
    renderKey();
    const wrapper = groupKey().parentElement as HTMLElement;

    fireEvent.pointerEnter(wrapper);
    expect(cluster()).toBeInTheDocument();

    fireEvent.pointerLeave(wrapper);

    expect(cluster()).not.toBeInTheDocument();
  });

  it("spreads on focus too, so the types are reachable by keyboard", () => {
    renderKey();

    fireEvent.focus(groupKey());

    expect(cluster()).toBeInTheDocument();
  });

  it("spreads on click, for touch", () => {
    renderKey();

    fireEvent.click(groupKey());
    expect(cluster()).toBeInTheDocument();

    fireEvent.click(groupKey());
    expect(cluster()).not.toBeInTheDocument();
  });

  it("stays open while focus moves within the cluster", () => {
    renderKey();
    fireEvent.focus(groupKey());

    const car = screen.getByRole("button", { name: "Car" });
    fireEvent.blur(groupKey(), { relatedTarget: car });

    expect(cluster()).toBeInTheDocument();
  });

  it("closes when focus leaves the cluster entirely", () => {
    renderKey();
    fireEvent.focus(groupKey());

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
