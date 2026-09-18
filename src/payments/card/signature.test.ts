import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyWebhookSignature } from "./signature.js";

describe("card webhook signatures", () => {
  it("accepts a signature for the exact raw payload", () => {
    const body = Buffer.from('{"event":"paid"}');
    const signature = crypto.createHmac("sha256", "test-secret").update(body).digest("hex");

    expect(verifyWebhookSignature(body, signature, "test-secret")).toBe(true);
  });

  it("rejects malformed, truncated, or altered signatures", () => {
    const body = Buffer.from('{"event":"paid"}');
    const signature = crypto.createHmac("sha256", "test-secret").update(body).digest("hex");

    expect(verifyWebhookSignature(body, signature.slice(0, -2), "test-secret")).toBe(false);
    expect(verifyWebhookSignature(Buffer.from('{"event":"failed"}'), signature, "test-secret")).toBe(false);
    expect(verifyWebhookSignature(body, "not-hex", "test-secret")).toBe(false);
  });
});
