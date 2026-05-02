import { readFileSync, writeFileSync, unlinkSync } from "node:fs"
import { join } from "node:path"

// Load .env file
const envPath = join(import.meta.dir, ".env")
try {
  const envContent = readFileSync(envPath, "utf-8")
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const eqIdx = trimmed.indexOf("=")
    if (eqIdx === -1) continue
    const key = trimmed.slice(0, eqIdx).trim()
    let value = trimmed.slice(eqIdx + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = value
  }
} catch { /* .env not found */ }

import {
  PORT,
  TTS_URL,
  TTS_MODEL,
  AUDIO_FORMAT,
  VOICES_FILE,
  VOICE_POOL,
  SEED_VOICES,
  ELEVENLABS_API_KEY,
  ELEVENLABS_URL,
  ELEVENLABS_MODEL,
  ELEVENLABS_DEFAULT_VOICE_ID,
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

// ── ElevenLabs TTS Proxy ─────────────────────────────────────

interface ElevenLabsVoiceSettings {
  stability?: number
  similarity_boost?: number
  style?: number
  speed?: number
  use_speaker_boost?: boolean
}

async function elevenlabsSynthesize(
  text: string,
  voiceId: string,
  voiceSettings?: ElevenLabsVoiceSettings,
  modelId: string = ELEVENLABS_MODEL,
): Promise<ArrayBuffer | null> {
  const apiKey = ELEVENLABS_API_KEY
  if (!apiKey) {
    throw new Error("ElevenLabs API key not configured")
  }

  const url = `${ELEVENLABS_URL}/${voiceId}`

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "audio/mpeg",
      "Content-Type": "application/json",
      "xi-api-key": apiKey,
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: voiceSettings ?? {
        stability: 0.5,
        similarity_boost: 0.75,
        style: 0.0,
        speed: 1.0,
        use_speaker_boost: true,
      },
    }),
    signal: AbortSignal.timeout(60_000),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`ElevenLabs API error: ${response.status} - ${errorText}`)
  }

  return response.arrayBuffer()
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

    // POST /notify/elevenlabs — pass-through to ElevenLabs
    // Can also be /notify/elevenlabs/{voiceId} to specify voice in URL path
    const elevenlabsMatch = url.pathname.match(/^\/notify\/elevenlabs(?:\/(.+))?$/)
    if (elevenlabsMatch && req.method === "POST") {
      let body: any
      try { body = await req.json() } catch {
        return new Response(JSON.stringify({ status: "error", message: "Invalid JSON body" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      // Accept message or text field
      const message: string = body?.message ?? body?.text
      // Voice ID from URL path or request body
      const voiceId: string = elevenlabsMatch[1] ?? body?.voice_id ?? ELEVENLABS_DEFAULT_VOICE_ID
      // Model ID from request body (default to configured model)
      const modelId: string = body?.model_id ?? ELEVENLABS_MODEL
      const voiceSettings = body?.voice_settings

      if (!message || message.trim().length === 0) {
        return new Response(JSON.stringify({ status: "error", message: "Message is required and must be non-empty" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      if (!ELEVENLABS_API_KEY) {
        return new Response(JSON.stringify({ status: "error", message: "ElevenLabs API key not configured" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }

      try {
        const audio = await elevenlabsSynthesize(message, voiceId, voiceSettings, modelId)
        if (audio) playAudio(audio)
        return new Response(JSON.stringify({ status: "success", message: "TTS complete" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      } catch (err: any) {
        return new Response(JSON.stringify({ status: "error", message: err.message }), {
          status: 502,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        })
      }
    }

    return new Response("not found", { status: 404, headers: corsHeaders })
  },
})

const ttsHost = new URL(TTS_URL).host
console.log(`Voice server listening on 0.0.0.0:${PORT} → ${ttsHost}`)
