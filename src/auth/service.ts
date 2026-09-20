import argon2 from "argon2";
import jwt from "jsonwebtoken";
import type { SignOptions } from "jsonwebtoken";
import { query } from "../db.js";
import type { Role } from "../roles/rbac.js";

interface UserRecord {
  id: string;
  email: string;
  password_hash: string;
  full_name: string;
}

function getJwtSecret(name: "JWT_ACCESS_SECRET" | "JWT_REFRESH_SECRET") {
  const secret = process.env[name];
  if (!secret) {
    throw Object.assign(new Error(`Missing ${name}`), { status: 500 });
  }
  return secret;
}

export function issueAccessToken(userId: string, roles: Role[]) {
  return jwt.sign(
    { sub: userId, roles },
    getJwtSecret("JWT_ACCESS_SECRET"),
    { expiresIn: (process.env.JWT_ACCESS_TTL ?? "15m") as SignOptions["expiresIn"] }
  );
}

export function issueRefreshToken(userId: string, roles: Role[]) {
  return jwt.sign(
    { sub: userId, roles, type: "refresh" },
    getJwtSecret("JWT_REFRESH_SECRET"),
    { expiresIn: (process.env.JWT_REFRESH_TTL ?? "30d") as SignOptions["expiresIn"] }
  );
}

export async function registerCustomer(email: string, password: string, fullName: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const existing = await query<UserRecord>("SELECT id FROM users WHERE email = $1", [normalizedEmail]);
  if (existing.length > 0) {
    throw Object.assign(new Error("Email already registered"), { status: 409 });
  }

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

  const [user] = await query<UserRecord>(
    `INSERT INTO users (email, password_hash, full_name)
     VALUES ($1, $2, $3) RETURNING id, email, full_name`,
    [normalizedEmail, passwordHash, fullName.trim()]
  );

  await query(
    `INSERT INTO user_roles (user_id, role_id)
     SELECT $1, id FROM roles WHERE name = 'CUSTOMER'`,
    [user!.id]
  );

  return user;
}

export async function login(email: string, password: string) {
  const normalizedEmail = email.trim().toLowerCase();
  const [user] = await query<UserRecord>("SELECT * FROM users WHERE email = $1", [normalizedEmail]);
  if (!user) {
    throw Object.assign(new Error("Invalid credentials"), { status: 401 });
  }

  const valid = await argon2.verify(user.password_hash, password);
  if (!valid) {
    throw Object.assign(new Error("Invalid credentials"), { status: 401 });
  }

  const roles = await query<{ name: Role }>(
    `SELECT r.name FROM roles r
     JOIN user_roles ur ON ur.role_id = r.id
     WHERE ur.user_id = $1`,
    [user.id]
  );

  const userRoles = roles.map((r) => r.name);
  const accessToken = issueAccessToken(user.id, userRoles);
  const refreshToken = issueRefreshToken(user.id, userRoles);

  return {
    accessToken,
    refreshToken,
    user: { id: user.id, email: user.email, fullName: user.full_name },
  };
}

export function refreshAccessToken(refreshToken: string) {
  const secret = getJwtSecret("JWT_REFRESH_SECRET");
  const payload = jwt.verify(refreshToken, secret);

  if (typeof payload === "string" || typeof payload.sub !== "string" || !Array.isArray(payload.roles)) {
    throw Object.assign(new Error("Invalid refresh token"), { status: 401 });
  }

  const roles = payload.roles.filter((role): role is Role =>
    ["CUSTOMER", "STAFF", "MANAGER", "ADMIN", "OWNER"].includes(String(role))
  );

  if (roles.length !== payload.roles.length) {
    throw Object.assign(new Error("Invalid refresh token"), { status: 401 });
  }

  return issueAccessToken(payload.sub, roles);
}
