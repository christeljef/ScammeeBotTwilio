 import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { RealtimeClient } from "openai-realtime-api";

// Create Fastify server
const fastify = Fastify();
fastify.register(websocket);

// Twilio webhook for incoming calls
fastify.post("/voice", async (req, reply) => {
  console.log("📞 Incoming call from Twilio");

  // Twilio expects XML response (TwiML)
  const twiml = `
    <Response>
      <Connect>
        <Stream url="${process.env.PUBLIC_URL}/media" />
      </Connect>
    </Response>
  `;

  reply.type("text/xml").send(twiml);
});

// WebSocket endpoint for Twilio Media Streams
fastify.get("/media", { websocket: true }, (connection, req) => {
  console.log("🔊 Twilio Media Stream connected");

  // Create OpenAI realtime client
  const ai = new RealtimeClient({
    apiKey: process.env.OPENAI_API_KEY,
  });

  // When AI produces audio → send to caller (Twilio)
  ai.on("response.audio.delta", (audio) => {
    connection.send(
      JSON.stringify({
        event: "media",
        media: { payload: audio }
      })
    );
  });

  // When caller speaks → send audio to OpenAI
  connection.on("message", (msg) => {
    try {
      const data = JSON.parse(msg.toString());

      if (data.event === "media") {
        ai.sendAudio(data.media.payload);
      }
    } catch (err) {
      console.error("❌ Error parsing Twilio media:", err);
    }
  });

  // Start OpenAI session
  ai.startSession();
});

// Start server
const PORT = process.env.PORT || 10000;
fastify.listen({ port: PORT, host: "0.0.0.0" }).then(() => {
  console.log(`🚀 Server running on port ${PORT}`);
});
