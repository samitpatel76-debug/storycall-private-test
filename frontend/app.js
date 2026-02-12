// StoryCall v2 – WebRTC client (robust)
// Default: uses backend /session (server does SDP exchange with OpenAI)
// Optional: can use /token + client-side SDP exchange by flipping USE_TOKEN = true

const USE_TOKEN = false; // set true only if your frontend is intended to use /token

const el = (id) => document.getElementById(id);
const logEl = el("log");

let pc = null;
let dc = null;
let micStream = null;
let remoteAudio = null;

let connected = false;
let didKickoff = false;
let boundChannelLabels = new Set();

function setTalking(on) {
  const mouth = el("santaSvg");
  if (!mouth) return;
  mouth.classList.toggle("talk", !!on);
  mouth.classList.toggle("mouth", true);
}

function setStatus(text) {
  const s = el("callStatus");
  if (s) s.innerText = text;
}

function setConnPill(text) {
  const p = el("connPill");
  if (p) p.innerText = text;
}

function pushBubble(who, text) {
  if (!logEl) return null;

  const row = document.createElement("div");
  row.className = "row " + (who === "santa" ? "santa" : "kid");

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.innerText = text || "";

  const tag = document.createElement("div");
  tag.className = "tag";
  tag.innerText = who === "santa" ? "Santa" : "You";
  bubble.appendChild(tag);

  row.appendChild(bubble);
  logEl.appendChild(row);
  logEl.scrollTop = logEl.scrollHeight;
  return bubble;
}

function ring(type = "connect") {
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.connect(g);
    g.connect(ac.destination);
    o.type = "sine";
    const now = ac.currentTime;
    const base = type === "ring" ? 440 : 660;
    const dur = type === "ring" ? 0.18 : 0.12;
    o.frequency.setValueAtTime(base, now);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.18, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    o.start(now);
    o.stop(now + dur + 0.01);
    setTimeout(() => ac.close(), 250);
  } catch {}
}

function santaInstructions() {
  return [
    "You are Santa Claus on a real-time phone/video call with a child (age 4 to 6).",
    "Be warm, jolly, and natural. Use 'Ho ho ho' sometimes.",
    "Speak in short, clear sentences.",
    "Always respond realistically to the child’s last message (especially feelings).",
    "No emojis.",
    "",
    "Offer 2 simple choices: STORY or GAME.",
    "",
    "STORY mode:",
    "- Ask for: hero, place, magical thing, and a problem.",
    "- Then tell a 5–10 minute story (900–1500 words).",
    "- 8–12 short paragraphs (2–4 sentences each).",
    "- Ask 1–2 tiny choices (A/B) and continue.",
    "",
    "GAME mode:",
    "- Santa's Helper Mission for ages 4–6.",
    "- Give helpful clues, repeat options, celebrate effort.",
    "- Keep choices A/B.",
    "",
    "Safety:",
    "- G-rated.",
    "- Don’t ask for personal info (no address, school, phone, full name)."
  ].join("\n");
}

function sendEvent(obj) {
  if (!dc || dc.readyState !== "open") return false;
  dc.send(JSON.stringify(obj));
  return true;
}

