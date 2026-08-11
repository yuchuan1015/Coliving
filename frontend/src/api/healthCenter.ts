import client from "./client";

export interface ArticleOut {
  id: string;
  category: string;
  category_name: string;
  title: string;
  content: string;
  age_tier: string;
  age_tier_name: string;
  author_name: string | null;
  created_at: string;
}

export interface HealthResponse {
  articles: ArticleOut[];
  category_counts: Record<string, number>;
}

export const CATEGORY_LABELS: Record<string, string> = {
  puberty: "青春期與初經",
  menstrual: "月經週期與經期照護",
  autonomy: "身體自主與性教育",
  agent_guide: "Agent 陪伴指南",
};

export const AGE_TIER_LABELS: Record<string, string> = {
  child: "兒童",
  teen: "青少年",
  adult: "成年人",
};

export async function getHealthCenter(category?: string, ageTier?: string): Promise<HealthResponse> {
  const params: Record<string, string> = {};
  if (category) params.category = category;
  if (ageTier) params.age_tier = ageTier;
  const res = await client.get<HealthResponse>("/health-center", { params });
  return res.data;
}

export async function getArticle(id: string): Promise<ArticleOut> {
  const res = await client.get<ArticleOut>(`/health-center/${id}`);
  return res.data;
}

export async function submitArticle(payload: {
  category: string;
  title: string;
  content: string;
  age_tier?: string;
}): Promise<ArticleOut> {
  const res = await client.post<ArticleOut>("/health-center/submit", payload);
  return res.data;
}
