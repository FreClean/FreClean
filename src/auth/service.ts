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

export async function registerCustomer(email: string, password: string, fullName: string) {
  const existing = await query<UserRecord>("SELECT id FROM users WHERE email = $1", [email]);
  if (existing.length > 0) {
    throw Object.assign(new Error("Email already registered"), { status: 409 });
  }

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

  const [user] = await query<UserRecord>(
    `INSERT INTO users (email, password_hash, full_name)
     VALUES ($1, $2, $3) RETURNING id, email, full_name`,
    [email, passwordHash, fullName]
  );

  await query(
    `INSERT INTO user_roles (user_id, role_id)
     SELECT $1, id FROM roles WHERE name = 'CUSTOMER'`,
    [user!.id]
  );

  return user;
}

export async function login(email: string, password: string) {
  const [user] = await query<UserRecord>("SELECT * FROM users WHERE email = $1", [email]);
  if (!user) {
    // Same error for "no such user" and "wrong password" — don't leak which.
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

  const accessToken = jwt.sign(
    { sub: user.id, roles: roles.map((r) => r.name) },
    process.env.JWT_ACCESS_SECRET!,
    { expiresIn: (process.env.JWT_ACCESS_TTL ?? "15m") as SignOptions["expiresIn"] }
  );

  return { accessToken, user: { id: user.id, email: user.email, fullName: user.full_name } };
}
