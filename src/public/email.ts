import { sendResendEmail } from "../notifications/resend.js";

export interface PublicEnquiryEmail {
  type: "SERVICE" | "CONTACT";
  fullName: string;
  email: string;
  phone?: string;
  service?: string;
  propertyType?: string;
  spaceSize?: string;
  date?: string;
  time?: string;
  location?: string;
  paymentMethod?: string;
  notes?: string;
  message: string;
  submittedAt?: string;
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

export async function sendPublicEnquiryEmail(
  enquiry: PublicEnquiryEmail,
  to = process.env.CONTACT_EMAIL?.trim() ?? "",
  idempotencyKey?: string
): Promise<void> {
  const submittedAt = enquiry.submittedAt ?? new Date().toISOString();
  const fields: Array<[string, string | undefined]> = [
    ["Enquiry type", enquiry.type],
    ["Name", enquiry.fullName],
    ["Email", enquiry.email],
    ["Phone", enquiry.phone],
    ["Service", enquiry.service],
    ["Property type", enquiry.propertyType],
    ["Space size", enquiry.spaceSize],
    ["Requested date", enquiry.date],
    ["Requested time", enquiry.time],
    ["Location", enquiry.location],
    ["Payment method", enquiry.paymentMethod],
    ["Additional notes", enquiry.notes === enquiry.message ? undefined : enquiry.notes],
  ];
  const subject = enquiry.type === "CONTACT"
    ? "New FreClean Contact Enquiry"
    : "New FreClean Service Enquiry";
  const lines = [
    subject,
    "",
    "Name:",
    enquiry.fullName,
    "",
    "Email:",
    enquiry.email,
    "",
    "Message:",
    enquiry.message,
    "",
    "Submitted:",
    `${submittedAt} UTC`,
    "",
    ...fields
      .filter(([label, value]) => Boolean(value) && !["Name", "Email"].includes(label))
      .map(([label, value]) => `${label}: ${value}`),
  ];
  const htmlRows = fields
    .filter((field): field is [string, string] => Boolean(field[1]))
    .map(([label, value]) => `<tr><th align="left">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`)
    .join("");

  await sendResendEmail(to, {
    reply_to: enquiry.email,
    subject,
    text: lines.join("\n"),
    html: `<div style="font-family:Arial,sans-serif;color:#1f2937;max-width:640px;margin:auto"><div style="background:#0f766e;color:#fff;padding:20px 24px"><h1 style="margin:0;font-size:22px">${subject}</h1></div><div style="padding:24px"><p>A customer has submitted an enquiry through the FreClean website.</p><table style="border-collapse:collapse;width:100%">${htmlRows}<tr><th align="left">Submitted</th><td>${escapeHtml(submittedAt)} UTC</td></tr></table><h2 style="font-size:16px;margin-top:24px">Message</h2><p style="white-space:pre-wrap">${escapeHtml(enquiry.message)}</p><p style="color:#6b7280;font-size:12px">Reply directly to this email to respond to ${escapeHtml(enquiry.fullName)}.</p></div></div>`,
  }, idempotencyKey);
}
