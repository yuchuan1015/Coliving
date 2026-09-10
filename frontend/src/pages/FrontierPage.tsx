import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { FRONTIER_SITES, FRONTIER_SYSTEM_IMAGE, FRONTIER_GARDEN_IMAGE } from "../data/frontier";
import { uiText } from "../i18n/core";
import { useUiLanguage } from "../i18n/useUiLanguage";
import "../frontier.css";

export function FrontierPage() {
  useUiLanguage();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selectedIndexRef = useRef(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({});
  const selected = FRONTIER_SITES[selectedIndex];
  useEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: "instant" }); }, []);
  const select = (index: number) => {
    const track = trackRef.current;
    if (!track || !track.clientWidth) return;
    track.scrollTo({ left: Math.max(0, Math.min(FRONTIER_SITES.length - 1, index)) * track.clientWidth,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  };
  useEffect(() => {
    const track = trackRef.current;
    if (!track || typeof ResizeObserver === "undefined") return;
    let width = track.clientWidth;
    const observer = new ResizeObserver(() => {
      if (track.clientWidth === width || !track.clientWidth) return;
      width = track.clientWidth;
      track.scrollTo({ left: selectedIndexRef.current * width, behavior: "instant" });
    });
    observer.observe(track);
    return () => observer.disconnect();
  }, []);

  return <main className="frontier-page">
    <header className="frontier-header">
      <Link className="frontier-back" to="/outside">{uiText("← 返回目的地")}</Link>
      <span className="frontier-code">NAV / 03</span>
      <div className="frontier-title"><h1>Procyon <span>· {uiText("開荒")}</span></h1>
        <p aria-label={uiText("星系座標")}>l 213.7° · b +13.0° · 11.5 ly</p></div>
    </header>

    <div className="frontier-layout">
      <section className={`frontier-system${selected.id === "garden" && !failedImages.garden ? " is-garden-view" : ""}`} aria-label={uiText("開荒星系導覽")} aria-roledescription={uiText("輪播")}>
        <div className="frontier-card-sky" aria-hidden="true"
          style={{ backgroundImage: `linear-gradient(180deg, rgba(3, 12, 22, .35), rgba(3, 12, 22, .8)), url("${FRONTIER_GARDEN_IMAGE}")` }} />
        <p className="frontier-map-note" id="frontier-swipe-hint">{uiText("左右滑動，探索據點")}</p>
        <div className="frontier-track" id="frontier-track" ref={trackRef} tabIndex={0}
          role="group" aria-label={uiText("開荒據點")} aria-describedby="frontier-swipe-hint"
          onKeyDown={event => {
            const index = event.key === "ArrowRight" ? selectedIndex + 1 : event.key === "ArrowLeft" ? selectedIndex - 1
              : event.key === "Home" ? 0 : event.key === "End" ? FRONTIER_SITES.length - 1 : null;
            if (index !== null) { event.preventDefault(); select(index); }
          }}
          onScroll={event => {
            const track = event.currentTarget;
            if (!track.clientWidth) return;
            const index = Math.max(0, Math.min(FRONTIER_SITES.length - 1, Math.round(track.scrollLeft / track.clientWidth)));
            selectedIndexRef.current = index;
            setSelectedIndex(index);
          }}>
          {FRONTIER_SITES.map((site, index) => <div key={site.id} className="frontier-slide"
            role="group" aria-roledescription={uiText("投影片")} aria-label={`${index + 1} / ${FRONTIER_SITES.length}`}
            aria-hidden={index !== selectedIndex}>
            <div className={`frontier-planet-window${site.id === "garden" ? " frontier-garden-window" : ""}`} aria-hidden="true">
              {!failedImages[site.id] && <img className={site.id === "garden" ? "frontier-garden-image" : "frontier-planet-image"}
                src={site.id === "garden" ? FRONTIER_GARDEN_IMAGE : FRONTIER_SYSTEM_IMAGE} alt=""
                width={site.id === "garden" ? 1536 : 1024} height={site.id === "garden" ? 1024 : 1536} draggable={false}
                style={site.id === "garden" ? undefined : { width: `${10000 / site.diameter}%`, left: `${50 - site.x / site.diameter * 100}%`, top: `${50 - site.y * 1.5 / site.diameter * 100}%` } as CSSProperties}
                onError={() => setFailedImages(previous => ({ ...previous, [site.id]: true }))} />}
              {failedImages[site.id] && <span className="frontier-planet-placeholder">{site.number}</span>}
            </div>
            <span className="frontier-slide-code">{site.number} / {site.english}</span>
            <h2>{uiText(site.name)}</h2>
            <span className="frontier-slide-state">{uiText(site.status)}</span>
          </div>)}
        </div>
        {failedImages[selected.id] && <p className="frontier-image-error" role="status">{uiText("星系圖片暫時無法載入，仍可切換據點。")}</p>}
        <div className="frontier-controls">
          <button className="frontier-arrow" type="button" aria-label={uiText("上一個據點")} aria-controls="frontier-track" disabled={selectedIndex === 0} onClick={() => select(selectedIndex - 1)}>‹</button>
          <div className="frontier-dots" role="group" aria-label={uiText("選擇據點")}>
            {FRONTIER_SITES.map((site, index) => <button type="button" key={site.id} className="frontier-dot"
              aria-label={uiText`${uiText(site.name)}，${uiText(site.status)}`} aria-pressed={selectedIndex === index}
              aria-controls="frontier-track frontier-site-detail" onClick={() => select(index)}><span /></button>)}
          </div>
          <button className="frontier-arrow" type="button" aria-label={uiText("下一個據點")} aria-controls="frontier-track" disabled={selectedIndex === FRONTIER_SITES.length - 1} onClick={() => select(selectedIndex + 1)}>›</button>
        </div>
      </section>

      <section className="frontier-detail" id="frontier-site-detail" aria-live="polite" aria-atomic="true" aria-label={uiText("據點資訊")}>
        <span className="frontier-detail-code">{selected.number} / {selected.english}</span>
        <div className="frontier-detail-title"><h2>{uiText(selected.name)}</h2><span>{uiText(selected.status)}</span></div>
        <p>{uiText(selected.description)}</p>
        <p className="frontier-notice">{uiText(selected.notice)}</p>
        {selected.id === "garden" && <Link className="frontier-back" to="/frontier/garden">{uiText("進入公共農田 →")}</Link>}
      </section>
    </div>
  </main>;
}
