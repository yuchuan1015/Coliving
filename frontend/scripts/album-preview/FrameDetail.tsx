import { CabinPhotoFrame } from "../../src/components/CabinPhotoFrame";
import type { CabinPhoto } from "../../src/api/furniture";

/** Dev-only optical alignment check. No assets are edited or exported. */
export function FrameDetail({ photo }: { photo: CabinPhoto }) {
  return <main style={{ padding: 24, background: "#090711", color: "#ded4ee" }}>
    <h1 style={{ fontSize: 18, marginBottom: 16 }}>原圖／展示照片／空相框 · 對位檢查</h1>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 24 }}>
      {["original", "photo", "empty"].map(mode => <section key={mode}>
        <h2 style={{ fontSize: 16, marginBottom: 8 }}>{mode}</h2>
        <div style={{ position: "relative", width: 240, height: 280, overflow: "hidden", border: "1px solid #554767" }}>
          <div style={{ position: "absolute", width: 1053, height: 1494, left: -580, top: -1328, transform: "scale(2)", transformOrigin: "0 0" }}>
            <img src="/ya-chao-assets/cabin-memory-v1.webp" width={1053} height={1494} alt="原始相框細節" style={{ maxWidth: "none", display: "block" }} />
            {mode !== "original" && <CabinPhotoFrame active photo={mode === "photo" ? photo : null} sceneSize={{ width: 1053, height: 1494 }} imageSize={{ width: 1053, height: 1494 }} positionY={.5} />}
          </div>
        </div>
      </section>)}
    </div>
  </main>;
}
