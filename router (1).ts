import { Router } from "express";
import { requireRole } from "../roles/rbac.js";
import { recordCashPayment } from "./cash/record.js";
import { verifyWebhookSignature, handleCardWebhook } from "./card/webhook.js";

export const paymentsRouter = Router();

// Staff-only: record a cash payment collected face-to-face.
paymentsRouter.post("/cash", requireRole("STAFF"), async (req, res, next) => {
  try {
    const staffId = (req as any).user.staffId;
    await recordCashPayment({ staffId, ...req.body });
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
      JSON.stringify(req.body),
      signature,
      process.env.CARD_PROCESSOR_WEBHOOK_SECRET!
    );
    if (!valid) return res.status(400).json({ error: "Invalid signature" });

    const result = await handleCardWebhook(req.body.event, req.body.expectedAmountCents);
    res.json(result);
  } catch (err) {
    next(err);
  }
});
