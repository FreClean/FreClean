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
import { publicRequestsRouter } from "./public/requests.js";

validateEnvironment();
export const app = express();

app.use(helmet());
const isProduction = process.env.NODE_ENV === "production";
const allowedOrigins = isProduction
  ? new Set(["https://freclean.com"])
  : new Set((process.env.CORS_ORIGIN ?? "http://localhost:3000").split(",").map((origin) => origin.trim()).filter(Boolean));
app.use(cors({
  credentials: true,
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    const error = Object.assign(new Error("Origin is not allowed"), { status: 403 });
    return callback(error);
  },
}));
app.use(express.json({
  limit: "64kb",
  verify: (req, _res, buffer) => {
    if (req.url === "/api/public/requests" && buffer.byteLength > 16 * 1024) {
      throw Object.assign(new Error("Request body too large"), { status: 413 });
    }
    if (req.url === "/api/payments/card/webhook") {
      (req as typeof req & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
    }
  },
}));
app.use(pinoHttp());
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 300 }));

app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.get("/health/ready", async (req, res) => {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      pool.query("SELECT 1"),
      new Promise<never>((_resolve, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error("database readiness timeout")), 5000);
      }),
    ]);
    res.json({ status: "ok", database: "ok" });
  } catch (error) {
    const databaseError = error as { code?: string };
    req.log?.warn({ databaseErrorCode: databaseError.code ?? "timeout_or_connection_error" }, "Database readiness check failed");
    res.status(503).json({ status: "unavailable", database: "unavailable" });
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
});

app.use("/api/auth", authRouter);
app.use("/api/bookings", bookingsRouter);
app.use("/api/public", publicRequestsRouter);
app.use("/api/payments", paymentsRouter);
app.use("/api/disputes", disputesRouter);

// Central error handler — never leak internals to the client.
app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  req.log?.error(err);
  if (err instanceof ZodError) {
    return res.status(400).json({ error: "Invalid request", details: err.flatten().fieldErrors });
  }
  if (err?.type === "entity.too.large") {
    return res.status(413).json({ error: "Request body too large" });
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
