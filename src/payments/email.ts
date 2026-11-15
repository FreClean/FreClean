import type { PaymentNetwork } from "./model.js";
import { sendResendEmail } from "../notifications/resend.js";

export interface PaymentNotification {
  paymentId: string;
  customerName: string;
  customerEmail: string;
  orderId: string | null;
  bookingId: string | null;
  amount: string;
  network: PaymentNetwork;
  transactionHash: string;
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
  const details = [
    ["Customer", notification.customerName],
    ["Email", notification.customerEmail],
    ["Order/booking", target],
    ["Amount", `${notification.amount} USDT`],
    ["Network", notification.network],
    ["Transaction hash", notification.transactionHash],
    ["Payment status", notification.status],
  ] as const;
  const heading = notification.recipientType === "CUSTOMER" ? "USDT payment confirmed" : "FreClean payment received";
  const rows = details
    .map(([label, value]) => `<tr><th align="left">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`)
    .join("");

  await sendResendEmail(to, {
    subject: heading,
    text: `${heading}\n${details.map(([label, value]) => `${label}: ${value}`).join("\n")}`,
    html: `<div style="font-family:Arial,sans-serif;color:#1f2937"><h1>${heading}</h1><table>${rows}</table></div>`,
  }, `payment-${notification.paymentId}-${notification.recipientType.toLowerCase()}`);
}
