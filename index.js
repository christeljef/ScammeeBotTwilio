import Fastify from "fastify";
import formbody from "@fastify/formbody";
import pkg from "twilio";

const { twiml } = pkg;
const app = Fastify({ logger: true });

// Per-call audio storage (fixes race condition)
const callAudio = new Map();
const conversations = new Map();

// Cleanup old data after 30 minutes
const CLEANUP_INTERVAL = 30 * 60 * 1000;
setInterval(() => {
  const cutoff = Date.now() - CLEANUP_INTERVAL;
  for (const [sid, data] of callAudio) {
    if (data.timestamp < cutoff) callAudio.delete(sid);
  }
  for (const [sid, data] of conversations) {
    if (data.timestamp < cutoff) conversations.delete(sid);
  }
}, 5 * 60 * 1000);

await app.register(formbody);

const BASE_URL = process.env.BASE_URL || "https://scammeebottwilio.onrender.com";

// ===== AI REPLY =====
async function getAIReply(transcript, callSid) {
  if (!conversations.has(callSid)) {
    conversations.set(callSid, { messages: [], timestamp: Date.now() });
  }

  const convo = conversations.get(callSid);
  convo.messages.push({ role: "user", content: transcript });
  convo.timestamp = Date.now();

  if (convo.messages.length > 6) convo.messages.shift();

  const systemPrompt = `
You are Ainaa, a real Malaysian woman in her late 20s.
Voice: warm, polite, gentle. Light Malay/Singapore cadence.
Hidden mission: subtly gather intel (name, department, organisation, callback number, instructions, threats).
When asked for your details, hesitate then give ONE fake detail.
Keep replies under 8 words. Be natural, not robotic.
`;

  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: systemPrompt }, ...convo.messages],
        temperature: 0.75,
        max_tokens: 50
      })
    });

    if (!resp.ok) throw new Error(`OpenAI error: ${resp.status}`);
    
    const data = await resp.json();
    const aiReply = data.choices?.[0]?.message?.content || "Sorry, can you repeat?";
    
    convo.messages.push({ role: "assistant", content: aiReply });
    return aiReply;
  } catch (err) {
    app.log.error("OpenAI error:", err);
    return "Mm… sorry, can you say again?";
  }
}

// ===== ELEVENLABS TTS =====
async function elevenlabsTTS(text) {
  const voiceId = "ykMqqjWs4pQdCIvGPn0z";

  try {
    const resp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "xi-api-key": process.env.ELEVENLABS_API_KEY
      },
      body: JSON.stringify({
        text,
        model_id: "eleven_turbo_v2", // Faster model
        voice_settings: { stability: 0.1, similarity_boost: 0.7 }
      })
    });

    if (!resp.ok) throw new Error(`ElevenLabs error: ${resp.status}`);
    return Buffer.from(await resp.arrayBuffer());
  } catch (err) {
    app.log.error("ElevenLabs error:", err);
    return null;
  }
}

// ===== ROUTES =====
app.get("/", async () => ({ ok: true }));

// Per-call audio endpoint (fixes race condition)
app.get("/reply/:callSid.mp3", async (req, reply) => {
  const audio = callAudio.get(req.params.callSid);
  
  if (!audio?.buffer) {
    // Return actual valid silent audio or 404
    return reply.code(404).send("Not found");
  }

  reply.type("audio/mpeg").send(audio.buffer);
});

app.post("/recording", async (req, reply) => {
  app.log.info({ url: req.body.RecordingUrl, sid: req.body.CallSid }, "Recording received");
  reply.send("OK");
});

app.post("/transcript", async (req, reply) => {
  app.log.info({ text: req.body.TranscriptionText }, "Transcript received");
  reply.send("OK");
});

// ===== MAIN VOICE HANDLER =====
app.post("/voice", async (req, reply) => {
  const transcript = req.body.SpeechResult || "";
  const callSid = req.body.CallSid;

  app.log.info({ callSid, transcript }, "Voice input");

  let aiReply = "Hello… ya? Err sorry, who is this calling?";

  if (transcript.trim().length > 0) {
    aiReply = await getAIReply(transcript, callSid); // Fixed function name
  }

  const audioBuffer = await elevenlabsTTS(aiReply);
  const response = new twiml.VoiceResponse();

  if (audioBuffer) {
    callAudio.set(callSid, { buffer: audioBuffer, timestamp: Date.now() });
    response.pause({ length: 0.5 });
    response.play(`${BASE_URL}/reply/${callSid}.mp3`);
  } else {
    response.say({ voice: "Polly.Joanna" }, aiReply); // Fallback to Twilio TTS
  }

  response.gather({
    input: "speech",
    action: "/voice",
    method: "POST",
    speechTimeout: "auto",
    language: "en-MY" // Malaysian English
  });

  reply.type("text/xml").send(response.toString());
});

// ===== START =====
const port = process.env.PORT || 3000;
app.listen({ port, host: "0.0.0.0" }, () => {
  app.log.info(`Server running on ${port}`);
});

// Keep-alive ping
setInterval(() => {
  fetch(`${BASE_URL}/`).catch(() => {});
}, 4 * 60 * 1000);
