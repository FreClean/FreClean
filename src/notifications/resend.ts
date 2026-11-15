export type NotificationErrorCode =
  | "CONFIGURATION"
  | "RESEND_REQUEST_FAILED"
  | "RESEND_REJECTED";

export class NotificationDeliveryError extends Error {
  readonly status = 502;

  constructor(
    readonly code: NotificationErrorCode,
    message: string,
    readonly httpStatus?: number
  ) {
    super(message);
    this.name = "NotificationDeliveryError";
  }
}

function isEmailAddress(value: string): boolean {
  return /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value);
}

function isValidFromAddress(value: string): boolean {
  if (/[\r\n]/.test(value)) return false;
  const displayNameMatch = value.match(/^(?:[^<>]*?)<([^<>]+)>$/);
  const address = displayNameMatch ? displayNameMatch[1]?.trim() : value;
  return Boolean(address && isEmailAddress(address));
}

function requiredEnvironment(name: "RESEND_API_KEY" | "RESEND_FROM_EMAIL"): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new NotificationDeliveryError("CONFIGURATION", `${name} is not configured`);
  }
  if (name === "RESEND_API_KEY" && !/^re_[A-Za-z0-9_-]+$/.test(value)) {
    throw new NotificationDeliveryError("CONFIGURATION", `${name} is invalid`);
  }
  if (name === "RESEND_FROM_EMAIL" && !isValidFromAddress(value)) {
    throw new NotificationDeliveryError("CONFIGURATION", `${name} is invalid`);
  }
  return value;
}

export function validateNotificationEnvironment(): void {
  const recipient = process.env.CONTACT_EMAIL?.trim();
  if (!recipient) {
    throw new NotificationDeliveryError("CONFIGURATION", "CONTACT_EMAIL is not configured");
  }
  if (!isEmailAddress(recipient)) {
    throw new NotificationDeliveryError("CONFIGURATION", "CONTACT_EMAIL is invalid");
  }
  requiredEnvironment("RESEND_API_KEY");
  requiredEnvironment("RESEND_FROM_EMAIL");
}

export async function sendResendEmail(
  recipient: string,
  email: Record<string, unknown>,
  idempotencyKey?: string
): Promise<void> {
  const apiKey = requiredEnvironment("RESEND_API_KEY");
  const from = requiredEnvironment("RESEND_FROM_EMAIL");
  if (!isEmailAddress(recipient)) {
    throw new NotificationDeliveryError("CONFIGURATION", "Notification recipient email is invalid");
  }

  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
      body: JSON.stringify({ ...email, from, to: [recipient] }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.name : "request_error";
    throw new NotificationDeliveryError("RESEND_REQUEST_FAILED", `Resend request failed: ${reason}`);
  }

  if (!response.ok) {
    throw new NotificationDeliveryError(
      "RESEND_REJECTED",
      `Resend rejected the email (HTTP ${response.status})`,
      response.status
    );
  }
}

export function safeNotificationErrorDetails(error: unknown): {
  errorType: string;
  errorCode?: string;
  httpStatus?: number;
  stage?: string;
} {
  const wrapped = error instanceof Error ? error as Error & {
    cause?: unknown;
    notificationStage?: unknown;
  } : undefined;
  let source: unknown = wrapped?.cause ?? error;
  for (let depth = 0; depth < 3 && source instanceof Error; depth += 1) {
    const cause = (source as Error & { cause?: unknown }).cause;
    if (!cause) break;
    source = cause;
  }
  const details = source && typeof source === "object"
    ? source as { name?: unknown; code?: unknown; httpStatus?: unknown }
    : {};
  const errorType = typeof details.name === "string" && /^[A-Za-z][A-Za-z0-9]{0,39}$/.test(details.name)
    ? details.name
    : "Error";
  const rawCode = error instanceof NotificationDeliveryError
    ? error.code
    : details.code;
  const errorCode = typeof rawCode === "string" && /^[A-Z0-9_]{1,32}$/.test(rawCode)
    ? rawCode
    : undefined;
  const httpStatus = error instanceof NotificationDeliveryError
    ? error.httpStatus
    : typeof details.httpStatus === "number" && Number.isInteger(details.httpStatus)
      && details.httpStatus >= 400 && details.httpStatus <= 599
      ? details.httpStatus
      : undefined;
  const rawStage = wrapped?.notificationStage;
  const stage = typeof rawStage === "string" && /^[a-z_]{1,32}$/.test(rawStage)
    ? rawStage
    : undefined;

  return {
    errorType,
    ...(errorCode ? { errorCode } : {}),
    ...(httpStatus ? { httpStatus } : {}),
    ...(stage ? { stage } : {}),
  };
}

export function safeNotificationErrorRecord(error: unknown): string {
  const details = safeNotificationErrorDetails(error);
  return [details.errorCode ?? details.errorType, details.httpStatus ? `HTTP_${details.httpStatus}` : undefined]
    .filter(Boolean)
    .join(":")
    .slice(0, 100);
}

export function notificationStageError(stage: string, cause: unknown): Error {
  const error = new Error("Notification outbox operation failed", { cause }) as Error & {
    notificationStage: string;
  };
  error.notificationStage = stage;
  return error;
}
