import Fastify from "fastify";
import pkg from "twilio";
const twiml = pkg.twiml;

const app = Fastify();

// Root route so Render shows something instead of 404
app.get("/", async (req, reply) => {
  return { status: "ok", message: "Twilio server is running" };
});

// GET /voice — for browser testing
app.get("/voice", async (req, reply) => {
  reply.type("text/xml").send(`
    <Response>
      <Say>GET route working. Your server is alive.</Say>
    </Response>
  `);
});

// POST /voice — Twilio CALL HANDLER
app.post("/voice", async (req, reply) => {
  const response = new twiml.VoiceResponse();

  // You can change this text later once AI is connected
  response.say("Your Twilio POST webhook is working. The server is responding.");

  reply
    .type("text/xml")
    .send(response.toString());
});

const port = process.env.PORT || 3000;

app.listen({ port, host: "0.0.0.0" }, () => {
  console.log("Server running on port", port);
});
