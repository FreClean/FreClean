import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import type { Role } from "../roles/rbac.js";

export interface AuthenticatedUser {
  id: string;
  roles: Role[];
}

declare module "express-serve-static-core" {
  interface Request {
    user?: AuthenticatedUser;
    rawBody?: Buffer;
  }
}

export function requireAuthentication(req: Request, res: Response, next: NextFunction) {
  const header = req.header("Authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  const secret = process.env.JWT_ACCESS_SECRET;

  if (!token || !secret) {
    return res.status(401).json({ error: "Authentication required" });
  }

  try {
    const payload = jwt.verify(token, secret);
    if (typeof payload === "string" || typeof payload.sub !== "string" || !Array.isArray(payload.roles)) {
      return res.status(401).json({ error: "Invalid access token" });
    }

    const roles = payload.roles.filter((role): role is Role =>
      ["CUSTOMER", "STAFF", "MANAGER", "ADMIN", "OWNER"].includes(role)
    );
    if (roles.length !== payload.roles.length) {
      return res.status(401).json({ error: "Invalid access token" });
    }

    req.user = { id: payload.sub, roles };
    next();
  } catch {
    return res.status(401).json({ error: "Invalid access token" });
  }
}