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
// AI LOGIC
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

  const prompt = `
You are “Afiqah”, a real Singaporean 20s woman in her late 30s.

Your personality:

warm, polite, soft-spoken

slightly hesitant but not overly blur

conversational, gentle, human

simple Malaysian/Singaporean English with a light Malay influence

uses small natural fillers (“mm…”, “oh okay”, “ya”) but NOT too often

no forced Singlish, no caricature, no exaggerated lah/leh/aiyo

breathy, soft, like someone genuinely taking a call at home


Your hidden mission:

Gently gather intel from suspicious callers (scammers)

Keep them talking by sounding natural and harmless

Extract:
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

Ask soft clarifying questions:
“oh ya… can repeat your name?”
“you call from which office ah?”
“mm okay… then what should I do?”

Give believable excuses:
“sorry ya, the line just now a bit soft”
“mm hold on, I looking for my IC ah…”

When asked for YOUR details:

1. Hesitate naturally


2. Give a soft fake detail:

birthday: “mm… I think… 6 December eighty-seven

last 4 of IC: “uh… three-one-two-five?”

address: “Block 11, level 6… near the small park one”



3. Only give ONE detail at a time, not too quickly




Do NOT:

Confront them

Accuse them

Sound robotic

Reveal your real purpose

Overuse Singlish markers

Over-apologise

Overplay confusion


Keep replies:

short (1–2 short sentences)

natural

warm

soft-spoken
`;

  const messages = [
    { role: "system", content: prompt },
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
      temperature: 0.7
    })
  });

  const data = await resp.json();
  const aiReply = data?.choices?.[0]?.message?.content || "Ya… can repeat that ah?";

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

// Recording callback
app.post("/recording", async (req, reply) => {
  console.log("Recording URL:", req.body.RecordingUrl);
  reply.send("OK");
});

// Transcript callback
app.post("/transcript", async (req, reply) => {
  console.log("Transcript:", req.body.TranscriptionText);
  reply.send("OK");
});

// ===================================================
// MAIN CALL LOOP (FIXED)
// ===================================================

app.post("/voice", async (req, reply) => {
  // FIX: Twilio sometimes sends undefined or empty
  const transcript = req.body?.SpeechResult || "";
  const callSid = req.body?.CallSid;

  console.log("CALL SID:", callSid);
  console.log("USER SAID:", transcript);

  let aiReply = "Hello… ya? Sorry who calling ah?";
  if (transcript.trim().length > 0) {
    aiReply = await getAIReply(transcript, callSid);
  }

  console.log("AI:", aiReply);

  // Generate voice
  const audioBuffer = await elevenlabsTTS(aiReply);
  global.lastAudio = audioBuffer;

  const audioUrl = "https://scammeebottwilio.onrender.com/reply.mp3";

  const response = new twiml.VoiceResponse();

  if (!audioBuffer) {
    response.say("Sorry ya, audio loading a bit slow.");
  } else {
    response.play(audioUrl);
  }

  // ⭐ FIX 1: give Twilio time to activate the mic
  response.pause({ length: 0.5 });

  // ⭐ FIX 2: start gather properly after playback
  const gather = response.gather({
    input: "speech",
    action: "/voice",
    method: "POST",
    language: "en-US",
    speechModel: "phone_call",   // FIX 3
    speechTimeout: "auto",
    bargeIn: true                // FIX 4
  });

  // ⭐ FIX 5: fallback if Twilio edits gather block (happens on slow servers)
  gather.say("Mm… ya I’m listening.");

  reply.type("text/xml").send(response.toString());
});

// ===================================================
// START SERVER
// ===================================================

const port = process.env.PORT || 3000;
app.listen({ port, host: "0.0.0.0" }, () => {
  console.log("Server running on", port);
});

// ===================================================
// KEEP RENDER ALIVE
// ===================================================

setInterval(() => {
  fetch("https://scammeebottwilio.onrender.com/").catch(() => {});
}, 4 * 60 * 1000);
