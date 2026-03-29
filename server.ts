import { readFileSync, writeFileSync, unlinkSync } from "node:fs"
import {
  PORT,
  TTS_URL,
  TTS_MODEL,
  AUDIO_FORMAT,
  VOICES_FILE,
  VOICE_POOL,
  SEED_VOICES,
} from "./config"

// ── Voice Registry ──────────────────────────────────────────

let voices = loadVoices()

function loadVoices(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(VOICES_FILE, "utf-8"))
  } catch {
    writeFileSync(VOICES_FILE, JSON.stringify(SEED_VOICES, null, 2))
    return { ...SEED_VOICES }
  }
}

let poolIndex = Object.keys(voices).length

function resolveVoice(voiceId: string): string {
  if (voices[voiceId]) return voices[voiceId]
  voices[voiceId] = VOICE_POOL[poolIndex % VOICE_POOL.length]
  poolIndex++
  writeFileSync(VOICES_FILE, JSON.stringify(voices, null, 2))
  return voices[voiceId]
}

// ── TTS via local mlx-audio (through tts-proxy) ─────────────

async function synthesize(text: string, voice: string, speed: number): Promise<ArrayBuffer | null> {
  const res = await fetch(TTS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: TTS_MODEL,
      input: text,
      voice,
      instruct: voice,
      response_format: AUDIO_FORMAT,
      speed,
    }),
    signal: AbortSignal.timeout(60_000),
  })

  if (!res.ok) {
    console.error(`TTS error: ${res.status} ${await res.text().catch(() => "")}`)
    return null
  }

  const ct = res.headers.get("content-type") ?? ""
  if (!ct.includes("audio")) return null

  return res.arrayBuffer()
}

// ── Local Audio Playback ────────────────────────────────────

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

// ── Server — accepts from any source ────────────────────────

Bun.serve({
  hostname: "0.0.0.0",
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)

    // CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      })
    }

    const corsHeaders = { "Access-Control-Allow-Origin": "*" }

    if (url.pathname === "/health" && req.method === "GET") {
      return new Response("ok", { headers: corsHeaders })
    }

    if (url.pathname === "/notify" && req.method === "POST") {
      let body: any
      try { body = await req.json() } catch { return new Response("ok", { headers: corsHeaders }) }

      const message: string = body?.message
      const voiceId: string = body?.voice_id ?? "default"
      const voiceEnabled: boolean = body?.voice_enabled !== false
      const speed: number = body?.voice_settings?.speed ?? 1.0

      if (!message || !voiceEnabled) return new Response("ok", { headers: corsHeaders })

      // Fire-and-forget: respond immediately, TTS plays async
      const voice = resolveVoice(voiceId)
      synthesize(message, voice, speed).then(audio => { if (audio) playAudio(audio) })

      return new Response("ok", { headers: corsHeaders })
    }

    return new Response("not found", { status: 404, headers: corsHeaders })
  },
})

const ttsHost = new URL(TTS_URL).host
console.log(`Voice server listening on 0.0.0.0:${PORT} → ${ttsHost}`)
