import { describe, expect, it } from "vitest";
import { hasRole } from "./rbac.js";

describe("role hierarchy", () => {
  it("allows a higher role to satisfy lower-level access", () => {
    expect(hasRole(["MANAGER"], "STAFF")).toBe(true);
    expect(hasRole(["CUSTOMER"], "STAFF")).toBe(false);
  });

  it("does not grant access to unknown or empty role sets", () => {
    expect(hasRole([], "CUSTOMER")).toBe(false);
    expect(hasRole(["CUSTOMER"], "OWNER")).toBe(false);
  });
});
