---
name: YouTube transcript extraction blocked from datacenter IP
description: Why server-side YouTube caption/audio extraction is impossible here, and the chosen workaround
---

Server-side extraction of YouTube transcripts/captions/audio is **impossible** from this Replit datacenter IP. Confirmed exhaustively blocked:
- youtubei.js / InnerTube API — all client types blocked
- watch-page caption scraping — captions stripped from response
- yt-dlp audio download — "Sign in to confirm you're not a bot"
- public Invidious instances — all down or blocked

**Why:** Google blocks known datacenter/cloud IP ranges. No amount of client spoofing or endpoint switching gets around it; do not re-attempt these approaches.

**How to apply:** The product instead ingests **pasted/uploaded subtitles** (.srt/.vtt) or timecoded transcript text. A parser turns them into timed cues, GPT-4o-mini segments them into "сюжеты" with timecodes, then the existing direction-classification step runs. The YouTube URL is kept only as an optional reference field. If asked to "fetch from YouTube automatically" again, explain the IP block and point to the subtitle-paste flow.

**Direct media-file URLs DO work (unlike YouTube):** a public direct `.mp4` URL (e.g. a broadcaster CDN like 1tv.kz) can be ingested fully automatically — ffmpeg streams the audio (`-i <url> -vn -ac 1 -ar 16000 -b:a 64k -f segment -segment_time 600`) into ~10-min chunks, each transcribed by Whisper (whisper-1, ru), timestamps offset per chunk, then segmented + classified. This runs as a **detached background job**: POST returns 201 immediately with status `transcribing`; the client polls GET /sessions/:id until `done`/`error`. Whisper's 25MB limit is why chunks are 600s (~4.8MB).

**Why the constraint is the file, not the protocol:** YouTube/page URLs are blocked by Google's bot defense, but a raw file URL is just an HTTP GET ffmpeg can read. Require a direct file URL, not a watch/page URL.

**Security:** any server-side fetch of a user-supplied URL (ffmpeg `-i`) is an SSRF vector — validate with an SSRF guard (resolve DNS, reject loopback/private/link-local/CGNAT/metadata `169.254.169.254`) BEFORE fetching. Detached background jobs must guard every promise path (best-effort/log-only progress writes + `.catch` on the fire-and-forget call) so a transient failure can't crash the process or strand a session in `transcribing`.
