import { createHmac } from "node:crypto";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { createPublicEnquiry, listPublicEnquiries, updatePublicEnquiryStatus } from "./service.js";
import { requireAuthentication, requirePermission } from "../auth/middleware.js";

const cleanText = z.string().transform((value) => value.trim().replace(/[\u0000-\u001F\u007F]/g, " "));
const phonePattern = /^\+?[0-9][0-9 ()\-.]{5,30}[0-9]$/;

export const publicRequestSchema = z.object({
  type: z.enum(["SERVICE", "CONTACT"]).optional(),
  fullName: cleanText.pipe(z.string().min(2).max(100)).optional(),
  name: cleanText.pipe(z.string().min(2).max(100)).optional(),
  email: z.string().trim().max(254).email().transform((value) => value.toLowerCase()),
  phone: z.union([
    z.string().trim().regex(phonePattern).max(32).transform((value) => value.replace(/[^+0-9]/g, "")),
    z.literal("").transform(() => undefined),
  ]).optional(),
  service: cleanText.pipe(z.string().min(1).max(100)).optional(),
  property_type: cleanText.pipe(z.string().min(1).max(100)).optional(),
  space_size: cleanText.pipe(z.string().min(1).max(100)).optional(),
  date: z.string().date().optional(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  location: cleanText.pipe(z.string().min(1).max(500)).optional(),
  notes: cleanText.pipe(z.string().min(10).max(5000)).optional(),
  payment_method: cleanText.pipe(z.string().min(1).max(100)).optional(),
  message: cleanText.pipe(z.string().min(10).max(5000)).optional(),
  website: z.literal("").optional(),
}).strict().superRefine((body, context) => {
  if (!body.fullName && !body.name) context.addIssue({ code: "custom", path: ["name"], message: "Name is required" });
  if (!body.message && !body.notes) context.addIssue({ code: "custom", path: ["message"], message: "Message or notes are required" });
});

export const publicRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests" },
});

export const publicRequestsRouter = Router();

publicRequestsRouter.get("/requests",
  requireAuthentication,
  requirePermission("public_enquiry:view"),
  async (_req, res, next) => {
    try {
      res.json({ requests: await listPublicEnquiries() });
    } catch (error) {
      next(error);
    }
  }
);

const statusSchema = z.object({
  status: z.enum(["NEW", "CONTACTED", "CLOSED", "SPAM"]),
}).strict();

publicRequestsRouter.patch("/requests/:id/status",
  requireAuthentication,
  requirePermission("public_enquiry:update"),
  async (req, res, next) => {
    try {
      const body = statusSchema.parse(req.body);
      if (!req.params.id) return res.status(404).json({ error: "Request not found" });
      const request = await updatePublicEnquiryStatus(req.params.id, body.status);
      if (!request) return res.status(404).json({ error: "Request not found" });
      res.json({ request });
    } catch (error) {
      next(error);
    }
  }
);

publicRequestsRouter.post("/requests", publicRequestLimiter, async (req, res, next) => {
  try {
    if (req.body?.website !== undefined && req.body.website !== "") {
      return res.status(400).json({ error: "Invalid request" });
    }

    const body = publicRequestSchema.parse(req.body);
    const fullName = body.fullName ?? body.name!;
    const message = body.message ?? body.notes!;
    const origin = req.get("origin") ?? "";
    const sourceOrigin = origin === "https://freclean.com" ? origin : "unknown";
    const spamSeed = `${body.email}|${fullName}|${message}|${body.service ?? ""}|${body.date ?? ""}|${body.time ?? ""}`.normalize("NFKC").toLowerCase();
    const spamHash = createHmac("sha256", process.env.ENQUIRY_SPAM_SECRET ?? "development-only-public-enquiry-hash")
      .update(spamSeed)
      .digest("hex");

    const requestId = await createPublicEnquiry({
      type: body.type ?? "SERVICE",
      fullName,
      email: body.email,
      phone: body.phone,
      service: body.service,
      propertyType: body.property_type,
      spaceSize: body.space_size,
      date: body.date,
      time: body.time,
      location: body.location,
      notes: body.notes,
      paymentMethod: body.payment_method,
      message,
      spamHash,
      sourceOrigin,
    });
    res.status(201).json({ received: true, requestId });
  } catch (error) {
    next(error);
  }
});