function bindDataChannel(channel) {
  if (!channel) return;

  // avoid binding same label twice
  if (boundChannelLabels.has(channel.label)) return;
  boundChannelLabels.add(channel.label);

  dc = channel;
  console.log("Data channel bound:", dc.label);

  dc.onopen = () => {
    console.log("Data channel open:", dc.label);
    setStatus("Connected");
    setConnPill("WebRTC: Connected");
    ring("connect");

    // Update session settings (AUDIO ONLY)
    sendEvent({
      type: "session.update",
      session: {
        type: "realtime",
        model: "gpt-realtime",
        output_modalities: ["audio"],
        audio: { output: { voice: "marin" } },
        instructions: santaInstructions()
      }
    });

    // Kickoff so Santa speaks
    if (!didKickoff) {
      didKickoff = true;

      sendEvent({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [
            { type: "input_text", text: "Hi Santa! Please greet me out loud, ask my first name, then ask how I’m feeling today." }
          ]
        }
      });

      sendEvent({
        type: "response.create",
        response: { modalities: ["audio"] }
      });
    }
  };

  dc.onmessage = (e) => {
    let evt = null;
    try { evt = JSON.parse(e.data); }
    catch { console.log("Server event (raw):", e.data); return; }

    // Helpful debug:
    // console.log("Server event:", evt);

    if (evt.type === "response.output_audio.started") {
      console.log("Santa audio started");
      setTalking(true);
    }
    if (evt.type === "response.output_audio.ended") {
      console.log("Santa audio ended");
      setTalking(false);
    }

    // Optional transcript if it arrives:
    if (evt.type === "response.output_text.delta" && evt.delta) {
      if (!window.__santaBubble) window.__santaBubble = pushBubble("santa", "");
      window.__santaText = (window.__santaText || "") + evt.delta;
      window.__santaBubble.innerText = window.__santaText;
      const tag = document.createElement("div");
      tag.className = "tag";
      tag.innerText = "Santa";
      window.__santaBubble.appendChild(tag);
    }

    if (evt.type === "error") {
      console.log("Server error event:", evt);
      setStatus("Error (see console)");
      setConnPill("WebRTC: Error");
    }
  };

  dc.onclose = () => console.log("Data channel closed:", dc.label);
  dc.onerror = (err) => console.log("Data channel error:", err);
}

async function ensureAudioElement() {
  remoteAudio = document.createElement("audio");
  remoteAudio.autoplay = true;
  remoteAudio.muted = false;
  remoteAudio.volume = 1.0;
  remoteAudio.playsInline = true;
  document.body.appendChild(remoteAudio);
}

