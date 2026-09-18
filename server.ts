import "dotenv/config";
import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";

import { authRouter } from "./auth/router.js";
import { bookingsRouter } from "./bookings/router.js";
import { paymentsRouter } from "./payments/router.js";

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(",") ?? true, credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(pinoHttp());
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 300 }));

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.use("/api/auth", authRouter);
app.use("/api/bookings", bookingsRouter);
app.use("/api/payments", paymentsRouter);

// Central error handler — never leak internals to the client.
app.use((err: any, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  req.log?.error(err);
  const status = err.status ?? 500;
  res.status(status).json({ error: status === 500 ? "Internal server error" : err.message });
});

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => console.log(`FreClean core listening on :${port}`));
