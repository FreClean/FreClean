// Server-side RBAC only. Never trust a role claimed by the client without
// verifying it against the signed access token issued at login.

export type Role = "CUSTOMER" | "STAFF" | "MANAGER" | "ADMIN" | "OWNER";

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

import type { Request, Response, NextFunction } from "express";

export function requireRole(required: Role) {
  return (req: Request, res: Response, next: NextFunction) => {
    const roles: Role[] = (req as any).user?.roles ?? [];
    if (!hasRole(roles, required)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    next();
  };
}
