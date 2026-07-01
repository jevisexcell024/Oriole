import { nanoid } from "nanoid";

/**
 * Provider-agnostic SMS / WhatsApp sender.
 *
 * Mock by default — messages are only logged, never delivered — so the app runs
 * with zero configuration. Set `SMS_PROVIDER=twilio` plus Twilio credentials to
 * actually deliver. Mirrors the mailer's mock/live design (server/mailer.ts).
 *
 *   SMS_PROVIDER          "mock" (default) | "twilio"
 *   SMS_CHANNEL           "sms" (default)  | "whatsapp"
 *   TWILIO_ACCOUNT_SID    Twilio account SID
 *   TWILIO_AUTH_TOKEN     Twilio auth token
 *   TWILIO_FROM           sender number, e.g. +14155551234
 *   TWILIO_WHATSAPP_FROM  WhatsApp sender (falls back to TWILIO_FROM)
 */
const MODE = (process.env.SMS_PROVIDER || "mock").toLowerCase();
const CHANNEL = (process.env.SMS_CHANNEL || "sms").toLowerCase() === "whatsapp" ? "whatsapp" : "sms";

export interface SmsMessage {
  id: string;
  to: string;
  body: string;
  at: string;
  delivery: "logged" | "sent" | "failed";
  error: string | null;
  channel: "sms" | "whatsapp";
}

const log: SmsMessage[] = [];
let lastError: string | null = null;

export function smsEnabled(): boolean {
  return MODE === "twilio";
}

function fromAddress(): string | null {
  if (CHANNEL === "whatsapp") return process.env.TWILIO_WHATSAPP_FROM || process.env.TWILIO_FROM || null;
  return process.env.TWILIO_FROM || null;
}

/** Send one message. Always records to the in-memory log (delivery audit trail). */
export async function sendSms(to: string, body: string): Promise<{ delivery: SmsMessage["delivery"]; error: string | null }> {
  let delivery: SmsMessage["delivery"] = "logged";
  let error: string | null = null;

  if (MODE === "twilio") {
    try {
      const sid = process.env.TWILIO_ACCOUNT_SID;
      const token = process.env.TWILIO_AUTH_TOKEN;
      const from = fromAddress();
      if (!sid || !token || !from) throw new Error("Twilio is selected but TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM are not all set.");
      const toAddr = CHANNEL === "whatsapp" ? `whatsapp:${to}` : to;
      const fromAddr = CHANNEL === "whatsapp" && !from.startsWith("whatsapp:") ? `whatsapp:${from}` : from;
      const params = new URLSearchParams({ To: toAddr, From: fromAddr, Body: body });
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: "POST",
        headers: {
          Authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64"),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Twilio ${res.status}: ${text.slice(0, 200)}`);
      }
      delivery = "sent";
    } catch (e) {
      delivery = "failed";
      error = (e as Error).message;
      lastError = error;
    }
  }

  const msg: SmsMessage = { id: nanoid(10), to, body, at: new Date().toISOString(), delivery, error, channel: CHANNEL };
  log.unshift(msg);
  if (log.length > 200) log.length = 200;
  return { delivery, error };
}

export function smsStatus() {
  return { mode: MODE, channel: CHANNEL, live: MODE === "twilio", from: fromAddress(), lastError };
}

export function recentSms(limit = 50): SmsMessage[] {
  return log.slice(0, limit);
}
