import { query, pool } from "../db.js";

interface AvailabilityCheck {
  businessLocationId: string;
  scheduledStart: string;
  scheduledEnd: string;
}

// Availability is ALWAYS calculated server-side against the DB — never
// trust an "available" flag coming from the client.
export async function isSlotAvailable({ businessLocationId, scheduledStart, scheduledEnd }: AvailabilityCheck) {
  const conflicts = await query(
    `SELECT id FROM bookings
     WHERE business_location_id = $1
       AND status NOT IN ('CANCELLED','REJECTED','FAILED')
       AND scheduled_start < $3
       AND scheduled_end > $2`,
    [businessLocationId, scheduledStart, scheduledEnd]
  );
  return conflicts.length === 0;
}

export async function requestBooking(input: {
  customerId: string;
  serviceId: string;
  businessLocationId: string;
  addressId: string;
  scheduledStart: string;
  scheduledEnd: string;
}) {
  const start = Date.parse(input.scheduledStart);
  const end = Date.parse(input.scheduledEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start <= Date.now() || end <= start) {
    throw Object.assign(new Error("Booking dates must be valid future times with an end after the start"), { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Lock at the transaction level to prevent race-condition double booking.
    await client.query("LOCK TABLE bookings IN SHARE ROW EXCLUSIVE MODE");

    const address = await client.query(
      "SELECT id FROM addresses WHERE id = $1 AND user_id = $2",
      [input.addressId, input.customerId]
    );
    if (address.rows.length === 0) {
      throw Object.assign(new Error("Address is not available"), { status: 404 });
    }

    const location = await client.query(
      "SELECT id FROM business_locations WHERE id = $1 AND active = true",
      [input.businessLocationId]
    );
    if (location.rows.length === 0) {
      throw Object.assign(new Error("Business location is not available"), { status: 404 });
    }

    const conflicts = await client.query(
      `SELECT id FROM bookings
       WHERE business_location_id = $1
         AND status NOT IN ('CANCELLED','REJECTED','FAILED')
         AND scheduled_start < $3 AND scheduled_end > $2`,
      [input.businessLocationId, input.scheduledStart, input.scheduledEnd]
    );
    if (conflicts.rows.length > 0) {
      throw Object.assign(new Error("Time slot no longer available"), { status: 409 });
    }

    const [service] = (
      await client.query(
        `SELECT sp.price_cents, sp.currency FROM service_pricing sp
         JOIN services s ON s.id = sp.service_id
         WHERE sp.service_id = $1 AND s.active = true AND sp.effective_from <= now()
         ORDER BY sp.effective_from DESC LIMIT 1`,
        [input.serviceId]
      )
    ).rows;
    if (!service) throw Object.assign(new Error("Service has no active pricing"), { status: 400 });

    const inserted = await client.query(
      `INSERT INTO bookings
        (customer_id, service_id, business_location_id, address_id,
         scheduled_start, scheduled_end, price_cents, currency)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [
        input.customerId,
        input.serviceId,
        input.businessLocationId,
        input.addressId,
        input.scheduledStart,
        input.scheduledEnd,
        service.price_cents,
        service.currency,
      ]
    );

    await client.query("COMMIT");
    return inserted.rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
