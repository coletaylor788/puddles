# Plan 029 — Talk mode (voice) from iOS with native TTS

## Goal

Voice conversations from the OpenClaw **iOS app**: native on-device speech
recognition, the mini gateway for chat, and **native iOS text-to-speech** for
replies. Voice I/O stays **fully on-device** (no cloud TTS, no MLX). Simplest
path to "talk to Puddles from my phone."

## Why native TTS (and not MLX)

Investigated the MLX path first (the original ask) and confirmed from source it
does not fit an iPhone client:

- The `openclaw-mlx-tts` helper is a **binary bundled inside the OpenClaw macOS
  app** (`scripts/codesign-mac-app.sh` → `$APP_BUNDLE/Contents/MacOS/openclaw-mlx-tts`;
  `scripts/package-mac-app.sh`). It runs **client-side on macOS only**.
- It is referenced **nowhere** in the gateway/CLI code, and **MLX is not a
  gateway speech provider** — `talk.speak` only synthesizes via registered
  providers (ElevenLabs, Azure). So the mini can't produce MLX audio for a phone,
  and iOS can't run a macOS binary.

MLX voice would therefore require either talking from a Mac (native macOS app) or
building a custom gateway MLX speech provider — both out of scope. For the iPhone,
the **`system` provider = native iOS TTS** is the on-device answer.

## Architecture

Talk's native speech loop (per the docs: local STT + gateway chat + `talk.speak`
TTS):

1. **iOS app** — native iOS speech recognition captures the utterance (on-device).
2. Transcript → **mini gateway session** (the gateway's configured chat model).
3. Gateway produces the reply text.
4. **`talk.provider: "system"`** → the reply is spoken via **native iOS TTS**
   (AVSpeechSynthesizer) on the phone.

| Stage | Runs on | Engine |
|---|---|---|
| STT | iPhone | native iOS speech recognition (`speechLocale`) |
| Chat/brain | mini (gateway) | the gateway's configured model |
| TTS | iPhone | **native iOS TTS** (`provider: "system"`) |

## Setup

### On the mini (gateway) — config only
1. Set the talk config in `~/.openclaw/openclaw.json`:
   ```jsonc
   "talk": {
     "provider": "system",
     "providers": { "system": {} },
     "speechLocale": "en-US",   // optional — omit for the device default
     "silenceTimeoutMs": 900,   // iOS default pause window
     "interruptOnSpeech": true  // talking over playback stops it
   }
   ```
   (If any legacy flat `talk.*` keys exist, `openclaw doctor --fix` rewrites them
   into `talk.providers.<provider>`.)
2. Restart the gateway.

### On the iPhone — the client
3. OpenClaw **iOS app**, paired to the mini gateway (existing pairing/session);
   confirm the node advertises the `talk` capability.
4. Grant **Microphone + Speech Recognition** permissions (iOS TCC).
5. Pick the iOS voice you want in **iOS Settings → Accessibility → Spoken Content
   → Voices** (native iOS TTS uses the OS voice — including the higher-quality
   "enhanced"/Siri voices if downloaded). **No Hugging Face model needed.**
6. Start Talk mode in the app.

## Voice / "model"

- Native iOS TTS uses **iOS system voices**, selected on the device — there is no
  model to install or pin (the MLX Soprano model question is moot for this path).
- For nicer output, download an **enhanced iOS voice** in iOS Settings; that's the
  entire "quality upgrade" lever here.

## Verification (done = all of these)

- Speaking to the iOS app yields a reply **spoken via native iOS TTS on the phone**.
- **Zero cloud-TTS calls** (no ElevenLabs egress during a turn).
- `interruptOnSpeech` works; `silenceTimeoutMs` feels natural for your cadence.
- STT accuracy is acceptable at your `speechLocale`.

## Open items to confirm on first run

- That `talk.provider: "system"` resolves to **native iOS TTS** end-to-end. The
  docs group `elevenlabs`/`mlx`/`system` as "local playback paths" and note the
  Android system-TTS fallback; iOS should likewise play via native TTS — confirm
  on the first live test.
- That the `talk` block is read from the mini's `openclaw.json` (gateway config).
- The iOS app's Talk-mode entry point + that the phone is paired and shows the
  `talk` capability.

## Notes

- **Fully on-device voice:** STT + TTS both on the iPhone; only the chat *text*
  goes to the gateway's model, exactly as normal messages do. No reply audio to
  any cloud vendor.
- **Simplest possible setup:** config + iOS permissions — no MLX install, no
  helper binary, no model download.
- **Future upgrades** (if native iOS TTS isn't good enough): gateway **ElevenLabs**
  (cloud, higher quality) as a drop-in `talk.provider` change, or a **custom
  gateway MLX speech provider** (an OpenClaw extension registering `openclaw-mlx-tts`
  via `registerSpeechProvider`) to get MLX voice on the phone — both are larger
  efforts, explicitly out of this v1.
