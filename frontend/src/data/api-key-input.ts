import type { ClipboardEvent } from "react";

/** Trim only surrounding whitespace, never silently rewrite the key itself. */
export function pasteApiKey(event: ClipboardEvent<HTMLInputElement>, setValue: (value: string) => void) {
  event.preventDefault();
  const input = event.currentTarget;
  const pasted = event.clipboardData.getData("text").trim();
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  setValue((input.value.slice(0, start) + pasted + input.value.slice(end)).trim());
}
