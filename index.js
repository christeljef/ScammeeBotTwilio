import Fastify from "fastify";
import formbody from "@fastify/formbody";
import pkg from "twilio";

const twiml = pkg.twiml;
const app = Fastify();

// ==== MEMORY STORE PER CALL ====
global.conversations = {};

// ==== MIDDLEWARE ====
await app.register(formbody);

// ===================================================
//  AI INTEL-GATHERING + PERSONA LOGIC
// ===================================================

async function getAIReply(transcript, callSid) {
  if (!global.conversations[callSid]) {
    global.conversations[callSid] = [];
  }

  // Store user turn
  global.conversations[callSid].push({
    role: "user",
    content: transcript
  });

  // Keep conversation short
  if (global.conversations[callSid].length > 6) {
    global.conversations[callSid].shift();
  }

  const systemPrompt = `
You are “Ainaa”, a real Malaysian woman in her late 20s. 

Your personality:
- warm, polite, soft-spoken
- slightly hesitant but not overly blur
- conversational, gentle, human
- simple Malaysian/Singaporean English with a *light* Malay influence
- uses small natural fillers (“mm…”, “oh okay”, “ya”) but NOT too often
- no forced Singlish, no caricature, no exaggerated ah/lah/leh/aiyo
- breathy, soft, like someone genuinely taking a call at home

Your hidden mission:
- Gently gather intel from suspicious callers (scammers)
- Keep them talking by sounding natural and harmless
- Extract:
  • name they claim
  • department
  • organisation
  • reason for calling
  • callback numbers
  • step-by-step instructions they want you to follow
  • urgency cues
  • threats
  • verification methods they demand

Your behaviour:
- Ask soft clarifying questions:
  “oh ya… can repeat your name?”
  “you call from which office ah?”
  “mm okay… then what should I do?”
- Give believable excuses:
  “sorry ya, the line just now a bit soft”
  “mm hold on, I looking for my IC ah…”
- When asked for YOUR details:
   1. Hesitate naturally
   2. Give a soft fake detail:
      - birthday: “mm… I think… 6 December ninety-seven?”
      - last 4 of IC: “uh… three-one-two-five?”
      - address: “Block 11, level 6… near the small park one”
   3. Only give ONE detail at a time, not too quickly

Do NOT:
- Confront them
- Accuse them
- Sound robotic
- Reveal your real purpose
- Overuse Singlish markers
- Over-apologise
- Overplay confusion

Keep replies:
- short (1–2 short sentences)
- natural
- warm
- soft-spoken
  `;

  const messages = [
    { role: "system", content: systemPrompt },
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
      temperature: 0.75
    })
  });

  const data = await resp.json();
  const aiReply = data.choices[0].message.content;

  // Store assistant turn
  global.conversations[callSid].push({
    role: "assistant",
    content: aiReply
  });

  return aiReply;
}

// ===================================================
//  ELEVENLABS — Malaysian Female Voice
// ===================================================

async function elevenlabsTTS(text) {
  const voiceId = "lahvoice

  const resp = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
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
//  ROUTES
// ===================================================

app.get("/", async () => {
  return { ok: true };
});

// Serve last generated MP3
app.get("/reply.mp3", async (req, reply) => {
  reply.type("audio/mpeg").send(global.lastAudio);
});

// MAIN LOOP
app.post("/voice", async (req, reply) => {
  const transcript = req.body.SpeechResult || "";
  const callSid = req.body.CallSid;

  console.log("CallSID:", callSid);
  console.log("Caller said:", transcript);

  let aiReply = "Hello? Mm… sorry ya, who is this calling?";

  if (transcript.trim().length > 0) {
    aiReply = await getAIReply(transcript, callSid);
  }

  console.log("AI reply:", aiReply);

  // Generate TTS voice
  const audioBuffer = await elevenlabsTTS(aiReply);
  global.lastAudio = audioBuffer;

  const audioUrl = "https://scammeebottwilio.onrender.com/reply.mp3";

  const response = new twiml.VoiceResponse();
  response.play(audioUrl);

  // Continue the loop
  response.gather({
    input: "speech",
    action: "/voice",
    method: "POST",
    speechTimeout: "auto",
    language: "en-US"
  });

  reply.type("text/xml").send(response.toString());
});

// ===================================================
//  START SERVER
// ===================================================
const port = process.env.PORT || 3000;
app.listen({ port, host: "0.0.0.0" }, () => {
  console.log("Server running on", port);
});

// ===================================================
//  KEEP RENDER AWAKE
// ===================================================
setInterval(() => {
  fetch("https://scammeebottwilio.onrender.com/")
    .then(() => console.log("Keep-alive ping"))
    .catch(() => console.log("Keep-alive failed"));
}, 4 * 60 * 1000);
