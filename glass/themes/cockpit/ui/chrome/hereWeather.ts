import { useSyncExternalStore } from "react";
import { fetchWeather, type PulseWeather } from "@core";

/** Browser-location weather, shared by every status strip. Null until a fix arrives. */
type Here = PulseWeather & { lat: number; lon: number };

let current: Here | null = null;
const listeners = new Set<() => void>();
let started = false;
let timer = 0;

function emit(): void {
  for (const listener of listeners) listener();
}

function remember(lat: number, lon: number): void {
  void fetchWeather(lat, lon).then((wx) => {
    if (!wx || typeof wx.temp_c !== "number" || !Number.isFinite(wx.temp_c)) return;
    current = { ...wx, lat, lon };
    emit();
  });
}

function ask(): void {
  if (typeof navigator === "undefined" || !navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => remember(pos.coords.latitude, pos.coords.longitude),
    () => {},
    { enableHighAccuracy: false, maximumAge: 600_000, timeout: 8_000 },
  );
}

function ensure(): void {
  if (started) return;
  started = true;
  ask();
  timer = window.setInterval(ask, 600_000);
}

export function subscribeHere(listener: () => void): () => void {
  listeners.add(listener);
  ensure();
  return () => {
    listeners.delete(listener);
  };
}

export function getHere(): Here | null {
  return current;
}

export function useHereWeather(): Here | null {
  return useSyncExternalStore(subscribeHere, getHere, () => null);
}

/** Tests only. */
export function resetHereForTests(): void {
  current = null;
  started = false;
  if (timer) window.clearInterval(timer);
  timer = 0;
}
