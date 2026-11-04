import { createHmac } from "node:crypto";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { createPublicEnquiry } from "./service.js";

const cleanText = z.string().transform((value) => value.trim().replace(/[\u0000-\u001F\u007F]/g, " "));
const phonePattern = /^\+?[0-9][0-9 ()\-.]{5,30}[0-9]$/;

export const publicRequestSchema = z.object({
  type: z.enum(["SERVICE", "CONTACT"]),
  fullName: cleanText.pipe(z.string().min(2).max(100)),
  email: z.string().trim().max(254).email().transform((value) => value.toLowerCase()),
  phone: z.union([
    z.string().trim().regex(phonePattern).max(32).transform((value) => value.replace(/[^+0-9]/g, "")),
    z.literal("").transform(() => undefined),
  ]).optional(),
  service: cleanText.pipe(z.string().min(1).max(100)).optional(),
  message: cleanText.pipe(z.string().min(10).max(5000)),
  website: z.literal("").optional(),
}).strict();

export const publicRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests" },
});

export const publicRequestsRouter = Router();

publicRequestsRouter.post("/requests", publicRequestLimiter, async (req, res, next) => {
  try {
    if (req.body?.website !== undefined && req.body.website !== "") {
      return res.status(400).json({ error: "Invalid request" });
    }

    const body = publicRequestSchema.parse(req.body);
    const origin = req.get("origin") ?? "";
    const sourceOrigin = origin === "https://freclean.com" ? origin : "unknown";
    const spamSeed = `${body.email}|${body.fullName}|${body.message}`.normalize("NFKC").toLowerCase();
    const spamHash = createHmac("sha256", process.env.ENQUIRY_SPAM_SECRET ?? "development-only-public-enquiry-hash")
      .update(spamSeed)
      .digest("hex");

    const requestId = await createPublicEnquiry({ ...body, spamHash, sourceOrigin });
    res.status(201).json({ received: true, requestId });
  } catch (error) {
    next(error);
  }
});
