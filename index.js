import Fastify from "fastify";
import pkg from "twilio";
const twiml = pkg.twiml;

const app = Fastify();

app.get("/", async () => {
  return { status: "ok" };
});

app.post("/voice", async (req, reply) => {
  const response = new twiml.VoiceResponse();

  response.say("Hello, your Render + Twilio server is working.");

  reply.type("text/xml").send(response.toString());
});

const port = process.env.PORT || 3000;

app.listen({ port, host: "0.0.0.0" }, () => {
  console.log("Server running on port", port);
});
