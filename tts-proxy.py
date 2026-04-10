#!/usr/bin/env python3
"""TTS proxy — injects 'instruct' param for mlx-audio Qwen3-TTS.

Sits between voiceserver and mlx-audio. When a TTS request arrives without
'instruct', copies it from the 'voice' field so Qwen3-TTS VoiceDesign
actually generates audio.

Usage: python3 tts-proxy.py [--port PORT] [--upstream URL]
"""

import argparse
import json
import sys
import urllib.request
import urllib.error
from http.server import HTTPServer, BaseHTTPRequestHandler

UPSTREAM_DEFAULT = "http://localhost:8000"
LISTEN_PORT = 8001
DEFAULT_INSTRUCT = "A calm, focused AI assistant with a natural American male voice."


class TTSProxyHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)

        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            self.send_error(400, "Invalid JSON")
            return

        # Inject instruct if missing — copy from voice, or use default
        if "instruct" not in data:
            data["instruct"] = data.get("voice") or DEFAULT_INSTRUCT

        upstream_body = json.dumps(data).encode()

        # Build upstream URL
        target = f"{self.server.upstream}{self.path}"
        req = urllib.request.Request(
            target,
            data=upstream_body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        try:
            resp = urllib.request.urlopen(req, timeout=60)
        except urllib.error.HTTPError as e:
            self.send_error(e.code, str(e.reason))
            return
        except Exception as e:
            self.send_error(502, f"Upstream error: {e}")
            return

        # Stream binary response back
        self.send_response(resp.status)
        for key in ("Content-Type", "Content-Length"):
            val = resp.getheader(key)
            if val:
                self.send_header(key, val)
        self.end_headers()

        chunk_size = 8192
        while True:
            chunk = resp.read(chunk_size)
            if not chunk:
                break
            self.wfile.write(chunk)

    def log_message(self, fmt, *args):
        # Quiet by default — only log errors
        if args and "502" in str(args[0]):
            sys.stderr.write(f"[tts-proxy] {fmt % args}\n")


def main():
    parser = argparse.ArgumentParser(description="TTS proxy with instruct injection")
    parser.add_argument("--port", type=int, default=LISTEN_PORT)
    parser.add_argument("--upstream", default=UPSTREAM_DEFAULT)
    args = parser.parse_args()

    server = HTTPServer(("0.0.0.0", args.port), TTSProxyHandler)
    server.upstream = args.upstream
    print(f"[tts-proxy] Listening on :{args.port}, upstream → {args.upstream}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[tts-proxy] Stopped.")
        server.server_close()


if __name__ == "__main__":
    main()
