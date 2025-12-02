import Fastify from "fastify";
import formbody from "@fastify/formbody";
import pkg from "twilio";

const twiml = pkg.twiml;
const app = Fastify();

// -------- 1. Parse Twilio's form-encoded POST --------
await app.register(formbody);

// -------- 2. Health check route --------
app.get("/", async () => {
  return { ok: true, running: true };
});

// -------- 3. GET /voice (for testing in browser) --------
// Twilio XML must have NO BOM, NO whitespace, NO extra header
// So we let Twilio library generate the XML automatically
app.get("/voice", async (req, reply) => {
  const response = new twiml.VoiceResponse();
  response.say("GET route working.");
  reply.type("text/xml").send(response.toString());
});

// -------- 4. POST /voice (Twilio webhook) --------
app.post("/voice", async (req, reply) => {
  console.log("Incoming Twilio Body:", req.body);

  const response = new twiml.VoiceResponse();
  response.say("Your Twilio POST webhook is now fully working!");

  reply.type("text/xml").send(response.toString());
});

// -------- 5. Start server --------
const port = process.env.PORT || 3000;
app.listen({ port, host: "0.0.0.0" }, () => {
  console.log("Server is running on port", port);
});

// -------- 6. Keep Render Awake --------
setInterval(() => {
  fetch("https://scammeebottwilio.onrender.com/")
    .then(() => console.log("Keep-alive ping sent"))
    .catch(() => console.log("Keep-alive failed"));
}, 4 * 60 * 1000);
