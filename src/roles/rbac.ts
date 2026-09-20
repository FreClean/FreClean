// Server-side RBAC only. Never trust a role claimed by the client without
// verifying it against the signed access token issued at login.

export type Role = "CUSTOMER" | "STAFF" | "MANAGER" | "ADMIN" | "OWNER";

export type Permission =
  | "dispute:create"
  | "dispute:view_own"
  | "dispute:view_assigned"
  | "dispute:view_all"
  | "dispute:investigate"
  | "dispute:request_information"
  | "dispute:propose_resolution"
  | "dispute:approve_refund"
  | "dispute:escalate"
  | "dispute:resolve"
  | "dispute:close"
  | "dispute:reopen"
  | "dispute:view_sensitive_evidence"
  | "dispute:export"
  | "dispute:admin";

export const ROLE_RANK: Record<Role, number> = {
  CUSTOMER: 0,
  STAFF: 1,
  MANAGER: 2,
  ADMIN: 3,
  OWNER: 4,
};

export function hasRole(userRoles: Role[], required: Role): boolean {
  const maxRank = Math.max(...userRoles.map((r) => ROLE_RANK[r]), -1);
  return maxRank >= ROLE_RANK[required];
}

const rolePermissions: Record<Role, readonly Permission[]> = {
  CUSTOMER: ["dispute:create", "dispute:view_own"],
  STAFF: ["dispute:view_assigned", "dispute:investigate", "dispute:request_information", "dispute:propose_resolution", "dispute:escalate", "dispute:resolve"],
  MANAGER: ["dispute:view_assigned", "dispute:view_all", "dispute:investigate", "dispute:request_information", "dispute:propose_resolution", "dispute:approve_refund", "dispute:escalate", "dispute:resolve", "dispute:close", "dispute:reopen", "dispute:view_sensitive_evidence"],
  ADMIN: ["dispute:view_all", "dispute:investigate", "dispute:request_information", "dispute:propose_resolution", "dispute:approve_refund", "dispute:escalate", "dispute:resolve", "dispute:close", "dispute:reopen", "dispute:view_sensitive_evidence", "dispute:export", "dispute:admin"],
  OWNER: ["dispute:view_all", "dispute:investigate", "dispute:request_information", "dispute:propose_resolution", "dispute:approve_refund", "dispute:escalate", "dispute:resolve", "dispute:close", "dispute:reopen", "dispute:view_sensitive_evidence", "dispute:export", "dispute:admin"],
};

export function hasPermission(userRoles: Role[], permission: Permission): boolean {
  return userRoles.some((role) => rolePermissions[role]?.includes(permission));
}

import type { Request, Response, NextFunction } from "express";

export function requireRole(required: Role) {
  return (req: Request, res: Response, next: NextFunction) => {
    const roles: Role[] = req.user?.roles ?? [];
    if (!hasRole(roles, required)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };
}
