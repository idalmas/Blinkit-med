import { Hono } from "hono";
import { KJUR } from "jsrsasign";

const zoom = new Hono();

const ZOOM_MEETING_SDK_KEY = process.env.ZOOM_MEETING_SDK_KEY || "";
const ZOOM_MEETING_SDK_SECRET = process.env.ZOOM_MEETING_SDK_SECRET || "";

/**
 * POST /zoom/signature
 *
 * Generates a Meeting SDK JWT for joining a Zoom meeting via the Component View.
 *
 * Body: { meetingNumber: string, role: number (0=attendee, 1=host) }
 * Returns: { signature: string, sdkKey: string }
 */
zoom.post("/signature", async (c) => {
  const body = await c.req.json();
  const meetingNumber = String(body.meetingNumber || "");
  const role = typeof body.role === "string" ? parseInt(body.role) : (body.role ?? 0);

  if (!meetingNumber) {
    return c.json({ error: "meetingNumber is required" }, 400);
  }
  if (role !== 0 && role !== 1) {
    return c.json({ error: "role must be 0 (attendee) or 1 (host)" }, 400);
  }
  if (!ZOOM_MEETING_SDK_KEY || !ZOOM_MEETING_SDK_SECRET) {
    return c.json({ error: "Zoom SDK credentials not configured" }, 500);
  }

  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 60 * 60 * 2; // 2 hours

  const oHeader = { alg: "HS256", typ: "JWT" };
  const oPayload = {
    appKey: ZOOM_MEETING_SDK_KEY,
    sdkKey: ZOOM_MEETING_SDK_KEY,
    mn: meetingNumber,
    role,
    iat,
    exp,
    tokenExp: exp,
  };

  console.log("[zoom] Signing payload:", JSON.stringify(oPayload));

  const sHeader = JSON.stringify(oHeader);
  const sPayload = JSON.stringify(oPayload);
  const sdkJWT = KJUR.jws.JWS.sign(
    "HS256",
    sHeader,
    sPayload,
    ZOOM_MEETING_SDK_SECRET
  );

  console.log("[zoom] Generated signature for meeting:", meetingNumber);

  return c.json({ signature: sdkJWT, sdkKey: ZOOM_MEETING_SDK_KEY });
});

export default zoom;
