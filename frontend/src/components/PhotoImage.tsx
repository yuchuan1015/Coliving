import { useState } from "react";

/** Signed URLs live only in the current API response. No persistence or auto-retry. */
export function PhotoImage({ src, alt, preview = false }: { src: string; alt: string; preview?: boolean }) {
  const [failed, setFailed] = useState<string | null>(null);
  return failed === src ? <span className="photo-image-fallback" role="status">{preview ? "此格式無法在瀏覽器預覽，仍可上傳。" : "照片暫時無法顯示，請更新相簿。"}</span>
    : <img src={src} alt={alt} referrerPolicy="no-referrer" decoding="async" onError={() => setFailed(src)} />;
}
