export type PaymentMethod = "CRYPTO" | "CARD" | "CASH";

export type PaymentStatus =
  | "CREATED" | "PENDING" | "PROCESSING" | "VERIFIED" | "COMPLETED"
  | "FAILED" | "CANCELLED" | "EXPIRED" | "REJECTED";

export interface Payment {
  id: string;
  method: PaymentMethod;
  status: PaymentStatus;
  amountCents: number;
  currency: string; // USD, or asset symbol for crypto (cUSD, CELO)
  orderId?: string;
  bookingId?: string;
  verificationStatus: "UNVERIFIED" | "VERIFIED" | "FAILED";
  reconciliationStatus?: "RECORDED" | "RECONCILED" | "DISCREPANCY" | "CANCELLED";
}

// One payment must always be tied to exactly one order or booking.
export function assertSinglePaymentTarget(orderId?: string, bookingId?: string) {
  if (Boolean(orderId) === Boolean(bookingId)) {
    throw new Error("A payment must reference exactly one of orderId or bookingId");
  }
}
