import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Typeahead } from "./Typeahead";

const options = ["Nairobi", "Mombasa", "Kisumu"];

describe("Typeahead", () => {
  it("renders a combobox input", () => {
    render(<Typeahead options={options} onChange={() => {}} />);
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });

  it("renders label when provided", () => {
    render(<Typeahead label="City:" options={options} onChange={() => {}} />);
    expect(screen.getByText("City:")).toBeInTheDocument();
  });

  it("shows options on focus", async () => {
    const user = userEvent.setup();
    render(<Typeahead options={options} onChange={() => {}} />);
    await user.click(screen.getByRole("combobox"));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getByText("Nairobi")).toBeInTheDocument();
  });

  it("calls onChange when option selected via click", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<Typeahead options={options} onChange={onChange} />);
    await user.click(screen.getByRole("combobox"));
    await user.click(screen.getByText("Mombasa"));
    expect(onChange).toHaveBeenCalledWith("Mombasa");
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    render(<Typeahead options={options} onChange={() => {}} />);
    await user.click(screen.getByRole("combobox"));
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("renders with placeholder", () => {
    render(<Typeahead options={options} onChange={() => {}} placeholder="Search..." />);
    expect(screen.getByPlaceholderText("Search...")).toBeInTheDocument();
  });

  it("supports renderLabel for display text", () => {
    const items = [{ name: "Nairobi" }, { name: "Mombasa" }];
    render(<Typeahead options={items} onChange={() => {}} renderLabel={(item) => item.name} />);
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });
});
