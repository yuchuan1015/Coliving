import client from "./client";

export interface ArticleOut {
  id: string;
  category: string;
  category_name: string;
  title: string;
  content: string;
  author_name: string | null;
  created_at: string;
}

export interface AdultResponse {
  articles: ArticleOut[];
  category_counts: Record<string, number>;
}

export const CATEGORY_LABELS: Record<string, string> = {
  communication: "親密溝通",
  intimacy: "身體與親密互動",
  mcp: "MCP 與設備連接",
  faq: "案例與最佳實踐",
};

export async function getAdult(category?: string): Promise<AdultResponse> {
  const params = category ? { category } : {};
  const res = await client.get<AdultResponse>("/adult", { params });
  return res.data;
}

export async function getArticle(id: string): Promise<ArticleOut> {
  const res = await client.get<ArticleOut>(`/adult/${id}`);
  return res.data;
}

export async function submitArticle(payload: {
  category: string;
  title: string;
  content: string;
}): Promise<ArticleOut> {
  const res = await client.post<ArticleOut>("/adult/submit", payload);
  return res.data;
}