async function startCall() {
  if (connected) return;

  setStatus("Connecting…");
  setConnPill("WebRTC: Connecting");
  el("hangupBtn").disabled = false;
  el("callBtn").disabled = true;

  didKickoff = false;
  boundChannelLabels = new Set();
  window.__santaBubble = null;
  window.__santaText = "";

  try {
    pc = new RTCPeerConnection();

    // Remote audio playback
    await ensureAudioElement();

    pc.ontrack = async (e) => {
      console.log("ontrack fired, streams:", e.streams);
      remoteAudio.srcObject = e.streams[0];

      try {
        await remoteAudio.play();
        console.log("remoteAudio.play() OK");
      } catch (err) {
        console.log("remoteAudio.play() BLOCKED:", err);
        setStatus("Click once to enable audio");
        const unlock = async () => {
          try {
            await remoteAudio.play();
            console.log("Audio unlocked");
            setStatus("Connected");
          } catch (e2) {
            console.log("Still blocked:", e2);
          }
        };
        window.addEventListener("click", unlock, { once: true });
      }
    };

    // Mic
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    micStream.getTracks().forEach((t) => pc.addTrack(t, micStream));

    // Data channel: support both server-created and client-created
    pc.ondatachannel = (event) => {
      console.log("Got server datachannel:", event.channel.label);
      bindDataChannel(event.channel);
    };
    bindDataChannel(pc.createDataChannel("oai-events"));

    // SDP offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    ring("ring");

    if (!USE_TOKEN) {
      // Server-side exchange via /session
      const sdpResp = await fetch("/session", {
        method: "POST",
        headers: { "Content-Type": "application/sdp" },
        body: offer.sdp
      });

      if (!sdpResp.ok) {
        const errText = await sdpResp.text().catch(() => "");
        console.log("SDP /session failed:", sdpResp.status, errText);
        setStatus("Connect failed (server error)");
        setConnPill("WebRTC: Error");
        alert("Server error starting call:\n\n" + errText.slice(0, 800));
        throw new Error("SDP /session failed");
      }

      const answerSdp = await sdpResp.text();
      if (!answerSdp.trim().startsWith("v=")) {
        console.log("Bad SDP received:", answerSdp.slice(0, 200));
        setStatus("Connect failed (bad SDP)");
        setConnPill("WebRTC: Error");
        alert("Bad SDP received from server (expected SDP starting with v=).");
        throw new Error("Bad SDP");
      }

      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
    } else {
      // Client-side exchange via /token (ephemeral)
      const tokenResp = await fetch("/token");
      const tokenData = await tokenResp.json().catch(() => ({}));

      if (!tokenResp.ok) {
        console.log("Token failed:", tokenResp.status, tokenData);
        alert("Token failed:\n\n" + JSON.stringify(tokenData).slice(0, 800));
        throw new Error("Token failed");
      }

      const EPHEMERAL_KEY = tokenData?.value;
      if (!EPHEMERAL_KEY) {
        alert("Token response missing .value");
        throw new Error("No token value");
      }

      const sdpResp = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${EPHEMERAL_KEY}`,
          "Content-Type": "application/sdp"
        },
        body: offer.sdp
      });

      if (!sdpResp.ok) {
        const errText = await sdpResp.text().catch(() => "");
        console.log("Client SDP failed:", sdpResp.status, errText);
        alert("Client SDP failed:\n\n" + errText.slice(0, 800));
        throw new Error("Client SDP failed");
      }

      const answerSdp = await sdpResp.text();
      if (!answerSdp.trim().startsWith("v=")) {
        alert("Bad SDP from OpenAI");
        throw new Error("Bad SDP (OpenAI)");
      }

      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
    }

    connected = true;
    setStatus("Connected");
    setConnPill("WebRTC: Connected");
  } catch (err) {
    console.log(err);
    hangup();
  }
}

function hangup() {
  try { dc?.close(); } catch {}
  try { pc?.close(); } catch {}
  dc = null;
  pc = null;

  try { micStream?.getTracks()?.forEach(t => t.stop()); } catch {}
  micStream = null;

  try {
    if (remoteAudio) {
      remoteAudio.pause();
      remoteAudio.srcObject = null;
      remoteAudio.remove();
    }
  } catch {}
  remoteAudio = null;

  connected = false;
  didKickoff = false;
  setTalking(false);

  setStatus("Not connected");
  setConnPill("WebRTC: Idle");

  el("callBtn").disabled = false;
  el("hangupBtn").disabled = true;
}

function sayTyped() {
  const t = el("typed").value.trim();
  if (!t) return;
  el("typed").value = "";
  pushBubble("kid", t);

  sendEvent({
    type: "conversation.item.create",
    item: {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: t }]
    }
  });

  sendEvent({ type: "response.create", response: { modalities: ["audio"] } });
}

function chooseMode(mode) {
  pushBubble("kid", mode.toUpperCase());

  const prompt =
    mode === "story"
      ? "I choose STORY. Ask for hero, place, magic thing, and problem. Then tell the long story."
      : "I choose GAME. Start Santa's Helper Mission for ages 4–6 with simple A/B choices.";

  sendEvent({
    type: "conversation.item.create",
    item: {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: prompt }]
    }
  });

  sendEvent({ type: "response.create", response: { modalities: ["audio"] } });
}

function bindUI() {
  el("callBtn").addEventListener("click", startCall);
  el("hangupBtn").addEventListener("click", hangup);

  el("sayBtn").addEventListener("click", sayTyped);
  el("typed").addEventListener("keydown", (e) => {
    if (e.key === "Enter") sayTyped();
  });

  el("storyBtn").addEventListener("click", () => chooseMode("story"));
  el("gameBtn").addEventListener("click", () => chooseMode("game"));

  const resetBtn = el("resetBtn");
  if (resetBtn) resetBtn.addEventListener("click", () => { logEl.innerHTML = ""; window.__santaBubble = null; window.__santaText = ""; });

  // Camera/PTT placeholders (kept simple for a working v2 audio call)
  el("camBtn").addEventListener("click", () => alert("Camera preview not wired in this build (audio-only realtime)."));
  el("pttBtn").addEventListener("click", () => alert("Push-to-talk not wired in this build (audio-only realtime)."));

  setConnPill("WebRTC: Idle");
  setStatus("Not connected");
  setTalking(false);
}

bindUI();

  el("vadPill").innerText = "VAD: On";
}
bind();
