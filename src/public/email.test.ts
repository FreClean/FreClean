import { afterEach, describe, expect, it, vi } from "vitest";
import { sendPublicEnquiryEmail } from "./email.js";

const enquiry = {
  type: "SERVICE" as const,
  fullName: "Jean Pierre",
  email: "jean@example.com",
  service: "Residential cleaning",
  message: "I would like a cleaning estimate for my home.",
};

describe("public enquiry email delivery", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CONTACT_EMAIL;
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;
  });

  it("sends a timestamped customer enquiry to the configured inbox with a safe HTML template", async () => {
    process.env.CONTACT_EMAIL = "contact@freclean.com";
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.RESEND_FROM_EMAIL = "FreClean <enquiries@example.com>";
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await sendPublicEnquiryEmail(enquiry, "contact@freclean.com", "public-enquiry-id");

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(requestInit.body));
    expect(body).toEqual(expect.objectContaining({
      to: ["contact@freclean.com"],
      reply_to: "jean@example.com",
      subject: "New FreClean Service Enquiry",
      text: expect.stringContaining("Name:\nJean Pierre"),
      html: expect.stringContaining("New FreClean Service Enquiry"),
    }));
    expect(body.from).toBe("FreClean <enquiries@example.com>");
    expect(body.text).toContain("Email:\njean@example.com");
    expect(body.text).toContain("Message:\nI would like a cleaning estimate for my home.");
    expect(body.text).toContain("Submitted:\n");
    expect(body.html).toContain("Submitted");
    expect(body.html).not.toContain("<script>");
    expect(fetchMock).toHaveBeenCalledWith("https://api.resend.com/emails", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({
        Authorization: "Bearer re_test_key",
        "Idempotency-Key": "public-enquiry-id",
      }),
    }));
  });

  it("preserves enquiry type and notes while escaping customer content in HTML", async () => {
    process.env.CONTACT_EMAIL = "contact@freclean.com";
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.RESEND_FROM_EMAIL = "FreClean <enquiries@example.com>";
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await sendPublicEnquiryEmail({
      ...enquiry,
      type: "CONTACT",
      notes: "Please call after 3pm.",
      message: "<script>alert(1)</script>",
    });

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.subject).toBe("New FreClean Contact Enquiry");
    expect(body.text).toContain("Enquiry type: CONTACT");
    expect(body.text).toContain("Additional notes: Please call after 3pm.");
    expect(body.html).toContain("Enquiry type");
    expect(body.html).toContain("Additional notes");
    expect(body.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(body.html).not.toContain("<script>");
  });

  it("converts provider failures into a non-success response error", async () => {
    process.env.CONTACT_EMAIL = "contact@freclean.com";
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.RESEND_FROM_EMAIL = "FreClean <enquiries@example.com>";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 422 })));

    await expect(sendPublicEnquiryEmail(enquiry)).rejects.toMatchObject({ status: 502 });
  });
});