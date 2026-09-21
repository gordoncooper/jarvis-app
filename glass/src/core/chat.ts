/** Conversation primitives shared by every theme. */

export type ChatMsg = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export function nextMsgId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function dayOfYear(d = new Date()): number {
  const start = new Date(d.getFullYear(), 0, 0);
  return Math.floor((d.getTime() - start.getTime()) / 86400000);
}
