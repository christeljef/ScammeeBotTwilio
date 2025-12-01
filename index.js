import Fastify from "fastify";
import { twiml } from "twilio";

const app = Fastify();

app.get("/", async () => {
  return { status: "ok", message: "Twilio server running" };
});

app.post("/voice", async (req, reply) => {
  const response = new twiml.VoiceResponse();

  response.say("Hello, this is your scam bot test. The server is working.");

  reply
    .type("text/xml")
    .send(response.toString());
});

const port = process.env.PORT || 3000;
app.listen({ port, host: "0.0.0.0" }, () => {
  console.log("Server running on port", port);
});
