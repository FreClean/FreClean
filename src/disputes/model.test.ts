import { describe, expect, it } from "vitest";
import { canTransition } from "./model.js";

describe("dispute status machine", () => {
  it("allows only controlled lifecycle transitions", () => {
    expect(canTransition("OPEN", "ACKNOWLEDGED")).toBe(true);
    expect(canTransition("INVESTIGATING", "RESOLUTION_PROPOSED")).toBe(true);
    expect(canTransition("OPEN", "RESOLVED")).toBe(false);
    expect(canTransition("CLOSED", "RESOLVED")).toBe(false);
  });
});