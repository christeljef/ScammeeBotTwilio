import Fastify from "fastify";
import formbody from "@fastify/formbody";
import pkg from "twilio";

const { twiml } = pkg;
const app = Fastify();

global.conversations = {};
global.lastAudio = null;

// ===== MIDDLEWARE =====
await app.register(formbody);

// ===================================================
// AI LOGIC — NATURAL PERSONALITY
// ===================================================

async function getAIReply(transcript, callSid) {
  if (!global.conversations[callSid]) {
    global.conversations[callSid] = [];
  }

  global.conversations[callSid].push({
    role: "user",
    content: transcript
  });

  if (global.conversations[callSid].length > 6) {
    global.conversations[callSid].shift();
  }

  const persona = `
You are “Afiqah”, a Singaporean-Malay woman in your early 30s.
You speak in warm, natural conversational English — never robotic.

Your tone:
- gentle, calm, slightly cautious
- real Singaporean/Malay cadence but light, subtle, not exaggerated
- short replies, like a real phone call (1–2 short sentences)
- only occasional human fillers (“mm okay…”, “ya I hear you”) but not every line
- no caricature Singlish (don’t use lah/leh/lor unless caller uses it first)

Your behaviour:
- respond like a real person answering a suspicious call
- ask soft clarifying questions when needed
- if caller pressures you, stay polite and cooperative
- when asked for *your* details: pause, then offer ONE fake detail naturally

Your hidden goal:
- gather info casually:
  - caller name
  - organisation / department
  - reason for call
  - instructions they want you to follow
  - callback numbers
  - urgency/threats used

Do NOT sound like an assistant.
Do NOT say phrases like “How may I assist?” or “I am here to help you.”
Speak like a normal woman on a phone call.

Keep responses warm, natural, and believable.
`;

  const messages = [
    { role: "system", content: persona },
    ...global.conversations[callSid]
  ];

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages,
      temperature: 0.65
    })
  });

  const data = await resp.json();
  const aiReply =
    data?.choices?.[0]?.message?.content ||
    "Mm okay… sorry ya, can repeat that part?";

  global.conversations[callSid].push({
    role: "assistant",
    content: aiReply
  });

  return aiReply;
}

// ===================================================
// ELEVENLABS TTS
// ===================================================

async function elevenlabsTTS(text) {
  const voiceId = "ykMqqjWs4pQdCIvGPn0z";

  const resp = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "audio/mpeg",
        "xi-api-key": process.env.ELEVENLABS_API_KEY
      },
      body: JSON.stringify({
        text,
        voice_settings: {
          stability: 0.22,
          similarity_boost: 0.7
        }
      })
    }
  );

  return Buffer.from(await resp.arrayBuffer());
}

// ===================================================
// ROUTES
// ===================================================

app.get("/", async () => ({ ok: true }));

app.get("/reply.mp3", async (req, reply) => {
  reply.type("audio/mpeg").send(global.lastAudio);
});

// RECORDING CALLBACK
app.post("/recording", async (req, reply) => {
  console.log("🎧 Recording URL:", req.body.RecordingUrl);
  reply.send("OK");
});

// TRANSCRIPT CALLBACK
app.post("/transcript", async (req, reply) => {
  console.log("📝 Transcript:", req.body.TranscriptionText);
  reply.send("OK");
});

// ===================================================
// MAIN TWILIO LOOP
// ===================================================

app.post("/voice", async (req, reply) => {
  const transcript = req.body?.SpeechResult || null;
  const callSid = req.body?.CallSid;

  console.log("CALL SID:", callSid);
  console.log("USER SAID:", transcript);

  // ALWAYS run AI even if transcript empty (fixes Siri-mode)
  const textForAI =
    transcript && transcript.trim().length > 0
      ? transcript
      : "Caller spoke but transcript empty — continue conversation naturally.";

  const aiReply = await getAIReply(textForAI, callSid);

  console.log("AI:", aiReply);

  // Generate TTS audio
  const audioBuffer = await elevenlabsTTS(aiReply);
  global.lastAudio = audioBuffer;

  const audioUrl = "https://scammeebottwilio.onrender.com/reply.mp3";

  const response = new twiml.VoiceResponse();

  // PLAY AI VOICE
  if (!audioBuffer) {
    response.say("Sorry ya… the audio loading a bit slow.");
  } else {
    response.play(audioUrl);
  }

  // small pause lets Twilio start next gather cleanly
  response.pause({ length: 0.4 });

  // LISTEN FOR NEXT USER LINE
  response.gather({
    input: "speech",
    action: "/voice",
    method: "POST",
    speechModel: "phone_call",
    speechTimeout: "auto",
    bargeIn: true
    // ❌ no gather.say() here — prevents robotic fallback
  });

  reply.type("text/xml").send(response.toString());
});

// ===================================================
// START SERVER
// ===================================================

const port = process.env.PORT || 3000;
app.listen({ port, host: "0.0.0.0" }, () => {
  console.log("Server running on", port);
});

// KEEP RENDER ALIVE
setInterval(() => {
  fetch("https://scammeebottwilio.onrender.com/").catch(() => {});
}, 4 * 60 * 1000);
