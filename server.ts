import { readFileSync, writeFileSync, unlinkSync } from "node:fs"
import {
  PORT,
  LITELLM_URL,
  LITELLM_KEY,
  LITELLM_MODEL,
  AUDIO_FORMAT,
  VOICES_FILE,
  VOICE_POOL,
  SEED_VOICES,
} from "./config"

// ── Voice Registry (in-memory cache) ────────────────────────

let poolIndex = 0
let voices = loadVoices()

function loadVoices(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(VOICES_FILE, "utf-8"))
  } catch {
    writeFileSync(VOICES_FILE, JSON.stringify(SEED_VOICES, null, 2))
    return { ...SEED_VOICES }
  }
}

function saveVoices() {
  writeFileSync(VOICES_FILE, JSON.stringify(voices, null, 2))
}

function resolveVoice(voiceId: string): string {
  if (voices[voiceId]) return voices[voiceId]

  voices[voiceId] = VOICE_POOL[poolIndex % VOICE_POOL.length]
  poolIndex++
  saveVoices()
  return voices[voiceId]
}

// ── TTS via LiteLLM ─────────────────────────────────────────

async function synthesize(input: string, voice: string, speed: number): Promise<ArrayBuffer | null> {
  const response = await fetch(LITELLM_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LITELLM_KEY}`,
    },
    body: JSON.stringify({
      model: LITELLM_MODEL,
      input,
      voice,
      response_format: AUDIO_FORMAT,
      speed,
    }),
    signal: AbortSignal.timeout(30_000),
  })

  if (!response.ok) return null

  const ct = response.headers.get("content-type") ?? ""
  if (!ct.includes("audio")) return null

  return response.arrayBuffer()
}

// ── Audio Playback ──────────────────────────────────────────

let tmpCounter = 0

function playAudio(buffer: ArrayBuffer) {
  const tmpFile = `/tmp/pai-voice-${process.pid}-${tmpCounter++}.${AUDIO_FORMAT}`
  writeFileSync(tmpFile, buffer)
  Bun.spawn(["afplay", tmpFile], {
    detached: true,
    onExit() {
      try { unlinkSync(tmpFile) } catch {}
    },
  })
}

// ── HTTP Server ─────────────────────────────────────────────

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)

    if (url.pathname === "/health" && req.method === "GET") {
      return new Response("ok")
    }

    if (url.pathname === "/notify" && req.method === "POST") {
      let body: any
      try { body = await req.json() } catch { return new Response("ok") }

      const message: string = body?.message
      const voiceId: string = body?.voice_id || "default"
      const voiceEnabled: boolean = body?.voice_enabled !== false
      const speed: number = body?.voice_settings?.speed ?? 1.0

      if (!message || !voiceEnabled) return new Response("ok")

      const voice = resolveVoice(voiceId)
      const audio = await synthesize(message, voice, speed)

      if (audio) playAudio(audio)

      return new Response("ok")
    }

    return new Response("not found", { status: 404 })
  },
})

console.log(`Voice server listening on :${PORT}`)
