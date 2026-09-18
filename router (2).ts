import { Router } from "express";
import { z } from "zod";
import { requestBooking } from "./service.js";

export const bookingsRouter = Router();

const requestSchema = z.object({
  serviceId: z.string().uuid(),
  businessLocationId: z.string().uuid(),
  addressId: z.string().uuid(),
  scheduledStart: z.string().datetime(),
  scheduledEnd: z.string().datetime(),
});

bookingsRouter.post("/", async (req, res, next) => {
  try {
    // req.user is populated by an auth middleware (not shown) that verifies
    // the JWT and attaches { id, roles } — never taken from the request body.
    const customerId = (req as any).user.id;
    const body = requestSchema.parse(req.body);
    const booking = await requestBooking({ customerId, ...body });
    res.status(201).json({ booking });
  } catch (err) {
    next(err);
  }
});
