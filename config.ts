export const PORT = 8888
export const LITELLM_URL = "http://localhost:4000/v1/audio/speech"
export const LITELLM_KEY = "sk-1234"
export const LITELLM_MODEL = "local-tts"
export const AUDIO_FORMAT = "wav"
export const VOICES_FILE = import.meta.dir + "/voices.json"

const defaultVoice = "A clear, professional male voice. Calm and direct, mid-range pitch."
const mainVoice = "A composed, precise male voice. High energy, direct, moderately warm."

export const VOICE_POOL = [
  "A warm, professional female voice. Articulate and composed.",
  "A confident, professional male voice. Slightly deeper, measured pace.",
  "A bright, professional female voice. Crisp enunciation, friendly but formal.",
  "A steady, professional male voice. Even tone, authoritative and clear.",
  "A composed, professional female voice. Lower register, thoughtful delivery.",
  "A brisk, professional male voice. Energetic but controlled, sharp articulation.",
  "A smooth, professional female voice. Even-tempered, confident and precise.",
]

export const SEED_VOICES: Record<string, string> = {
  "fTtv3eikoepIosk8dTZ5": mainVoice,
  "21m00Tcm4TlvDq8ikWAM": mainVoice,
  "ZF6FPAbjXT4488VcRRnw": "A warm, professional female voice. Articulate with artistic sensibility.",
  default: defaultVoice,
}
