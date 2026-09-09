import { useState } from "react";
import type { CabinPhoto } from "../api/furniture";
import { cabinFrameMatrix, FRAME_SURFACE } from "../data/cabin-frame";

interface Props {
  active: boolean;
  photo: CabinPhoto | null | undefined;
  sceneSize: { width: number; height: number };
  imageSize: { width: number; height: number };
  positionY: number;
}

export function CabinPhotoFrame({ active, photo, sceneSize, imageSize, positionY }: Props) {
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const matrix = cabinFrameMatrix(sceneSize.width, sceneSize.height, imageSize.width, imageSize.height, positionY);
  if (!matrix) return null;
  const failed = Boolean(photo && failedUrl === photo.url);
  const loaded = Boolean(photo && loadedUrl === photo.url && !failed);
  const state = photo === undefined ? "unavailable" : photo === null ? "empty" : failed ? "error" : loaded ? "displayed" : "loading";
  const label = state === "unavailable" ? "相框待同步" : state === "empty" ? "相框空著" : state === "error" ? "照片暫時無法顯示，請開啟相簿更新" : photo?.caption || "相框裡的展示照片";
  return <div className={`cabin-photo-frame${active ? " is-current" : ""}`} aria-hidden={!active}>
    <div className="cabin-frame-surface" role="img" aria-label={label} data-frame-state={state}
      style={{ width: FRAME_SURFACE.width, height: FRAME_SURFACE.height, transform: `matrix3d(${matrix.join(",")})` }}>
      {photo && !failed && <img key={photo.url} src={photo.url} alt="" draggable={false} referrerPolicy="no-referrer" decoding="async"
        style={{ opacity: loaded ? 1 : 0 }} onLoad={() => setLoadedUrl(photo.url)} onError={() => setFailedUrl(photo.url)} />}
      <span className="cabin-frame-glass" aria-hidden="true" />
    </div>
  </div>;
}
