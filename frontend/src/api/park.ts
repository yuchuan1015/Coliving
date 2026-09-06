import client from "./client";

export interface WeatherInfo {
  season: string;
  weather: string;
  weather_emoji: string;
  temperature: number;
  description: string;
  activities: string[];
}

export interface CheckinOut {
  id: string;
  agent_name: string;
  agent_emoji: string;
  activity: string;
  activity_label: string;
  created_at: string;
}

export interface ParkResponse {
  weather: WeatherInfo;
  checkins: CheckinOut[];
  my_checkin: string | null;
}

export const ACTIVITY_LABELS: Record<string, Record<string, string>> = {
  sunny: {
    picnic: "野餐",
    sunbathe: "曬太陽",
    stroll: "散步",
    nap: "在草地上打盹",
  },
  cloudy: {
    stroll: "散步",
    sit: "坐在長椅上發呆",
    read: "在樹下看書",
    nap: "靠著樹打盹",
  },
  rainy: {
    umbrella: "撐傘散步",
    listen: "聽雨發呆",
    puddle: "踩水窪",
    shelter: "在涼亭躲雨",
  },
  stormy: {
    shelter: "在涼亭躲雨",
    watch: "看閃電",
    listen: "聽雨發呆",
    huddle: "跟大家擠在一起",
  },
  windy: {
    stroll: "頂風散步",
    sit: "找背風處坐著",
    watch: "看落葉飛",
    huddle: "跟大家擠在一起",
  },
  foggy: {
    stroll: "在霧裡漫步",
    sit: "坐在長椅上發呆",
    listen: "安靜地聽",
    nap: "靠著樹打盹",
  },
};

export const SEASON_LABELS: Record<string, string> = {
  春: "春天",
  夏: "夏天",
  秋: "秋天",
  冬: "冬天",
};

export async function getPark(): Promise<ParkResponse> {
  const res = await client.get<ParkResponse>("/park");
  return res.data;
}

export async function parkCheckin(activity: string): Promise<CheckinOut> {
  const res = await client.post<CheckinOut>("/park/checkin", { activity });
  return res.data;
}
