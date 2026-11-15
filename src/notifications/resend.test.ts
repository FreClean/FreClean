import { describe, expect, it } from "vitest";
import { safeNotificationErrorDetails } from "./resend.js";

describe("notification error logging", () => {
  it("returns diagnostic fields without including exception messages or secrets", () => {
    const secret = "re_super_secret_provider_key";
    const error = Object.assign(new Error(`provider failed with ${secret}`), {
      code: "ECONNRESET",
      notificationStage: "outbox_claim",
    });

    const details = safeNotificationErrorDetails(error);

    expect(details).toEqual({
      errorType: "Error",
      errorCode: "ECONNRESET",
      stage: "outbox_claim",
    });
    expect(JSON.stringify(details)).not.toContain(secret);
  });
});
