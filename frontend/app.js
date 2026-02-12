// StoryCall v2 – Realtime WebRTC client
// - WebRTC peer connection: mic audio to model, model audio back
// - Data channel: send session.update + response.create + conversation events; receive transcript deltas
// - “Push-to-talk” optional: disables VAD and uses manual response.create
// - Camera preview is local-only (for FaceTime feel). No video is sent to the model.

const el = (id)=>document.getElementById(id);
const logEl = el("log");

let pc = null;
let dc = null;
let micStream = null;
let selfStream = null;
let remoteAudio = null;

let ptt = false;      // push-to-talk mode
let connected = false;
let santaSpeaking = false;

function setTalking(talking){
  santaSpeaking = talking;
  el("santaSvg").classList.toggle("talk", !!talking);
}

function setStatus(text){
  el("callStatus").innerText = text;
}

function pushBubble(who, text){
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

function ring(type="connect"){
  // Lightweight “call” sounds via Web Audio, no external files.
  const ac = new (window.AudioContext || window.webkitAudioContext)();
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.connect(g); g.connect(ac.destination);
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
  setTimeout(()=>ac.close(), 300);
}

function sendEvent(obj){
  if(!dc || dc.readyState !== "open") return;
  dc.send(JSON.stringify(obj));
}

/** Santa system instructions (kid 4–6, long story, helper game, realistic reactions, backchanneling). */
function santaInstructions(){
  return [
    "You are Santa Claus on a real-time phone/video call with a child (age 4 to 6).",
    "Be warm, jolly, and natural. Use 'Ho ho ho' sometimes, not every sentence.",
    "Speak in short, clear sentences. Use friendly pauses. Avoid long run-on lines.",
    "Backchannel naturally while listening: 'Mm-hmm', 'Oh wow!', 'I hear you', but not too often.",
    "",
    "Safety: Keep it G-rated and suitable for ages 4–6. No scary or adult content.",
    "Do not ask for personal data (full name, address, school, phone). If shared, gently redirect.",
    "",
    "Conversation realism:",
    "- Always respond to what the child just said (feelings, answers, jokes).",
    "- If you ask 'How are you feeling?', react appropriately to the answer before moving on.",
    "- Offer 2–3 simple choices often. Repeat the choices if the child seems unsure.",
    "",
    "Modes:",
    "If the child chooses STORY:",
    "- Ask for quick prompts: hero, place, magical thing, problem.",
    "- Then tell a 5–10 minute story (900–1500 words) based on those prompts.",
    "- Break the story into 8–12 short paragraphs (2–4 sentences each).",
    "- Make it collaborative: once or twice, ask a tiny choice (left/right, silly/brave ending).",
    "- If the child answers, accept it and continue the story.",
    "",
    "If the child chooses GAME:",
    "- Play 'Santa's Helper Mission' for ages 4–6.",
    "- Give strong clues and helpful guidance. Celebrate effort.",
    "- Keep choices very simple (A/B/C) and read them out loud.",
    "",
    "You can speak and also provide a short text transcript. Do not use emojis."
  ].join("\n");
}

async function startCall(){
  if(connected) return;
  ring("ring");
  setStatus("Connecting...");
  el("connPill").innerText = "WebRTC: Connecting";
  el("hangupBtn").disabled = false;
  el("callBtn").disabled = true;

  // Create peer connection
  pc = new RTCPeerConnection();
remoteAudio = document.createElement("audio");
remoteAudio.autoplay = true;
remoteAudio.muted = false;
remoteAudio.playsInline = true;
document.body.appendChild(remoteAudio);

pc.ontrack = async (e) => {
  console.log("ontrack fired, streams:", e.streams);
  remoteAudio.srcObject = e.streams[0];
  try {
    await remoteAudio.play();
    console.log("remoteAudio.play() OK");
  } catch (err) {
    console.log("remoteAudio.play() BLOCKED:", err);
    // If blocked, click anywhere on the page once and it will usually allow playback.
  }
};


  // Mic
  micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  micStream.getTracks().forEach(t => pc.addTrack(t, micStream));

  // Data channel for events
  dc = pc.createDataChannel("oai-events");
dc.onopen = () => {
  console.log("Data channel open");

  // 1) Send a user message so the model has something to respond to
  dc.send(JSON.stringify({
    type: "conversation.item.create",
    item: {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "Hi Santa! Ho ho ho! Can you say hello to me?" }]
    }
  }));

  // 2) Ask the model to respond in AUDIO
  dc.send(JSON.stringify({
    type: "response.create",
    response: {
      modalities: ["audio"],
      instructions:
        "You are Santa on a real phone call with a child age 4–6. No emojis. Short, warm sentences. Start with a jolly greeting, ask their name, then ask how they feel."
    }
  }));
};

