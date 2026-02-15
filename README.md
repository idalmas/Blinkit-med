# Blinket

**Hands-free internet access for people with ALS and motor impairments.**

Blinket is an assistive technology platform that lets users navigate the internet, shop, search, read, chat, join video calls, and have conversations — all controlled entirely through eye blinks and winks detected via a standard webcam.

**Live demo:** [seattle-sepia.vercel.app](https://seattle-sepia.vercel.app)
**Backend:** [revive-1-ef6k.onrender.com](https://revive-1-ef6k.onrender.com)

---

## Why We Built This

One of our teammates spent a summer in South Africa working directly with patients living with ALS. He saw firsthand how these patients were effectively locked out of the internet. The tools that did exist, like the Tobii Dynavox, cost between **$6,000 and $15,000**, putting them out of reach for most families, especially in developing countries.

We built Blinket to change that. Our system runs on **any laptop with a webcam** using open-source MediaPipe face tracking and also has electrodes to detect the movement of the eyes (the front of your eyes are more electronegatively charged than the back, thus they act as dipoles). Total cost: **under $200** for everything.

---

## How It Works

Blinket detects six distinct eye gestures using MediaPipe facial landmarks from a standard webcam:

| Gesture | Action |
|---------|--------|
| **Wink left / Look left** | Navigate left / previous |
| **Wink right / Look right** | Navigate right / next |
| **Double blink** | Select / confirm |
| **Triple blink** | Go back / cancel |
| **Quadruple blink** | Send (Morse keyboard) |
| **Long close** (2+ sec) | Exit to home |

An alternative **EOG (electrooculogram) input mode** is also supported for users who prefer signal-based eye tracking.

Every interaction is personalized through a **RAG pipeline**: user context is embedded and stored in Elasticsearch, then retrieved via kNN search and fed to Cerebras LLM to generate suggestions tailored to the individual — their interests, needs, and history.

---

## Apps

### Talk
Real-time voice conversation assistant. Deepgram transcribes speech live, and on a double-blink, Blinket generates contextual response options using RAG. Select a response with a wink and it's spoken aloud via Fish Audio TTS. Includes a Morse keyboard for typing custom messages through blink patterns.

### Amazon Shopping
Personalized product discovery. Blinket generates search queries based on user context, scrapes Amazon via BrightData, and presents results in a 3D carousel. Double-blink to email yourself a product link.

### Google Maps
Location-aware place discovery. Uses geolocation + personalized queries to find relevant businesses and places. Browse results with winks, double-blink to open in Google Maps.

### ChatGPT
Streaming chat interface with personalized conversation starters. Blinket suggests what you might want to ask based on your context. Wink to browse suggestions, double-blink to send. Full conversation history with scroll navigation.

### Web Search
Personalized web search. Generates queries from user context, scrapes search results via BrightData, and displays them in a browsable carousel with preview modals.

### Books
Curated classic literature reader with page-flip animations. Wink to turn pages, browse chapters, read full books — all hands-free.

### Flappy Bird
Blink-controlled game. Blink to jump. A fun way to practice blink detection calibration.

### Zoom Meetings
Join Zoom meetings directly in the browser via the Zoom Embedded SDK. Live meeting transcripts appear in a side panel via Zoom RTMS. Double-blink to generate contextual responses during the call and speak them via TTS.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 19, TypeScript, Vite, React Router |
| **Blink Detection** | MediaPipe Face Landmarker (webcam) |
| **Speech-to-Text** | Deepgram Nova-2 (real-time WebSocket) |
| **Text-to-Speech** | Fish Audio |
| **LLM** | Cerebras (fast inference for response generation) |
| **Embeddings** | Cohere |
| **Vector Search** | Elasticsearch (kNN) |
| **Web Scraping** | BrightData (Amazon, SERP, Maps) |
| **Video Calls** | Zoom Meeting SDK + RTMS |
| **Email** | Resend |
| **Backend** | Hono + Bun |
| **Frontend Hosting** | Vercel |
| **Backend Hosting** | Render |

---

## Cost Comparison

| Solution | Cost |
|----------|------|
| Tobii Dynavox | $6,000 – $15,000 |
| Other AAC devices | $3,000 – $10,000 |
| **Blinket** | **< $200** |

---

## Running Locally

### Backend

```bash
cd backend
bun install
bun run dev
```

Requires a `.env` file with API keys for Deepgram, Cerebras, Elasticsearch, BrightData, Fish Audio, Cohere, Resend, and optionally Zoom.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

The frontend proxies API requests to `localhost:3003` in development. Set `VITE_API_BASE` to override.

### RTMS (Zoom transcript logging)

```bash
cd backend
bun run rtms
```

Runs the Zoom RTMS webhook listener on port 8080 for real-time meeting transcript capture.

---

## Architecture

```
┌─────────────────────────────────────────────┐
│                  Frontend                    │
│         (React + MediaPipe + Webcam)         │
│                                              │
│  Blink Detection ──► App Navigation          │
│  Deepgram Audio  ──► Live Transcription      │
│  Zoom SDK        ──► Embedded Meetings       │
└──────────────┬──────────────────────────────┘
               │ HTTP + WebSocket
┌──────────────▼──────────────────────────────┐
│                  Backend                     │
│              (Hono + Bun)                    │
│                                              │
│  /getContext  ──► Elasticsearch kNN + LLM    │
│  /ws          ──► Deepgram + EOG + RTMS      │
│  /apps/*      ──► BrightData, TTS, Email     │
│  /zoom/*      ──► Meeting SDK auth           │
└─────────────────────────────────────────────┘
```


