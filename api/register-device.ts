import type { VercelRequest, VercelResponse } from "@vercel/node";
import { getAdminMessaging } from "./_firebase.js";

const MAX_TOKEN_LENGTH = 4096;

export default async function handler(
  request: VercelRequest,
  response: VercelResponse,
) {
  if (request.method !== "POST") {
    return response.status(405).json({ error: "Method not allowed" });
  }

  const token =
    typeof request.body?.token === "string" ? request.body.token : "";
  if (!token || token.length > MAX_TOKEN_LENGTH) {
    return response
      .status(400)
      .json({ error: "A valid device token is required" });
  }

  try {
    await getAdminMessaging().subscribeToTopic([token], "signal-lab");
    return response.status(200).json({ message: "Device registered" });
  } catch (error) {
    console.error(error);
    return response.status(500).json({ error: "Could not register device" });
  }
}