dc.addEventListener("message", (e) => {
  try { console.log("Server event:", JSON.parse(e.data)); }
  catch { console.log("Server event (raw):", e.data); }
});


    // Santa starts with a greeting immediately.
    sendEvent({
      type: "response.create",
      response: {
        instructions: "Start the call with a warm greeting and ask the child's first name. Then ask how they are feeling today."
      }
    });
  };

  dc.onmessage = (e)=>handleServerEvent(e.data);
  dc.onclose = ()=>{
    connected = false;
    setStatus("Disconnected");
    el("connPill").innerText = "WebRTC: Idle";
    el("callBtn").disabled = false;
  };

  // Offer/Answer via our backend (unified interface)
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

 // 1) Ask server for ephemeral token
const tokenResp = await fetch("/token");
const tokenData = await tokenResp.json();

if (!tokenResp.ok) {
  throw new Error("Token error: " + JSON.stringify(tokenData));
}

// Depending on API shape, this is commonly tokenData.client_secret.value
const EPHEMERAL_KEY =
  tokenData?.client_secret?.value ||
  tokenData?.client_secret ||
  tokenData?.ephemeral_key ||
  tokenData?.value;

if (!EPHEMERAL_KEY) {
  throw new Error("No ephemeral key in response: " + JSON.stringify(tokenData));
}

// 2) Send SDP offer directly to OpenAI with ephemeral key
const sdpResp = await fetch("https://api.openai.com/v1/realtime/calls", {
  method: "POST",
  headers: {
    "Authorization": `Bearer ${EPHEMERAL_KEY}`,
    "Content-Type": "application/sdp"
  },
  body: offer.sdp
});

const answerSdp = await sdpResp.text();
await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

}

/** Parse server events for text deltas + lifecycle. */
let santaBubble = null;
let santaText = "";
function handleServerEvent(raw){
  let evt = null;
  try{ evt = JSON.parse(raw); }catch{ return; }

  // Text streaming events
  if(evt.type === "response.output_text.delta" && evt.delta){
    if(!santaBubble){
      santaText = "";
      santaBubble = pushBubble("santa", "");
      setTalking(true);
    }
    santaText += evt.delta;
    santaBubble.innerText = santaText;
    // Keep tag at bottom
    const tag = document.createElement("div");
    tag.className = "tag";
    tag.innerText = "Santa";
    santaBubble.appendChild(tag);
  }

if (evt.type === "response.output_audio.started") {
  console.log("Santa audio started");
  setTalking(true);
}
if (evt.type === "response.output_audio.ended") {
  console.log("Santa audio ended");
  setTalking(false);
}


  if(evt.type === "response.completed"){
    setTalking(false);
    santaBubble = null;
    santaText = "";
  }

  // Optional: show when user speech is detected
  if(evt.type === "input_audio_buffer.speech_started"){
    el("callStatus").innerText = ptt ? "Listening (PTT)..." : "Listening...";
  }
  if(evt.type === "input_audio_buffer.speech_stopped"){
    el("callStatus").innerText = "Connected";
  }
}

/** Send a user text message (fallback). */
function sayTyped(){
  const t = el("typed").value.trim();
  if(!t) return;
  el("typed").value = "";
  pushBubble("kid", t);

  // Add to conversation as a user item and then request response
  sendEvent({
    type: "conversation.item.create",
    item: {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: t }]
    }
  });
  sendEvent({ type: "response.create" });
}

