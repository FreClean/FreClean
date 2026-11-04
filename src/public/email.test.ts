import { afterEach, describe, expect, it, vi } from "vitest";
import { sendPublicEnquiryEmail } from "./email.js";

const enquiry = {
  fullName: "Jean Pierre",
  email: "jean@example.com",
  service: "Residential cleaning",
  message: "I would like a cleaning estimate for my home.",
};

describe("public enquiry email delivery", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;
  });

  it("sends the enquiry to the configured Resend sender and fixed business inbox", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.RESEND_FROM_EMAIL = "FreClean <enquiries@example.com>";
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await sendPublicEnquiryEmail(enquiry);

    expect(fetchMock).toHaveBeenCalledWith("https://api.resend.com/emails", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ Authorization: "Bearer re_test_key" }),
      body: JSON.stringify({
        from: "FreClean <enquiries@example.com>",
        to: ["freclean7@gmail.com"],
        reply_to: "jean@example.com",
        subject: "New FreClean enquiry from Jean Pierre",
        text: "Name: Jean Pierre\nEmail: jean@example.com\nService: Residential cleaning\n\nI would like a cleaning estimate for my home.",
      }),
    }));
  });

  it("converts provider failures into a non-success response error", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.RESEND_FROM_EMAIL = "FreClean <enquiries@example.com>";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 422 })));

    await expect(sendPublicEnquiryEmail(enquiry)).rejects.toMatchObject({ status: 502 });
  });
});