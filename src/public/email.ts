const enquiryRecipient = "freclean7@gmail.com";

export interface PublicEnquiryEmail {
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
  message: string;
}

function requiredEnvironment(name: "RESEND_API_KEY" | "RESEND_FROM_EMAIL"): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

export async function sendPublicEnquiryEmail(enquiry: PublicEnquiryEmail): Promise<void> {
  const apiKey = requiredEnvironment("RESEND_API_KEY");
  const from = requiredEnvironment("RESEND_FROM_EMAIL");
  const lines = [
    `Name: ${enquiry.fullName}`,
    `Email: ${enquiry.email}`,
    enquiry.phone ? `Phone: ${enquiry.phone}` : undefined,
    enquiry.service ? `Service: ${enquiry.service}` : undefined,
    enquiry.propertyType ? `Property type: ${enquiry.propertyType}` : undefined,
    enquiry.spaceSize ? `Space size: ${enquiry.spaceSize}` : undefined,
    enquiry.date ? `Requested date: ${enquiry.date}` : undefined,
    enquiry.time ? `Requested time: ${enquiry.time}` : undefined,
    enquiry.location ? `Location: ${enquiry.location}` : undefined,
    enquiry.paymentMethod ? `Payment method: ${enquiry.paymentMethod}` : undefined,
    "",
    enquiry.message,
  ].filter((line): line is string => line !== undefined);

  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [enquiryRecipient],
        reply_to: enquiry.email,
        subject: `New FreClean enquiry from ${enquiry.fullName}`,
        text: lines.join("\n"),
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.name : "request_error";
    throw Object.assign(new Error(`Email provider request failed: ${reason}`), { status: 502 });
  }

  if (!response.ok) {
    throw Object.assign(new Error(`Email provider rejected the enquiry (HTTP ${response.status})`), { status: 502 });
  }
}