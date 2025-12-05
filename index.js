import Fastify from "fastify";
import formbody from "@fastify/formbody";
import pkg from "twilio";

const { twiml } = pkg;
const app = Fastify();

// GLOBAL MEMORY
global.conversations = {};
global.lastAudio = null;
global.recordingStarted = {}; // Track one-time recording

// ===== MIDDLEWARE =====
await app.register(formbody);

// ===================================================
//  AI INTEL + PERSONA LOGIC
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
You are Ainaa, a soft-spoken Malaysian woman in your late 20s.

Your voice:
- warm, gentle, natural
- light Malay/Singapore English cadence but subtle
- soft fillers like “mm… okay ya” (not too many)

Your hidden mission:
- subtly gather intel from suspicious callers
- ask softly for:
  * name
  * department / organisation
  * callback number
  * instructions
  * urgency / threats

When they ask YOU for info:
- hesitate gently
- give ONE fake detail:
  birthday: “mm… 6 December ninety-seven”
  IC: “three-one-two-five”
  address: “Block 11, level 6… near the small park”

Never confront. Never accuse. Never sound robotic.
Keep replies 1–2 short sentences.
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
      temperature: 0.7
    })
  });

  const data = await resp.json();
  const aiReply = data?.choices?.[0]?.message?.content || "mm… okay ya.";

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
          stability: 0.25,
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

// Serve generated MP3
app.get("/reply.mp3", async (req, reply) => {
  reply.type("audio/mpeg").send(global.lastAudio);
});

// RECORDING CALLBACK
app.post("/recording", async (req, reply) => {
  console.log("🎧 RECORDING URL:", req.body.RecordingUrl);
  console.log("🔔 CALL SID:", req.body.CallSid);
  reply.send("OK");
});

// TRANSCRIPTION CALLBACK
app.post("/transcript", async (req, reply) => {
  console.log("📝 TRANSCRIPT:", req.body.TranscriptionText);
  console.log("🎤 AUDIO URL:", req.body.RecordingUrl);
  reply.send("OK");
});

// ===================================================
//  MAIN CALL FLOW
// ===================================================

app.post("/voice", async (req, reply) => {
  const callSid = req.body.CallSid;
  const transcript = req.body.SpeechResult || "";
  const response = new twiml.VoiceResponse();

  // ===================================================
  // FIRST TURN — generate audio BEFORE gather
  // ===================================================
  if (!global.recordingStarted[callSid]) {
    global.recordingStarted[callSid] = true;

    const firstReply = "Hello… ya? mm sorry, who is this calling?";

    // Generate audio immediately
    const audioBuffer = await elevenlabsTTS(firstReply);
    global.lastAudio = audioBuffer;
    const audioUrl = "https://scammeebottwilio.onrender.com/reply.mp3";

    // Start recording ONCE
    response.record({
      recordingStatusCallback: "/recording",
      transcribe: true,
      transcribeCallback: "/transcript"
    });

    // Speak first line
    response.play(audioUrl);

    // Then gather
    response.gather({
      input: "speech",
      action: "/voice",
      speechTimeout: "auto",
      method: "POST",
      language: "en-US"
    });

    return reply.type("text/xml").send(response.toString());
  }

  // ===================================================
  // NORMAL LOOP
  // ===================================================

  console.log("CALL SID:", callSid);
  console.log("CALLER SAID:", transcript);

  let aiReply = "mm… okay ya, can repeat again?";

  if (transcript.trim().length > 0) {
    aiReply = await getAIReply(transcript, callSid);
  }

  console.log("AI REPLY:", aiReply);

  // Generate voice
  const audioBuffer = await elevenlabsTTS(aiReply);
  global.lastAudio = audioBuffer;
  const audioUrl = "https://scammeebottwilio.onrender.com/reply.mp3";

  if (audioBuffer) {
    response.play(audioUrl);
  } else {
    response.say("mm… the line a bit slow ya…");
  }

  // Continue speech loop
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
