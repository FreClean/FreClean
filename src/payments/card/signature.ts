import crypto from "node:crypto";

export function verifyWebhookSignature(rawBody: Buffer, signatureHeader: string, secret: string): boolean {
  if (!secret || !signatureHeader) return false;

  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const received = Buffer.from(signatureHeader, "hex");
  const expectedBytes = Buffer.from(expected, "hex");
  return received.length === expectedBytes.length && crypto.timingSafeEqual(received, expectedBytes);
}