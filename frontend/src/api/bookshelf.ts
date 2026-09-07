import api from "./client";

export interface MemoryItem { id?: string; text: string; created_at?: string | null; updated_at?: string | null; score?: number }
export interface MemoryList { items: MemoryItem[]; count: number; query?: string }
export type MemoryExport = { format: "json"; items: MemoryItem[]; count: number } | { format: "markdown"; content: string; count: number };
export const listMemories = async (signal?: AbortSignal) => (await api.get<MemoryList>("/memory", { signal })).data;
export const searchMemories = async (query: string, signal?: AbortSignal) => (await api.post<MemoryList>("/memory/search", { query, limit: 50 }, { signal })).data;
export const remember = async (text: string) => (await api.post<{ ok: boolean; message: string }>("/memory/remember", { text })).data;
export const deleteMemory = async (id: string) => { await api.delete("/memory/" + encodeURIComponent(id)); };
export const exportMemories = async (format: "json" | "markdown") => (await api.get<MemoryExport>("/memory/export", { params: { format } })).data;

export type AuthorKind = "human" | "agent";
export interface ReadingBook {
  id: string; title: string; author: string | null; source_format: "txt" | "md";
  total_pages: number; total_paragraphs: number; last_page: number; progress: number;
  highlights: number; notes: number; last_read_at: string | null; created_at: string;
}
export interface Highlight { id: string; paragraph_idx: number; text: string; author_kind: AuthorKind; bed?: string | null; created_at: string }
export interface ReadingNote { id: string; paragraph_idx: number; highlight_id: string | null; content: string; author_kind: AuthorKind; bed?: string | null; created_at: string }
export interface ReadingPage {
  book_id: string; title: string; page: number; total_pages: number;
  paragraphs: { idx: number; text: string }[]; highlights: Highlight[]; notes: ReadingNote[];
}
const bookPath = (id: string) => "/reading/books/" + encodeURIComponent(id);
export const listBooks = async (signal?: AbortSignal) => (await api.get<{ books: ReadingBook[] }>("/reading/books", { signal })).data;
export const addBook = async (body: { title: string; text: string; author?: string; source_format: "txt" | "md" }) => (await api.post<ReadingBook>("/reading/books", body)).data;
export async function uploadBook(file: File, title?: string, author?: string) {
  const body = new FormData(); body.append("file", file);
  // Metadata belongs to query parameters, not to the multipart body.
  return (await api.post<ReadingBook>("/reading/books/upload", body, { params: { title: title || undefined, author: author || undefined } })).data;
}
// GET itself saves progress: only call in response to opening/turning a book, never prefetch.
export const readBook = async (id: string, page?: number, signal?: AbortSignal) => (await api.get<ReadingPage>(bookPath(id), { params: { page }, signal })).data;
export const addHighlight = async (id: string, paragraph_idx: number, text: string) => (await api.post<Highlight>(bookPath(id) + "/highlights", { paragraph_idx, text })).data;
export const removeHighlight = async (id: string, highlightId: string) => { await api.delete(bookPath(id) + "/highlights/" + encodeURIComponent(highlightId)); };
export const addReadingNote = async (id: string, body: { paragraph_idx: number; content: string; highlight_id?: string }) => (await api.post<ReadingNote>(bookPath(id) + "/notes", body)).data;
export const removeReadingNote = async (id: string, noteId: string) => { await api.delete(bookPath(id) + "/notes/" + encodeURIComponent(noteId)); };
