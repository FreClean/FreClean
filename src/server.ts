import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { pinoHttp } from "pino-http";

import { authRouter } from "./auth/router.js";
import { bookingsRouter } from "./bookings/router.js";
import { paymentsRouter } from "./payments/router.js";
import { pool } from "./db.js";
import { validateEnvironment } from "./config.js";
import { ZodError } from "zod";
import { disputesRouter } from "./disputes/router.js";

validateEnvironment();
export const app = express();

app.use(helmet());
const allowedOrigins = new Set((process.env.CORS_ORIGIN ?? "").split(",").map((origin) => origin.trim()).filter(Boolean));
app.use(cors({
  credentials: true,
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error("Origin is not allowed"));
  },
}));
app.use(express.json({
  limit: "1mb",
  verify: (req, _res, buffer) => {
    if (req.url === "/api/payments/card/webhook") {
      (req as typeof req & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
    }
  },
}));
app.use(pinoHttp());
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 300 }));

app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.get("/health/ready", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok", database: "ok" });
  } catch {
    res.status(503).json({ status: "unavailable", database: "unavailable" });
  }
});

app.use("/api/auth", authRouter);
app.use("/api/bookings", bookingsRouter);
app.use("/api/payments", paymentsRouter);
app.use("/api/disputes", disputesRouter);

// Central error handler — never leak internals to the client.
app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  req.log?.error(err);
  if (err instanceof ZodError) {
    return res.status(400).json({ error: "Invalid request", details: err.flatten().fieldErrors });
  }
  const status = err.status ?? 500;
  res.status(status).json({ error: status === 500 ? "Internal server error" : err.message });
});

if (process.env.NODE_ENV !== "test") {
  const port = Number(process.env.PORT ?? 4000);
  const server = app.listen(port, () => console.log(`FreClean core listening on :${port}`));
  const shutdown = (signal: string) => {
    console.log(`${signal} received; shutting down`);
    server.close(() => pool.end().then(() => process.exit(0)));
  };
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}
