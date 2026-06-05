import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import OpenAI from "openai";
import { logger } from "./logger";
import type { TranscriptCue } from "./transcriptParser";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/** Audio chunk length in seconds. At 64 kbps mono ~= 4.8 MB per chunk, safely under Whisper's 25 MB limit. */
const CHUNK_SECONDS = 600;

/** Hard ceiling for the ffmpeg audio extraction step (large broadcasts can be ~0.5 GB). */
const FFMPEG_TIMEOUT_MS = 40 * 60 * 1000;

/** Hard ceiling for the yt-dlp download step. */
const YTDLP_TIMEOUT_MS = 30 * 60 * 1000;

/** True for youtube.com / youtu.be page URLs (which need yt-dlp, not a direct fetch). */
export function isYouTubeUrl(rawUrl: string): boolean {
  try {
    const host = new URL(rawUrl).hostname.toLowerCase().replace(/^www\./, "");
    return host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be";
  } catch {
    return false;
  }
}

function runProcess(cmd: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error(`${cmd}: превышено время выполнения`));
    }, timeoutMs);

    proc.stdout?.on("data", (d) => (stdout += d.toString()));
    proc.stderr?.on("data", (d) => (stderr += d.toString()));
    proc.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(`${cmd} завершился с кодом ${code}: ${stderr.slice(-400)}`));
    });
  });
}

function runFfmpeg(args: string[]): Promise<void> {
  return runProcess("ffmpeg", args, FFMPEG_TIMEOUT_MS).then(() => undefined);
}

/**
 * Download the best audio track of a YouTube video to a local file via yt-dlp.
 * Returns the path of the downloaded file (inside workDir).
 */
async function downloadYouTubeAudio(url: string, workDir: string): Promise<string> {
  const outTemplate = path.join(workDir, "yt-source.%(ext)s");
  await runProcess(
    "yt-dlp",
    ["-f", "bestaudio/best", "--no-playlist", "--no-progress", "-o", outTemplate, url],
    YTDLP_TIMEOUT_MS
  );
  const file = fs.readdirSync(workDir).find((f) => f.startsWith("yt-source."));
  if (!file) {
    throw new Error("Не удалось скачать аудио из YouTube");
  }
  return path.join(workDir, file);
}

export interface YouTubeMetadata {
  /** ISO YYYY-MM-DD upload date, or null. */
  uploadDate: string | null;
  title: string | null;
}

/** Fetch a YouTube video's upload date and title (no download). Best-effort. */
export async function getYouTubeMetadata(url: string): Promise<YouTubeMetadata> {
  try {
    const out = await runProcess(
      "yt-dlp",
      ["--no-playlist", "--skip-download", "--print", "%(upload_date)s\t%(title)s", url],
      5 * 60 * 1000
    );
    const [rawDate, ...titleParts] = out.trim().split("\t");
    const title = titleParts.join("\t").trim() || null;
    const uploadDate = /^\d{8}$/.test(rawDate)
      ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`
      : null;
    return { uploadDate, title };
  } catch (err) {
    logger.warn({ err, url }, "Failed to fetch YouTube metadata");
    return { uploadDate: null, title: null };
  }
}

interface VerboseTranscription {
  segments?: Array<{ start: number; end: number; text: string }>;
  text?: string;
}

/**
 * Download a video by URL, extract its audio, and transcribe it to timecoded cues.
 *
 * For a direct media URL ffmpeg streams the remote file directly. For a YouTube
 * page URL the audio is first fetched with yt-dlp to a temp file, then handed to
 * the same ffmpeg pipeline. ffmpeg splits the audio into fixed-length chunks
 * (each well under Whisper's 25 MB limit); each chunk is transcribed with
 * segment-level timestamps, offset by the chunk's position so the final cues
 * span the whole broadcast.
 */
export async function transcribeVideo(
  url: string,
  onProgress?: (msg: string) => void
): Promise<TranscriptCue[]> {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "video-transcribe-"));
  const pattern = path.join(workDir, "chunk_%04d.mp3");

  try {
    let input = url;
    if (isYouTubeUrl(url)) {
      onProgress?.("Скачивание аудио из YouTube…");
      input = await downloadYouTubeAudio(url, workDir);
      onProgress?.("Извлечение аудио из видео…");
    } else {
      onProgress?.("Скачивание и извлечение аудио из видео…");
    }

    await runFfmpeg([
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      input,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-b:a",
      "64k",
      "-f",
      "segment",
      "-segment_time",
      String(CHUNK_SECONDS),
      pattern,
    ]);

    const files = fs
      .readdirSync(workDir)
      .filter((f) => f.endsWith(".mp3"))
      .sort();

    if (files.length === 0) {
      throw new Error("Не удалось извлечь аудиодорожку из видео");
    }

    const cues: TranscriptCue[] = [];
    for (let i = 0; i < files.length; i++) {
      onProgress?.(`Расшифровка речи (${i + 1} из ${files.length})…`);
      const offset = i * CHUNK_SECONDS;
      const filePath = path.join(workDir, files[i]);

      const resp = (await openai.audio.transcriptions.create({
        file: fs.createReadStream(filePath),
        model: "whisper-1",
        response_format: "verbose_json",
        timestamp_granularities: ["segment"],
        language: "ru",
      })) as unknown as VerboseTranscription;

      for (const seg of resp.segments ?? []) {
        const text = seg.text.trim();
        if (!text) continue;
        cues.push({
          start: offset + seg.start,
          end: offset + seg.end,
          text,
        });
      }
    }

    logger.info({ chunks: files.length, cues: cues.length }, "Video transcription complete");
    return cues;
  } finally {
    fs.rm(workDir, { recursive: true, force: true }, (err) => {
      if (err) logger.warn({ err, workDir }, "Failed to clean up transcription temp dir");
    });
  }
}
