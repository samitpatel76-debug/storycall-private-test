import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Browser posts raw SDP
app.use(express.text({ type: ["application/sdp", "text/plain"], limit: "2mb" }));

const PORT = process.env.PORT || 8792;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime";
const VOICE = process.env.OPENAI_REALTIME_VOICE || "marin";

if (!OPENAI_API_KEY) {
  console.warn("WARNING: OPENAI_API_KEY is not set. /session will fail.");
}

// Serve frontend
app.use("/", express.static(path.join(__dirname, "../frontend")));

/**
 * POST /session
 * Unified interface from the Realtime WebRTC guide:
 * - receives SDP from browser
 * - sends multipart form to https://api.openai.com/v1/realtime/calls (Authorization: Bearer <server key>)
 * - returns answer SDP text
 */
async function fetchWithRetry(url, options, retries = 3) {
  let lastErr = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // 30 seconds

    try {
      const resp = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(timeout);

      // Retry on transient gateway issues
      if ([502, 503, 504].includes(resp.status) && attempt < retries) {
        await new Promise(r => setTimeout(r, 800 * attempt));
        continue;
      }

      return resp;
    } catch (e) {
      clearTimeout(timeout);
      lastErr = e;
      if (attempt < retries) {
        await new Promise(r => setTimeout(r, 800 * attempt));
        continue;
      }
    }
  }

  throw lastErr || new Error("fetchWithRetry failed");
}

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
      // You can also lock to audio-only if you want: output_modalities: ["audio"]
      output_modalities: ["audio", "text"],
      audio: {
        output: { voice: VOICE }
      }
    };

    const fd = new FormData();
    fd.set("sdp", sdpOffer);
    fd.set("session", JSON.stringify(session));

    const r = await fetchWithRetry("https://api.openai.com/v1/realtime/calls", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
      body: fd
    });

    if (!r.ok) {
      const txt = await r.text();
      res.status(500).send(txt.slice(0, 5000));
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
  console.log(`StoryCall v2 server on http://localhost:${PORT}`);
});
