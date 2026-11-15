import type { PaymentNetwork } from "./model.js";

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

function requiredEnvironment(name: "RESEND_API_KEY" | "RESEND_FROM_EMAIL"): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
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
  const apiKey = requiredEnvironment("RESEND_API_KEY");
  const from = requiredEnvironment("RESEND_FROM_EMAIL");
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

  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `payment-${notification.paymentId}-${notification.recipientType.toLowerCase()}`,
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject: heading,
        text: `${heading}\n${details.map(([label, value]) => `${label}: ${value}`).join("\n")}`,
        html: `<div style="font-family:Arial,sans-serif;color:#1f2937"><h1>${heading}</h1><table>${rows}</table></div>`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.name : "request_error";
    throw new Error(`Payment notification provider request failed: ${reason}`);
  }
  if (!response.ok) throw new Error(`Payment notification provider returned HTTP ${response.status}`);
}
