import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { RealtimeClient } from "@openai/realtime-api-beta";
import dotenv from "dotenv";
dotenv.config();

const fastify = Fastify();
fastify.register(websocket);

// Twilio webhook for incoming call
fastify.post("/voice", async (req, reply) => {
  const twiml = `
    <Response>
      <Connect>
        <Stream url="${process.env.PUBLIC_URL}/media" />
      </Connect>
    </Response>
  `;

  reply.type("text/xml").send(twiml);
});

// WebSocket endpoint for Twilio Media Stream
fastify.get("/media", { websocket: true }, (connection) => {
  console.log("🔊 Twilio media stream connected.");

  const ai = new RealtimeClient({
    apiKey: process.env.OPENAI_API_KEY,
  });

  ai.on("response.audio.delta", (audio) => {
    connection.send(
      JSON.stringify({
        event: "media",
        media: { payload: audio }
      })
    );
  });

  // Handle audio from Twilio → send to AI
  connection.on("message", (msg) => {
    const data = JSON.parse(msg.toString());

    if (data.event === "media") {
      ai.sendAudio(data.media.payload);
    }
  });

  ai.startSession();
});

const PORT = process.env.PORT || 10000;
fastify.listen({ port: PORT, host: "0.0.0.0" }).then(() => {
  console.log(`🚀 Server running on ${PORT}`);
});
