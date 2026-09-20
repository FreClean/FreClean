import { Router } from "express";
import { z } from "zod";
import { registerCustomer, login, refreshAccessToken } from "./service.js";
import rateLimit from "express-rate-limit";

export const authRouter = Router();
const authRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(12),
  fullName: z.string().min(2).max(120),
});

authRouter.post("/register", authRateLimit, async (req, res, next) => {
  try {
    const body = registerSchema.parse(req.body);
    const user = await registerCustomer(body.email, body.password, body.fullName);
    res.status(201).json({ user });
  } catch (err) {
    next(err);
  }
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const refreshSchema = z.object({
  refreshToken: z.string().min(20),
});

authRouter.post("/login", authRateLimit, async (req, res, next) => {
  try {
    const body = loginSchema.parse(req.body);
    const result = await login(body.email, body.password);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

authRouter.post("/refresh", authRateLimit, async (req, res, next) => {
  try {
    const body = refreshSchema.parse(req.body);
    const accessToken = refreshAccessToken(body.refreshToken);
    res.json({ accessToken });
  } catch (err) {
    next(err);
  }
});
