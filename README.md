# Voice Server — Documentation

## Overview

Bun-based TTS notification server. Accepts POST /notify, resolves voice IDs to text descriptions, synthesizes speech via mlx-audio (Qwen3-TTS), and plays audio locally via macOS `afplay`.

## Architecture

```
Client → voiceserver (8888) → tts-proxy (8001) → mlx-audio (8000)
```

- **voiceserver** — user-facing API. Resolves voice IDs, fires TTS requests, plays resulting audio
- **tts-proxy** — injects `instruct` parameter for Qwen3-TTS VoiceDesign (without it, the model produces no audio)
- **mlx-audio** — the actual TTS/STT engine, served via uvicorn

## Dependencies

- **Bun** — runs server.ts
- **Python venv** at `~/.venvs/audio-services/` with `mlx-audio[all,server]`
- **Models**:
  - TTS: `mlx-community/Qwen3-TTS-12Hz-1.7B-VoiceDesign-8bit`
  - STT: `mlx-community/Qwen3-ASR-1.7B-8bit`
- **macOS** — uses `afplay` for audio playback

## Management

`./audio-ctl <command>` — controls the full stack:

| Command | Description |
|---------|-------------|
| `start` | Start all services (mlx-audio, tts-proxy, voiceserver) |
| `stop` | Stop all services |
| `restart` | Stop then start |
| `status` | Health check all endpoints |
| `install` | Create launchd plist for voice server auto-restart |
| `uninstall` | Remove launchd plist |
| `logs [target]` | Tail logs: `mlx`, `proxy`, `voice`, `all` (default) |
| `update` | Upgrade mlx-audio package and refresh models |
| `model list` | Show configured models |
| `model download` | Pre-download all models |
| `dev` | Run mlx-audio in foreground |

### Launchd (auto-restart)

`audio-ctl install` creates a plist at `~/Library/LaunchAgents/com.local.voiceserver.plist` that auto-starts and auto-restarts the voice server via launchd. mlx-audio and tts-proxy are managed directly by audio-ctl (no plist).

## Endpoints

### GET /health

Returns `"ok"`. Used for health checks.

### POST /notify

```json
{
  "message": "Text to speak",
  "voice_id": "fTtv3eikoepIosk8dTZ5",
  "voice_enabled": true,
  "voice_settings": { "speed": 1.0 }
}
```

Fires TTS asynchronously via mlx-audio (Qwen3-TTS) and returns `"ok"` immediately. Audio plays locally on the server machine.

### POST /notify/elevenlabs

ElevenLabs TTS proxy endpoint. Pass-through to ElevenLabs API — plays audio locally.

Can be called with voice ID in URL path (`/notify/elevenlabs/{voiceId}`) or in body (`voice_id`).

**Request body fields:**
- `text` or `message` — text to synthesize (required)
- `voice_id` — ElevenLabs voice ID (optional, defaults to configured default)
- `model_id` — ElevenLabs model ID (optional, defaults to `eleven_turbo_v2_5`)
- `voice_settings` — object with stability, similarity_boost, style, speed, use_speaker_boost

**Example:**
```json
{
  "text": "Hello world",
  "voice_id": "CwhRBWXzGAHq8TQ4Fs17",
  "model_id": "eleven_turbo_v2_5",
  "voice_settings": {
    "stability": 0.5,
    "similarity_boost": 0.75
  }
}
```

**Alternative — voice ID in URL:**
```bash
POST /notify/elevenlabs/SAz9YHcvj6GT2YYXdXww
{"text": "Hello", "model_id": "eleven_turbo_v2_5"}
```

Returns `{ "status": "success", "message": "TTS complete" }` on success, or error JSON with appropriate HTTP status.

**Configuration:** Requires `ELEVENLABS_API_KEY` in `.env` file (gitignored). See `.env.example` for required variables.

## Voice Registry

Voice IDs map to text descriptions used as prompts for Qwen3-TTS VoiceDesign.

- **Seed voices** (in `config.ts`) — known IDs get specific descriptions
- **Voice pool** — unknown IDs get assigned from a rotating pool of professional voice descriptions
- **Persistence** — all mappings saved to `voices.json`

Known voice IDs:

| ID | Description |
|----|-------------|
| `fTtv3eikoepIosk8dTZ5` | Composed, precise male. High energy, direct, moderately warm |
| `21m00Tcm4TlvDq8ikWAM` | Same as above |
| `ZF6FPAbjXT4488VcRRnw` | Warm, professional female. Articulate with artistic sensibility |
| `default` | Clear, professional male. Calm and direct, mid-range pitch |

## File Structure

```
voiceserver/
├── server.ts          # Main Bun server — voice registry, TTS, playback
├── config.ts          # Ports, model IDs, voice pool, seed voices, ElevenLabs config
├── audio-ctl          # Stack management script (start/stop/status/etc)
├── tts-proxy.py       # Instruct injection proxy for Qwen3-TTS
├── voices.json        # Persisted voice ID → description mappings
├── workspace/         # Runtime logs and PIDs (gitignored)
├── CLAUDE.md          # Minimal context for AI sessions
└── docs.md            # This file — full documentation

# Environment (gitignored)
.env                   # ELEVENLABS_API_KEY
.env.example           # Template for required environment variables
```

## Setup from Scratch

```bash
# 1. Create Python venv and install mlx-audio
uv venv ~/.venvs/audio-services --python 3.10
source ~/.venvs/audio-services/bin/activate
uv pip install 'mlx-audio[all,server]' --prerelease=allow

# 2. Download models
./audio-ctl model download

# 3. Install launchd plist (optional, for auto-restart)
./audio-ctl install

# 4. Start everything
./audio-ctl start
```

## Notes

- `audio-ctl` lives in this project but a symlink exists at `~/dev/litellm/audio-ctl` for backward compat with litellm's `models-ctl`
- The old plist (`com.local.mlx-audio.plist`) that managed mlx-audio directly has been removed
- workspace/ replaced the old /tmp workdir which caused crashes on reboot
