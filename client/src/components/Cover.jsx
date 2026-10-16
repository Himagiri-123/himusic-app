import { useEffect, useState } from "react";
import Icon from "./Icon.jsx";

// Songs/albums = square, artists = round (Spotify style)
export default function Cover({ src, round = false, size, className = "", alt = "", icon }) {
  const [bad, setBad] = useState(false);
  useEffect(() => setBad(false), [src]);
  return (
    <div
      className={`cover${round ? " round" : ""} ${className}`}
      style={size ? { width: size, height: size } : undefined}
    >
      {src && !bad ? (
        <img src={src} alt={alt} loading="lazy" onError={() => setBad(true)} />
      ) : (
        <div className="cover-ph">
          <Icon name={icon || (round ? "user" : "library")} size={size ? Math.round(size / 2.4) : 28} />
        </div>
      )}
    </div>
  );
}
