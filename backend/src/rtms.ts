// Import the RTMS SDK
import rtms from "@zoom/rtms";

let clients = new Map<string, InstanceType<typeof rtms.Client>>();

console.log("[rtms] Starting RTMS webhook listener...");
console.log("[rtms] Waiting for Zoom RTMS webhook events...");

// Set up webhook event handler to receive RTMS events from Zoom
rtms.onWebhookEvent(({ event, payload }) => {
  console.log(`[rtms] Received webhook event: ${event}`);
  const streamId = payload?.rtms_stream_id;

  if (event == "meeting.rtms_stopped") {
      if (!streamId) {
          console.log(`[rtms] Received meeting.rtms_stopped event without stream ID`);
          return;
      }

      const client = clients.get(streamId);
      if (!client) {
          console.log(`[rtms] Received meeting.rtms_stopped event for unknown stream ID: ${streamId}`)
          return
      }

      console.log(`[rtms] Meeting RTMS stopped for stream: ${streamId}`);
      client.leave();
      clients.delete(streamId);

      return;
  } else if (event !== "meeting.rtms_started") {
    console.log(`[rtms] Ignoring unknown event: ${event}`);
    return;
  }

  console.log(`[rtms] Meeting RTMS started! Stream ID: ${streamId}`);
  console.log(`[rtms] Creating new RTMS client for stream...`);

  // Create a new RTMS client for the stream if it doesn't exist
  const client = new rtms.Client();
  clients.set(streamId, client);

  client.onJoinConfirm((reason: any) => {
    console.log(`[rtms] Join confirmed — reason: ${reason}`);
  });

  client.onSessionUpdate((op: any, sessionInfo: any) => {
    console.log(`[rtms] Session update — op: ${op}`, sessionInfo);
  });

  client.onUserUpdate((op: any, participantInfo: any) => {
    console.log(`[rtms] User update — op: ${op}`, participantInfo);
  });

  client.onTranscriptData((data: any, size: any, timestamp: any, metadata: any) => {
    console.log(`[${timestamp}] -- ${metadata.userName}: ${data}`);
  });

  client.onLeave((reason: any) => {
    console.log(`[rtms] Left meeting — reason: ${reason}`);
    clients.delete(streamId);
  });

  // Join the meeting using the webhook payload directly
  console.log(`[rtms] Joining meeting via RTMS...`);
  client.join(payload);
});
