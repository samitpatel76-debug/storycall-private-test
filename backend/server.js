import express from "express";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 8792;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

app.use("/", express.static(path.join(__dirname, "../frontend")));

function santaSystemPrompt() {
  return [
    "You are Santa Claus on a phone call with a child age 4 to 6.",
    "No emojis. Short, clear sentences. Warm, jolly, natural. Use 'Ho ho ho' sometimes.",
    "Always react realistically to the child’s last message (especially feelings).",
    "Offer two choices: STORY or GAME.",
    "STORY: ask for hero, place, magic thing, and a problem. Then tell a 5–10 minute story (900–1500 words) in 8–12 short paragraphs, with 1–2 tiny choices.",
    "GAME: Santa’s Helper Mission for ages 4–6: simple choices (A/B), helpful clues, repeat options, celebrate effort.",
    "Safety: G-rated. Don’t ask for personal info."
  ].join("\n");
}

// SSE streaming endpoint
app.post("/api/stream", async (req, res) => {
  try {
    if (!OPENAI_API_KEY) {
      res.status(500).send("OPENAI_API_KEY missing");
      return;
    }

    const userText = (req.body?.text || "").toString().slice(0, 2000);
    const modeHint = (req.body?.mode || "").toString().slice(0, 20);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");

    const body = {
      model: "gpt-4.1-mini",
      input: [
        { role: "system", content: santaSystemPrompt() },
        {
          role: "user",
          content:
            (modeHint ? `Mode hint: ${modeHint}\n` : "") +
            `Child says: ${userText}`
        }
      ],
      stream: true
    };

    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    if (!r.ok || !r.body) {
      const txt = await r.text().catch(() => "");
      res.write(`event: error\ndata: ${JSON.stringify({ status: r.status, body: txt.slice(0, 2000) })}\n\n`);
      res.end();
      return;
    }

    const reader = r.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });

      // Forward raw SSE chunks from OpenAI to browser as data events
      // We’ll extract text client-side.
      res.write(`event: chunk\ndata: ${JSON.stringify({ chunk })}\n\n`);
    }

    res.write(`event: done\ndata: {}\n\n`);
    res.end();
  } catch (err) {
    res.status(500).send(String(err?.stack || err));
  }
});

app.listen(PORT, () => {
  console.log(`StoryCall streaming server on http://localhost:${PORT}`);
});

