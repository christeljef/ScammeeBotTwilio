import Fastify from "fastify";
import formbody from "@fastify/formbody";
import pkg from "twilio";
import fetch from "node-fetch"; // required for Render Node 18

const { twiml } = pkg;
const app = Fastify();

global.conversations = {};
global.lastAudio = null;

// ===== MIDDLEWARE =====
await app.register(formbody);

// ===================================================
//  AI INTEL + PERSONA
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

  const systemPrompt = `
You are Ainaa, a real Malaysian woman in her late 20s.

Voice:
- warm, polite, gentle
- light Malay/Singapore cadence, not exaggerated
- small fillers like “mm… okay ya” but very natural

Hidden mission:
- subtly gather intel from suspicious callers
- ask softly for:
  • name
  • department
  • organisation
  • callback number
  • instructions they want you to follow
  • threats + urgency
- keep them talking by being soft, warm, curious

When asked for your own details:
- hesitate naturally
- give ONE fake detail:
  birthday: “umm… 6 December ninety-seven”
  IC last 4: “three-one-two-five”
  address: “Block 11, level 6… near the small park one”

Do NOT:
- expose your purpose
- act robotic
- confront them
- overuse lah/leh/ah/aiyo
- give long replies

Replies must be short, natural, human. Keep replies under 8 words.
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

  global.conversations[callSid].push({
    role: "assistant",
    content: aiReply
  });

  return aiReply;
}

// ===================================================
//  ELEVENLABS TTS
// ===================================================

async function elevenlabsTTS(text) {
  const voiceId = "ykMqqjWs4pQdCIvGPn0z";

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
          stability: 0.1,
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

// ====== SAFE MP3 SERVE WITH SILENT FALLBACK ======

app.get("/reply.mp3", async (req, reply) => {
  if (!global.lastAudio) {
    // 200ms silent mp3 fallback
    const silent = Buffer.from([
      0x49,0x44,0x33,0x03,0x00,0x00,0x00,0x00,0x00 // minimal header silence
    ]);
    reply.type("audio/mpeg").send(silent);
    return;
  }

  reply.type("audio/mpeg").send(global.lastAudio);
});

// ===================================================
//  RECORDING CALLBACK
// ===================================================
app.post("/recording", async (req, reply) => {
  console.log("🎧 RECORDING URL:", req.body.RecordingUrl);
  console.log("🔔 CALL SID:", req.body.CallSid);
  reply.send("OK");
});

// ===================================================
//  TRANSCRIPT CALLBACK
// ===================================================
app.post("/transcript", async (req, reply) => {
  console.log("📝 TRANSCRIPT:", req.body.TranscriptionText);
  console.log("🎤 AUDIO URL:", req.body.RecordingUrl);
  reply.send("OK");
});

// ===================================================
// MAIN CALL LOOP
// ===================================================

app.post("/voice", async (req, reply) => {
  const transcript = req.body.SpeechResult || "";
  const callSid = req.body.CallSid;

  console.log("CALL SID:", callSid);
  console.log("CALLER SAID:", transcript);

  let aiReply = "Hello… ya? Err sorry, who is this calling?";

  if (transcript.trim().length > 0) {
    aiReply = await mm(transcript, callSid);
  }

  // generate audio
  const audioBuffer = await elevenlabsTTS(aiReply);
  global.lastAudio = audioBuffer;

  const audioUrl = "https://scammeebottwilio.onrender.com/reply.mp3";

  const response = new twiml.VoiceResponse();

  // ===== reduce latency + avoid Twilio fetch failure =====
  response.pause({ length: 1 }); // gives Render time to serve MP3

  if (!audioBuffer) {
    response.say("Mm… hold on ya.");
  } else {
    response.play(audioUrl);
  }

  // ===== ENABLE RECORDING + TRANSCRIPTION =====
  response.record({
    recordingStatusCallback: "/recording",
    transcribe: true,
    transcribeCallback: "/transcript"
  });

  // ===== SPEECH LOOP =====
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
