import type { VercelRequest, VercelResponse } from "@vercel/node";
import { randomUUID } from "node:crypto";
import { getAdminMessaging } from "./_firebase.js";

export default async function handler(
  request: VercelRequest,
  response: VercelResponse,
) {
  if (request.method !== "POST")
    return response.status(405).json({ error: "Method not allowed" });

  try {
    const message =
      typeof request.body?.message === "string"
        ? request.body.message.trim().slice(0, 240)
        : "This is a notification test from Signal Lab.";
    const sender =
      typeof request.body?.sender === "string"
        ? request.body.sender.trim().slice(0, 40)
        : "Unnamed device";
    const eventId = randomUUID();
    const sentAt = new Date().toISOString();
    await getAdminMessaging().send({
      topic: "signal-lab",
      data: {
        eventId,
        sentAt,
        title: `Signal Lab · from ${sender}`,
        body: `${message} | ID ${eventId.slice(0, 8)} | ${sentAt} UTC`,
        url: process.env.APP_URL || "https://example.com",
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
