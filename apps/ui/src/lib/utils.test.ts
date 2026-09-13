import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("keeps a type-scale size next to a text colour", () => {
    expect(cn("text-micro text-muted-foreground")).toBe("text-micro text-muted-foreground");
    expect(cn("text-muted-foreground text-title")).toBe("text-muted-foreground text-title");
  });

  it("still lets a later size win over an earlier one", () => {
    expect(cn("text-micro text-body")).toBe("text-body");
    expect(cn("text-sm text-label")).toBe("text-label");
  });
});
