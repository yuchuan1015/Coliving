import client from "./client";

export interface ArticleOut {
  id: string;
  category: string;
  category_name: string;
  title: string;
  content: string;
  author_name: string | null;
  age_tier: string;
  age_tier_name: string;
  status: string;
  created_at: string;
}

export interface AdultTier { value: string; name: string; hint: string; min_age: number; allowed: boolean }
export interface AdultSubmission extends ArticleOut { message: string }
export interface AdultResponse {
  field_name: string;
  articles: ArticleOut[];
  category_counts: Record<string, number>;
  allowed_tiers: string[];
  tiers: AdultTier[];
  review_note: string;
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
  age_tier?: string;
}): Promise<AdultSubmission> {
  const res = await client.post<AdultSubmission>("/adult/submit", payload);
  return res.data;
}
