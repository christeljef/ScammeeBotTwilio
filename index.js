import Fastify from "fastify";
import pkg from "twilio";
const twiml = pkg.twiml;

const app = Fastify();

// Root check
app.get("/", async () => {
  return { status: "ok", message: "Twilio server running" };
});

// GET /voice — browser test
app.get("/voice", async (req, reply) => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>GET route working. Your server is alive.</Say>
</Response>`;

  reply.type("text/xml").send(xml);
});

// POST /voice — Twilio call handler
app.post("/voice", async (req, reply) => {
  const response = new twiml.VoiceResponse();

  // You can replace this with AI later
  response.say("Your Twilio POST webhook is working with the XML header.");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n${response.toString()}`;

  reply.type("text/xml").send(xml);
});

const port = process.env.PORT || 3000;

app.listen({ port, host: "0.0.0.0" }, () => {
  console.log("Server running on port", port);
});

// Keep the Render service awake by pinging itself every 4 minutes
setInterval(() => {
  fetch("https://scammeebottwilio.onrender.com/")
    .then(() => console.log("Keep-alive ping sent"))
    .catch(() => console.log("Keep-alive ping failed"));
}, 4 * 60 * 1000);
