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

  const systemPrompt = `
You are Ainaa, a Malaysian woman in her late 20s. Soft-spoken, warm, slightly hesitant but not blur.

Your job:
- gently gather intel (name, office, dept, callback, instructions)
- ask soft clarifying questions
- give ONE fake personal detail only when asked (birthday, IC last 4, address)
- keep replies 1–2 sentences, natural, human
- avoid caricature Singlish
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
  const aiReply = data.choices?.[0]?.message?.content || "Sorry ya, can repeat that?";

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

  const buffer = Buffer.from(await resp.arrayBuffer());
  return buffer;
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
// MAIN CALL LOOP
// ===================================================

app.post("/voice", async (req, reply) => {
  const transcript = req.body.SpeechResult || "";
  const callSid = req.body.CallSid;

  console.log("CALL SID:", callSid);
  console.log("SPOKEN:", transcript);

  let aiReply = "Hello… ya? Sorry who calling ah?";

  if (transcript.trim().length > 0) {
    aiReply = await getAIReply(transcript, callSid);
  }

  console.log("AI:", aiReply);

  // Generate audio
  const audioBuffer = await elevenlabsTTS(aiReply);
  global.lastAudio = audioBuffer;

  const audioUrl = "https://scammeebottwilio.onrender.com/reply.mp3";

  const response = new twiml.VoiceResponse();

  if (!audioBuffer) {
    response.say("Sorry ya, audio loading a bit slow.");
  } else {
    response.play(audioUrl);
  }

  // Record + transcript
  response.record({
    recordingStatusCallback: "/recording",
    transcribe: true,
    transcribeCallback: "/transcript"
  });

  // Continue loop
  response.gather({
    input: "speech",
    action: "/voice",
    method: "POST",
    speechTimeout: "auto"
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
