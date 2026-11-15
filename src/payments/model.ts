export type PaymentMethod = "USDT" | "CELOHT_DAPP";

export type PaymentNetwork = "BEP20" | "TRC20" | "SOLANA" | "CELO";

export type PaymentStatus =
  | "PENDING"
  | "VERIFYING"
  | "PAID"
  | "FAILED"
  | "EXPIRED"
  | "CANCELLED"
  | "REFUNDED";

export interface Payment {
  id: string;
  customerId: string;
  orderId?: string;
  bookingId?: string;
  method: PaymentMethod;
  asset: "USDT" | null;
  network: PaymentNetwork | null;
  amount: string;
  currency: string;
  receivingAddress: string | null;
  transactionHash: string | null;
  status: PaymentStatus;
  createdAt: string;
  updatedAt: string;
  verifiedAt: string | null;
}

export function assertSinglePaymentTarget(orderId?: string, bookingId?: string) {
  if (Boolean(orderId) === Boolean(bookingId)) {
    throw new Error("A payment must reference exactly one of orderId or bookingId");
  }
}
