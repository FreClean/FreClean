import { Router } from "express";
import { requireRole } from "../roles/rbac.js";
import { recordCashPayment } from "./cash/record.js";
import { verifyWebhookSignature, handleCardWebhook } from "./card/webhook.js";
import { requireAuthentication } from "../auth/middleware.js";
import { z } from "zod";

export const paymentsRouter = Router();
const cashSchema = z.object({
  paymentId: z.string().uuid(),
  businessLocationId: z.string().uuid(),
  amountCents: z.number().int().nonnegative(),
  notes: z.string().max(1000).optional(),
}).strict();

// Staff-only: record a cash payment collected face-to-face.
paymentsRouter.post("/cash", requireAuthentication, requireRole("STAFF"), async (req, res, next) => {
  try {
    const body = cashSchema.parse(req.body);
    await recordCashPayment({ userId: req.user!.id, ...body });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Card processor webhook — public endpoint, protected by signature check.
paymentsRouter.post("/card/webhook", async (req, res, next) => {
  try {
    const signature = req.header("X-Webhook-Signature") ?? "";
    const valid = verifyWebhookSignature(
      req.rawBody ?? Buffer.from([]),
      signature,
      process.env.CARD_PROCESSOR_WEBHOOK_SECRET ?? ""
    );
    if (!valid) return res.status(400).json({ error: "Invalid signature" });

    const event = z.object({
      eventId: z.string().min(1).max(200),
      chargeId: z.string().min(1).max(200),
      paymentId: z.string().uuid(),
      amountCents: z.number().int().nonnegative(),
      status: z.enum(["succeeded", "failed"]),
    }).parse(req.body.event);
    const result = await handleCardWebhook(event);
    res.json(result);
  } catch (err) {
    next(err);
  }
});
