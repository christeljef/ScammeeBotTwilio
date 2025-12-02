import Fastify from "fastify";
import pkg from "twilio";
const twiml = pkg.twiml;

const app = Fastify();

app.get("/voice", async (req, reply) => {
  reply.type("text/xml").send(`
    <Response>
      <Say>Hello, your server GET route is working.</Say>
    </Response>
  `);
});

app.post("/voice", async (req, reply) => {
  const response = new twiml.VoiceResponse();
  response.say("Hello, your server POST route is working.");

  reply.type("text/xml").send(response.toString());
});

const port = process.env.PORT || 3000;

app.listen({ port, host: "0.0.0.0" }, () => {
  console.log("Server running on port", port);
});