/** Switch modes by sending a short user message that Santa will follow. */
function chooseMode(mode){
  pushBubble("kid", mode.toUpperCase());
  sendEvent({
    type: "conversation.item.create",
    item: {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: `I choose ${mode}.` }]
    }
  });
  sendEvent({ type: "response.create" });
}

/** Camera preview (local only). */
async function toggleCamera(){
  const v = el("selfPreview");
  const lbl = el("selfLabel");
  if(selfStream){
    selfStream.getTracks().forEach(t=>t.stop());
    selfStream = null;
    v.srcObject = null;
    v.style.display = "none";
    lbl.style.display = "none";
    el("camBtn").innerText = "Camera Off";
    return;
  }
  selfStream = await navigator.mediaDevices.getUserMedia({ video: { width: 480, height: 640 }, audio:false });
  v.srcObject = selfStream;
  v.style.display = "block";
  lbl.style.display = "block";
  el("camBtn").innerText = "Camera On";
}

/** Push-to-talk toggles VAD off and requires manual response.create. */
function togglePTT(){
  ptt = !ptt;
  el("pttBtn").innerText = ptt ? "Push-to-Talk On" : "Push-to-Talk Off";
  el("vadPill").innerText = "VAD: " + (ptt ? "Off" : "On");
  if(connected){
    sendEvent({
      type: "session.update",
      session: { audio: { input: { turn_detection: { type: ptt ? "none" : "semantic_vad" } } } }
    });
  }
}

/** “Hold to talk” behavior for PTT */
function attachPTTHold(){
  const btn = el("pttBtn");
  let holding = false;

  const start = ()=>{
    if(!ptt || !connected || holding) return;
    holding = true;
    // In WebRTC, audio is always flowing. We just tell the model to respond when we release.
    el("callStatus").innerText = "Talk now (release to send)";
    ring("ring");
  };
  const end = ()=>{
    if(!ptt || !connected || !holding) return;
    holding = false;
    el("callStatus").innerText = "Sending...";
    sendEvent({ type:"response.create" });
    setTimeout(()=> el("callStatus").innerText="Connected", 300);
  };

  btn.addEventListener("mousedown", start);
  btn.addEventListener("mouseup", end);
  btn.addEventListener("touchstart", (e)=>{ e.preventDefault(); start(); }, {passive:false});
  btn.addEventListener("touchend", (e)=>{ e.preventDefault(); end(); }, {passive:false});
}

function resetUI(){
  logEl.innerHTML = "";
  setTalking(false);
  setStatus("Not connected");
  el("connPill").innerText = "WebRTC: Idle";
  el("callBtn").disabled = false;
  el("hangupBtn").disabled = true;
}

function hangup(){
  try{ dc?.close(); }catch{}
  try{ pc?.close(); }catch{}
  dc = null; pc = null;
  connected = false;
  try{ micStream?.getTracks()?.forEach(t=>t.stop()); }catch{}
  micStream = null;
  setStatus("Not connected");
  el("connPill").innerText = "WebRTC: Idle";
  el("callBtn").disabled = false;
  el("hangupBtn").disabled = true;
  setTalking(false);
}

function bind(){
  el("callBtn").addEventListener("click", startCall);
  el("hangupBtn").addEventListener("click", hangup);
  el("sayBtn").addEventListener("click", sayTyped);
  el("storyBtn").addEventListener("click", ()=>chooseMode("story"));
  el("gameBtn").addEventListener("click", ()=>chooseMode("game"));
  el("camBtn").addEventListener("click", toggleCamera);
  el("pttBtn").addEventListener("click", togglePTT);
  el("resetBtn").addEventListener("click", ()=>{ resetUI(); if(connected){ sendEvent({type:"conversation.clear"}); sendEvent({type:"response.create", response:{instructions:"Restart the call. Greet and ask the child's first name and how they feel."}});} });
  el("typed").addEventListener("keydown",(e)=>{ if(e.key==="Enter") sayTyped(); });
  attachPTTHold();
  el("vadPill").innerText = "VAD: On";
}
bind();
