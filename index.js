import Fastify from "fastify";
import formbody from "@fastify/formbody";
import pkg from "twilio";

const twiml = pkg.twiml;
const app = Fastify();

// --- 1. Register form parser BEFORE routes (critical!) ---
await app.register(formbody);

// --- 2. Health check ---
app.get("/", async () => {
  return { ok: true, message: "Server running" };
});

// --- 3. GET /voice test route ---
app.get("/voice", async (req, reply) => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>GET route working.</Say>
</Response>`;
  reply.type("text/xml").send(xml);
});

// --- 4. POST /voice Twilio webhook ---
app.post("/voice", async (req, reply) => {
  console.log("TWILIO POST BODY:", req.body);

  const response = new twiml.VoiceResponse();
  response.say("Your Twilio POST webhook is now fully working!");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n${response.toString()}`;
  reply.type("text/xml").send(xml);
});

// --- 5. Start server ---
const port = process.env.PORT || 3000;
app.listen({ port, host: "0.0.0.0" }, () => {
  console.log("Server running on port", port);
});

// --- 6. KEEP-ALIVE PING (every 4 minutes) ---
setInterval(() => {
  fetch("https://scammeebottwilio.onrender.com/")
    .then(() => console.log("Keep-alive ping sent"))
    .catch(() => console.log("Keep-alive ping failed"));
}, 4 * 60 * 1000);
