import OpenAI from "openai";

/**
 * Single shared OpenAI client. Retries cover transient 429/5xx so one hiccup
 * on chunk N of a long broadcast doesn't throw away the already-paid chunks.
 */
export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  maxRetries: 4,
  timeout: 10 * 60 * 1000,
});

/**
 * Model names are configurable via env so they can be switched without a code
 * change when OpenAI retires a model (whisper-1 / gpt-4o / gpt-4o-mini snapshots
 * are scheduled for shutdown in Jan–Feb 2027).
 */
export const MODELS = {
  /** Speech-to-text. Must support verbose_json + segment timestamps. */
  transcribe: process.env.OPENAI_TRANSCRIBE_MODEL?.trim() || "whisper-1",
  /** Stronger model: вёрстка↔video merge and batched classification. */
  main: process.env.OPENAI_MODEL?.trim() || "gpt-4o",
  /** Cheap model: transcript segmentation and per-segment fallback. */
  mini: process.env.OPENAI_MINI_MODEL?.trim() || "gpt-4o-mini",
};
