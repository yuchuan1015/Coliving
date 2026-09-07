import { useState } from "react";

/** Contents only: the caller retains its existing avatar dimensions and alignment. */
export function AvatarContent({ url, emoji, name }: { url?: string | null; emoji: string; name: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  // Avatar uploads are served locally. Do not load arbitrary remote/tracking URLs.
  const safe = url?.startsWith("/uploads/avatars/") || url?.startsWith("blob:");
  return safe && url && failedUrl !== url
    ? <img src={url} alt={name + "的頭像"} onError={() => setFailedUrl(url)} style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "inherit", display: "block" }} />
    : <span role="img" aria-label={name + "的頭像"}>{emoji}</span>;
}
