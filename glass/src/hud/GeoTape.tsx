import { useEffect, useRef } from "react";
import { geo } from "../viz/globe/geo.js";

function fmtLat(v: number): string {
  const a = Math.abs(v).toFixed(1);
  return `${a}°${v >= 0 ? "N" : "S"}`;
}
function fmtLon(v: number): string {
  const a = Math.abs(v).toFixed(1);
  return `${a}°${v >= 0 ? "E" : "W"}`;
}

export function GeoTape() {
  const mode = useRef<HTMLSpanElement>(null);
  const hdg = useRef<HTMLSpanElement>(null);
  const look = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let id = 0;
    const tick = () => {
      if (mode.current) mode.current.textContent = geo.mode;
      if (hdg.current) hdg.current.textContent = geo.hdg.toFixed(1).padStart(5, "0");
      if (look.current) look.current.textContent = `${fmtLat(geo.lat)}  ${fmtLon(geo.lon)}`;
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div className="hud-geo">
      <div className="hud-panel-label">TRACK</div>
      <div className="hud-geo-row">
        <span>MODE</span>
        <span ref={mode} className="hud-geo-val">
          —
        </span>
      </div>
      <div className="hud-geo-row">
        <span>HDG</span>
        <span ref={hdg} className="hud-geo-val">
          —
        </span>
      </div>
      <div className="hud-geo-row">
        <span>LOOK</span>
        <span ref={look} className="hud-geo-val">
          —
        </span>
      </div>
    </div>
  );
}
