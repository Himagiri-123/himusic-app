import { useEffect, useState } from "react";
import { usePlayer } from "../PlayerContext.jsx";
import Icon from "./Icon.jsx";

export function useSleepLeft() {
  const { sleep } = usePlayer();
  const [, tick] = useState(0);
  useEffect(() => {
    if (sleep?.mode !== "time") return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [sleep]);
  if (!sleep) return null;
  if (sleep.mode === "song") return "End of song";
  const s = Math.max(0, Math.round((sleep.endAt - Date.now()) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export default function SleepSheet({ onClose }) {
  const { sleep, setSleep } = usePlayer();
  const left = useSleepLeft();
  const pick = (v) => {
    setSleep(v);
    onClose();
  };
  return (
    <div className="sheet-bg" style={{ zIndex: 120 }} onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h3 className="sheet-title">Sleep timer</h3>
        {sleep && <p className="sub pad-h">Music stops in {left}</p>}
        {[[15, "15 minutes"], [30, "30 minutes"], [60, "60 minutes"], ["song", "End of this song"]].map(([v, label]) => (
          <button key={v} className="sheet-item" onClick={() => pick(v)}>
            <Icon name="moon" size={24} /> <span>{label}</span>
          </button>
        ))}
        {sleep && (
          <button className="sheet-item danger" onClick={() => pick(null)}>
            <Icon name="close" size={24} /> <span>Turn off timer</span>
          </button>
        )}
      </div>
    </div>
  );
}
