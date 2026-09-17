import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomUUID } from "node:crypto";
import { getAdminMessaging } from "./_firebase.js";

const DEFAULT_MESSAGE = "This is a notification test from Signal Lab.";
const DEFAULT_SENDER = "Unnamed device";
const MAX_MESSAGE_LENGTH = 240;
const MAX_SENDER_LENGTH = 40;

export default async function handler(
  request: VercelRequest,
  response: VercelResponse,
) {
  if (request.method !== "POST") {
    return response.status(405).json({ error: "Method not allowed" });
  }

  try {
    const requestedMessage =
      typeof request.body?.message === "string"
        ? request.body.message.trim().slice(0, MAX_MESSAGE_LENGTH)
        : "";
    const requestedSender =
      typeof request.body?.sender === "string"
        ? request.body.sender.trim().slice(0, MAX_SENDER_LENGTH)
        : "";
    const message = requestedMessage || DEFAULT_MESSAGE;
    const sender = requestedSender || DEFAULT_SENDER;
    const eventId = randomUUID();
    const sentAt = new Date().toISOString();
    await getAdminMessaging().send({
      topic: "signal-lab",
      data: {
        eventId,
        sentAt,
        title: `Signal Lab · from ${sender}`,
        body: `${message} | ID ${eventId.slice(0, 8)} | ${sentAt} UTC`,
        url: process.env.APP_URL || "/",
      },
    });
    return response.status(200).json({
      message: `Notification sent · ID ${eventId.slice(0, 8)} · ${sentAt} UTC`,
    });
  } catch (error) {
    console.error(error);
    return response.status(500).json({
      error: "Could not send notification. Check server configuration.",
    });
  }
}
