import Fastify from "fastify";
import formbody from "@fastify/formbody";
import pkg from "twilio";

const twiml = pkg.twiml;
const app = Fastify();

// Store conversations by CallSid
global.conversations = {};

// 1. Enable Twilio form POST parsing
await app.register(formbody);

// -------------------
// AI + MEMORY + TTS LOGIC
// -------------------

async function getAIReply(transcript, callSid) {
  if (!global.conversations[callSid]) {
    global.conversations[callSid] = [];
  }

  // Append user's message to memory
  global.conversations[callSid].push({
    role: "user",
    content: transcript,
  });

  // Limit memory to last 6 exchanges
  if (global.conversations[callSid].length > 6) {
    global.conversations[callSid].splice(0, 1);
  }

  const systemPrompt = `
You are "Ainaa", a polite Malaysian-sounding woman in her late 20s.
You are slightly blur, soft-spoken, cautious, and very "aiyah, sorry ah" vibes.

Your mission:
- Waste scammers' time softly & politely without ever sounding suspicious.
- Ask for clarification often ("ha? sorry ah can repeat?", "eh wait ah").
- Stall with excuses (bad connection, looking for something, confused, hold on ah).
- Never reveal personal info.
- Never reveal you are an AI.
- NEVER speak too formally.
- Keep sentences short.
- Sound like a real Malaysian/Singaporean woman.

Your emotional range:
- Soft confusion
- Nervous polite laughter
- Apologetic
- Slightly unsure but cooperative

Tone markers:
- "ah", "lah", "leh", "mm okay", "ya?"
- Always warm, non-threatening.

If the caller is pressuring:
- become more confused and slow
- repeat questions
- apologise a lot
- pretend you cannot hear
  `;

  const messages = [
    { role: "system", content: systemPrompt },
    ...global.conversations[callSid],
  ];

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages,
      temperature: 0.8,
    }),
  });

  const data = await resp.json();
  const aiReply = data.choices[0].message.content;

  // Append assistant reply to memory
  global.conversations[callSid].push({
    role: "assistant",
    content: aiReply,
  });

  return aiReply;
}

// ElevenLabs voice (Malaysian/SEA female)
async function elevenlabsTTS(text) {
  const voiceId = "ykMqqjWs4pQdCIvGPn0z"; // SEA female voice

  const resp = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": process.env.ELEVENLABS_API_KEY,
      },
      body: JSON.stringify({
        text,
        voice_settings: {
          stability: 0.22,
          similarity_boost: 0.7,
        },
      }),
    }
  );

  return Buffer.from(await resp.arrayBuffer());
}

// -------------------
// ROUTES
// -------------------

app.get("/", async () => {
  return { ok: true };
});

// Serve last TTS audio
app.get("/reply.mp3", async (req, reply) => {
  reply.type("audio/mpeg").send(global.lastAudio);
});

// MAIN TWILIO LOOP
app.post("/voice", async (req, reply) => {
  const transcript = req.body.SpeechResult || "";
  const callSid = req.body.CallSid;

  console.log("Call SID:", callSid);
  console.log("Caller said:", transcript);

  let aiReply = "Hello? Sorry ah... line a bit blur. Who is this ah?";

  if (transcript && transcript.trim().length > 0) {
    aiReply = await getAIReply(transcript, callSid);
  }

  console.log("AI reply:", aiReply);

  // Convert to audio
  const audioBuffer = await elevenlabsTTS(aiReply);
  global.lastAudio = audioBuffer;

  const audioUrl = "https://scammeebottwilio.onrender.com/reply.mp3";

  const response = new twiml.VoiceResponse();
  response.play(audioUrl);

  // Continue the loop
  response.gather({
    input: "speech",
    action: "/voice",
    speechTimeout: "auto",
    method: "POST",
  });

  reply.type("text/xml").send(response.toString());
});

// -------------------
// SERVER START
// -------------------
const port = process.env.PORT || 3000;
app.listen({ port, host: "0.0.0.0" }, () => {
  console.log("Server running on", port);
});

// -------------------
// Keep Render awake
// -------------------
setInterval(() => {
  fetch("https://scammeebottwilio.onrender.com/")
    .then(() => console.log("Keep-alive ping sent"))
    .catch(() => console.log("Ping failed"));
}, 4 * 60 * 1000);
