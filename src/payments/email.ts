import type { PaymentMethod, PaymentNetwork } from "./model.js";
import { sendResendEmail } from "../notifications/resend.js";

export interface PaymentNotification {
  paymentId: string;
  customerName: string;
  customerEmail: string;
  orderId: string | null;
  bookingId: string | null;
  paymentMethod: PaymentMethod;
  amount: string;
  currency: string;
  network: PaymentNetwork | null;
  transactionHash: string | null;
  status: "PAID";
  recipientType: "CUSTOMER" | "ADMIN";
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character]!);
}

export async function sendPaymentNotification(notification: PaymentNotification, to: string): Promise<void> {
  const target = notification.orderId
    ? `Order ${notification.orderId}`
    : `Booking ${notification.bookingId}`;
  const details: [string, string][] = [
    ["Customer", notification.customerName],
    ["Email", notification.customerEmail],
    ["Order/booking", target],
    ["Payment method", notification.paymentMethod === "USDT" ? "USDT" : "CeloHT DApp"],
    ["Amount", `${notification.amount} ${notification.currency}`],
    ["Payment status", notification.status],
  ];
  if (notification.network) details.push(["Network", notification.network]);
  if (notification.transactionHash) details.push(["Transaction hash", notification.transactionHash]);
  const heading = notification.paymentMethod === "USDT"
    ? notification.recipientType === "CUSTOMER" ? "USDT payment confirmed" : "FreClean payment received"
    : "CeloHT payment confirmed";
  const rows = details
    .map(([label, value]) => `<tr><th align="left">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`)
    .join("");

  await sendResendEmail(to, {
    subject: heading,
    text: `${heading}\n${details.map(([label, value]) => `${label}: ${value}`).join("\n")}`,
    html: `<div style="font-family:Arial,sans-serif;color:#1f2937"><h1>${heading}</h1><table>${rows}</table></div>`,
  }, `payment-${notification.paymentId}-${notification.recipientType.toLowerCase()}`);
}
