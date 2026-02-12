import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Browser may POST raw SDP to /session
app.use(express.text({ type: ["application/sdp", "text/plain"], limit: "2mb" }));

const PORT = process.env.PORT || 8792;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// Realtime defaults (override via env vars if you want)
const MODEL = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime";
const VOICE = process.env.OPENAI_REALTIME_VOICE || "marin";

if (!OPENAI_API_KEY) {
  console.warn("WARNING: OPENAI_API_KEY is not set. /session and /token will fail.");
}

// Serve the frontend (your existing v2 UI)
app.use("/", express.static(path.join(__dirname, "../frontend")));

/**
 * GET /health
 * Simple health check.
 */
app.get("/health", (req, res) => {
  res.json({ ok: true, model: MODEL, voice: VOICE });
});

/**
 * GET /token
 * Ephemeral token route for client-side WebRTC.
 * Browser uses this token to call OpenAI directly from the client.
 *
 * Official pattern: POST /v1/realtime/client_secrets and return { value: "..." }
 */
app.get("/token", async (req, res) => {
  try {
    if (!OPENAI_API_KEY) {
      res.status(500).json({ error: "OPENAI_API_KEY missing" });
      return;
    }

    const body = {
      session: {
        type: "realtime",
        model: MODEL,
        output_modalities: ["audio", "text"],
        audio: { output: { voice: VOICE } }
      }
    };

    const r = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      res.status(r.status).json(data);
      return;
    }

    // data should include: { value: "ephemeral_key_here", ... }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: String(err?.stack || err) });
  }
});

/**
 * POST /session
 * Unified-interface WebRTC route:
 * - Receives SDP offer from browser
 * - Server calls OpenAI /v1/realtime/calls with multipart FormData (sdp + session JSON)
 * - Returns SDP answer text to browser
 *
 * This keeps your OpenAI key on the server.
 */
app.post("/session", async (req, res) => {
  try {
    if (!OPENAI_API_KEY) {
      res.status(500).send("OPENAI_API_KEY missing");
      return;
    }

    const sdpOffer = req.body;
    if (!sdpOffer || typeof sdpOffer !== "string") {
      res.status(400).send("Missing SDP offer");
      return;
    }

    const session = {
      type: "realtime",
      model: MODEL,
      output_modalities: ["audio", "text"],
      audio: {
        output: { voice: VOICE }
      }
    };

    // FormData is available in Node 20+. If you’re on Node 18 locally, upgrade to Node 20.
    const fd = new FormData();
    fd.set("sdp", sdpOffer);
    fd.set("session", JSON.stringify(session));

    const r = await fetch("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`
      },
      body: fd
    });

    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      // Return the raw text (often includes the upstream error)
      res.status(500).send(txt.slice(0, 6000));
      return;
    }

    const answerSdp = await r.text();
    res.setHeader("Content-Type", "application/sdp");
    res.send(answerSdp);
  } catch (err) {
    res.status(500).send(String(err?.stack || err));
  }
});

app.listen(PORT, () => {
  console.log(`StoryCall v2 backend running on http://localhost:${PORT}`);
  console.log(`- Frontend: http://localhost:${PORT}`);
  console.log(`- Health:   http://localhost:${PORT}/health`);
  console.log(`- Token:    http://localhost:${PORT}/token`);
});


