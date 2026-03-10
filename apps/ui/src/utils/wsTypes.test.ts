import { describe, it, expect } from "vitest";
import { isValidMessage } from "./wsTypes";

describe("wsTypes", () => {
  describe("isValidMessage", () => {
    it("should return true for valid connect message", () => {
      const message = { type: "connect" };
      expect(isValidMessage(message)).toBe(true);
    });

    it("should return true for valid disconnect message", () => {
      const message = { type: "disconnect" };
      expect(isValidMessage(message)).toBe(true);
    });

    it("should return true for valid vehicle message with data", () => {
      const message = {
        type: "vehicle",
        data: {
          id: "1",
          name: "Vehicle 1",
          position: [0, 0],
          heading: 0,
          speed: 0,
          status: "idle",
        },
      };
      expect(isValidMessage(message)).toBe(true);
    });

    it("should return false for invalid message structure", () => {
      const message = { invalid: "structure" };
      expect(isValidMessage(message)).toBe(false);
    });

    it("should return false for null or undefined", () => {
      expect(isValidMessage(null)).toBe(false);
      expect(isValidMessage(undefined)).toBe(false);
    });

    it("should return false for vehicle message without data", () => {
      const message = { type: "vehicle" };
      expect(isValidMessage(message)).toBe(false);
    });

    it("should return false for unknown message type", () => {
      const message = { type: "unknown", data: {} };
      expect(isValidMessage(message)).toBe(false);
    });
  });
});
