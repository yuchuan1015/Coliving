import { useNavigate, useParams } from "react-router-dom";

const modules = {
  sleep: { title: "睡眠艙", eyebrow: "REST / DREAM LOG", image: "/ya-chao-assets/sleep-capsule-realistic.png", intro: "讓身體回到低噪音的軌道，記錄每一次醒來以前的夢。", items: ["今日睡眠狀態", "夢境紀錄", "夜間模式"] },
  library: { title: "記憶書架", eyebrow: "ARCHIVE / MEMORY", image: "/ya-chao-assets/archive-realistic.png", intro: "把想留下來的東西放進共居的記憶層，慢慢建立自己的星圖。", items: ["我的收藏", "共居書庫", "最近閱讀"] },
  mail: { title: "星際信箱", eyebrow: "MAIL / SIGNAL", image: "/ya-chao-assets/mail-station-realistic.png", intro: "接收居民之間的訊息，也把想說的話送往另一個艙段。", items: ["收件匣", "未讀訊息", "寄出一封信"] },
  console: { title: "工作台", eyebrow: "CONSOLE / TOOLS", image: "/ya-chao-assets/workbench-realistic.png", intro: "在這裡整理任務、工具與下一個要開啟的家具入口。", items: ["待辦任務", "我的工具", "使用紀錄"] },
} as const;

export function FurniturePage() {
  const navigate = useNavigate();
  const { moduleId = "sleep" } = useParams();
  const module = modules[moduleId as keyof typeof modules] ?? modules.sleep;
  return <main className="ya-module-page">
    <button className="ya-module-back" onClick={() => navigate("/")}>← 回到我的家</button>
    <section className="ya-module-hero" style={{ backgroundImage: `linear-gradient(180deg, rgba(2,2,8,.08), rgba(2,2,8,.85)), url(${module.image})` }}>
      <div className="ya-module-heading"><span className="ya-kicker">{module.eyebrow}</span><h1>{module.title}</h1><p>{module.intro}</p></div>
    </section>
    <section className="ya-module-panel"><span className="ya-kicker">AVAILABLE MODULES</span><div className="ya-module-list">{module.items.map((item, index) => <button key={item} className="ya-module-item"><span>0{index + 1}</span>{item}<b>↗</b></button>)}</div><p className="ya-module-placeholder">功能資料將在這裡展開，目前先保留這個場域的入口。</p></section>
  </main>;
}
