import assert from "node:assert/strict";
import test from "node:test";
import { statusFacts } from "./statusFacts.ts";

const now = new Date("2026-09-23T20:41:03Z");

test("status facts stay in one order", () => {
  const ids = statusFacts(null, now).map((f) => f.id);
  assert.deepEqual(ids, ["weather", "date", "local", "utc", "lan", "k3s"]);
});

test("clocks come from the browser and cluster fields stay empty without a pulse", () => {
  const facts = Object.fromEntries(statusFacts(null, now).map((f) => [f.id, f.value]));
  assert.equal(facts.weather, "—");
  assert.equal(facts.lan, "—");
  assert.equal(facts.k3s, "—");
  assert.equal(facts.utc, "20:41:03");
  assert.match(facts.local, /^\d{2}:\d{2}:\d{2}$/);
  assert.match(facts.date, /Sep/);
});

test("weather, LAN, and k3s come from the pulse", () => {
  const pulse = {
    lan: "192.168.8.0/24",
    k3s: "6/6",
    weather: { temp_c: 18.4, text: "clear" },
  };
  const facts = Object.fromEntries(statusFacts(pulse, now).map((f) => [f.id, f.value]));
  assert.equal(facts.weather, "18°C, clear");
  assert.equal(facts.lan, "192.168.8.0/24");
  assert.equal(facts.k3s, "6/6");
});
