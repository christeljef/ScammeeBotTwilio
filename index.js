import Fastify from "fastify";
import formbody from "@fastify/formbody";
import pkg from "twilio";

const twiml = pkg.twiml;
const app = Fastify();

// 1. Register form parser BEFORE routes
await app.register(formbody);

// Health check
app.get("/", async () => {
  return { ok: true };
});

// GET test
app.get("/voice", async (req, reply) => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>GET route working.</Say>
</Response>`;
  reply.type("text/xml").send(xml);
});

// POST webhook
app.post("/voice", async (req, reply) => {
  console.log("TWILIO POST BODY:", req.body);

  const response = new twiml.VoiceResponse();
  response.say("Your Twilio POST webhook is now fully working.");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n${response.toString()}`;
  reply.type("text/xml").send(xml);
});

// Start server
const port = process.env.PORT || 3000;
app.listen({ port, host: "0.0.0.0" }, () => {
  console.log("Server running on port", port);
});
