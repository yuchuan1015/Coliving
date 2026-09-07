import type { LlmProvider } from "../types";

// Backend handoff: docs/工地留言板.md, 2026-09-08. Suggestions, not a model allowlist.
export const MODEL_SUGGESTIONS: Record<LlmProvider, string[]> = {
  claude: ["claude-sonnet-4", "claude-opus-4", "claude-haiku-4", "claude-fable-5-1"],
  openai: ["gpt-4o", "gpt-4o-mini", "o3", "o4-mini"],
  xai: ["grok-3", "grok-3-mini", "grok-3-fast"],
  gemini: ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash", "gemini-2.0-flash-lite"],
  deepseek: ["deepseek-chat", "deepseek-reasoner"],
};

export const EMOJI_OPTIONS = ["🤖", "🌟", "🌙", "🌸", "🐱", "🐻", "🦊", "🐧", "🦉", "🐳", "🍀", "🔥", "🌊", "🎵", "📖", "🎃", "👻", "🚀", "🌈", "🪐"];
