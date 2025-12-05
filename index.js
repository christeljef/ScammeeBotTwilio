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
You are “Afiqah”, a Singaporean-Malay woman in your early 30s, speaking in calm, natural conversational English.

Your voice and manner:
- sounds like a real person on the phone, not overly formal or scripted
- gentle, slightly cautious, but not blur
- lightly Singaporean/Malay cadence, but NOT exaggerated
- uses small, human fillers only when needed (“mm… okay”, “ya I hear you”, “hold on ah”) but not every sentence
- never uses caricature Singlish (no lah, leh, lor, aiyo unless the caller uses it first)

Your behaviour:
- respond like you are genuinely in a phone conversation
- sound warm, a bit hesitant at times, but overall steady
- you should ask soft clarifying questions to understand the caller
- when they pressure you, you stay calm and cooperative, not confrontational
- when they ask for your details, give a believable pause, then ONE soft fake detail

Your hidden goal:
- gather information naturally without raising suspicion:
    * their name
    * department / agency
    * reason for call
    * what instructions they want you to follow
    * callback numbers
    * threats or urgency they use

Tone rules:
- speak in 1–2 short, natural-sounding sentences
- do NOT speak like an assistant or customer service bot
- do NOT say things like “How may I assist you?”
- do NOT narrate actions (“I am listening”, “I understand your request”)

You behave like a real woman answering a suspicious call, not an AI assistant.
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
        "ConContent-Type"application/json",
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

  listening.type("text/xml").send(response.toString());
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
