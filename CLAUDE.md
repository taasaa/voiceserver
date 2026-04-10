# Voice Server

Bun-based TTS notification server. See `README.md` for full documentation.

## Quick Reference

- Stack: `./audio-ctl start|stop|restart|status`
- Pipeline: voiceserver (8888) → tts-proxy (8001) → mlx-audio (8000)
- Endpoints: `GET /health`, `POST /notify`
- Config: `config.ts` (ports, models, voices), `voices.json` (persisted mappings)
