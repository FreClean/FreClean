import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { requireAuthentication } from "../auth/middleware.js";
import { requireRole } from "../roles/rbac.js";
import { createPayment, getPayment, listPayments, submitTransactionHash } from "./service.js";

export const paymentsRouter = Router();

const createPaymentSchema = z.object({
  orderId: z.string().uuid().optional(),
  bookingId: z.string().uuid().optional(),
  paymentMethod: z.enum(["USDT", "CELOHT_DAPP"]),
  network: z.enum(["BEP20", "TRC20", "SOLANA", "CELO"]).optional(),
}).strict().superRefine((body, context) => {
  if (Boolean(body.orderId) === Boolean(body.bookingId)) {
    context.addIssue({ code: "custom", message: "Provide exactly one orderId or bookingId" });
  }
  if (body.paymentMethod === "USDT" && !body.network) {
    context.addIssue({ code: "custom", message: "USDT payments require a network" });
  }
  if (body.paymentMethod === "CELOHT_DAPP" && body.network) {
    context.addIssue({ code: "custom", message: "CeloHT DApp does not use a USDT network" });
  }
});

const transactionSchema = z.object({
  transactionHash: z.string().trim().min(32).max(128).regex(/^[A-Za-z0-9]+$/),
}).strict();

const verifyRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});

paymentsRouter.post("/", requireAuthentication, async (req, res, next) => {
  try {
    const body = createPaymentSchema.parse(req.body);
    if (body.paymentMethod === "USDT" && process.env.USDT_PAYMENTS_ENABLED !== "true") {
      return res.status(503).json({ error: "USDT payments are not enabled" });
    }
    const idempotencyKey = req.header("Idempotency-Key");
    if (!idempotencyKey) return res.status(400).json({ error: "Idempotency-Key header is required" });
    const created = await createPayment({
      customerId: req.user!.id,
      orderId: body.orderId,
      bookingId: body.bookingId,
      method: body.paymentMethod,
      network: body.network,
      idempotencyKey,
    });
    res.status(201).json(created);
  } catch (error) {
    next(error);
  }
});

paymentsRouter.post("/:paymentId/transaction", requireAuthentication, verifyRateLimit, async (req, res, next) => {
  try {
    const paymentId = z.string().uuid().parse(req.params.paymentId);
    const body = transactionSchema.parse(req.body);
    if (process.env.USDT_PAYMENTS_ENABLED !== "true") {
      return res.status(503).json({ error: "USDT payments are not enabled" });
    }
    const payment = await submitTransactionHash({
      paymentId,
      customerId: req.user!.id,
      transactionHash: body.transactionHash,
    });
    res.json({ payment });
  } catch (error) {
    next(error);
  }
});

paymentsRouter.get("/admin", requireAuthentication, requireRole("ADMIN"), async (req, res, next) => {
  try {
    const limit = z.coerce.number().int().min(1).max(100).default(50).parse(req.query.limit);
    res.json({ payments: await listPayments(limit) });
  } catch (error) {
    next(error);
  }
});

paymentsRouter.get("/:paymentId", requireAuthentication, async (req, res, next) => {
  try {
    const paymentId = z.string().uuid().parse(req.params.paymentId);
    const payment = await getPayment(paymentId, req.user!.id);
    if (!payment) return res.status(404).json({ error: "Payment not found" });
    res.json({ payment });
  } catch (error) {
    next(error);
  }
});
