import { describe, expect, it } from "vitest";
import { hasPermission, hasRole } from "./rbac.js";

describe("role hierarchy", () => {
  it("allows a higher role to satisfy lower-level access", () => {
    expect(hasRole(["MANAGER"], "STAFF")).toBe(true);
    expect(hasRole(["CUSTOMER"], "STAFF")).toBe(false);
  });

  it("does not grant access to unknown or empty role sets", () => {
    expect(hasRole([], "CUSTOMER")).toBe(false);
    expect(hasRole(["CUSTOMER"], "OWNER")).toBe(false);
  });

  it("keeps dispute permissions explicit by role", () => {
    expect(hasPermission(["CUSTOMER"], "dispute:create")).toBe(true);
    expect(hasPermission(["CUSTOMER"], "dispute:view_all")).toBe(false);
    expect(hasPermission(["STAFF"], "dispute:investigate")).toBe(true);
    expect(hasPermission(["STAFF"], "dispute:approve_refund")).toBe(false);
    expect(hasPermission(["MANAGER"], "dispute:approve_refund")).toBe(true);
  });
});
