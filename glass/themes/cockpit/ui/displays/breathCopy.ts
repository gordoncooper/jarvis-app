/**
 * Layout for one JARVIS reply on the breath strip.
 *
 * A single newline is a line break — this is a strip, not a paragraph folder —
 * and a blank line starts a new block. List markers and emphasis sigils come
 * off. An unclosed marker stays literal so a token stream cannot swallow the
 * tail of the reply.
 */

export type Inline =
  | { k: "t"; s: string }
  | { k: "b"; s: string }
  | { k: "i"; s: string }
  | { k: "c"; s: string }
  | { k: "br" };

export type Block =
  | { k: "p"; body: Inline[] }
  | { k: "h"; s: string }
  | { k: "ul"; items: Inline[][] }
  | { k: "ol"; nums: number[]; items: Inline[][] }
  | { k: "pre"; s: string };

const FENCE = /^[ \t]{0,3}```([^`]*)$/;
const RULE = /^[ \t]{0,3}([-*_])\1{2,}[ \t]*$/;
const UL = /^[ \t]{0,3}[-*+•–—]\s+(.*)$/;
const OL = /^[ \t]{0,3}(\d{1,2})[.)]\s+(.*)$/;
const HEAD = /^[ \t]{0,3}#{1,6}\s+(.*)$/;
const QUOTE = /^[ \t]{0,3}>\s?/;
const CONT = /^[ \t]{2,}(\S.*)$/;

function scan(s: string): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  const pushText = () => {
    if (buf) {
      out.push({ k: "t", s: buf });
      buf = "";
    }
  };
  let i = 0;
  while (i < s.length) {
    const triple = s.startsWith("***", i) || s.startsWith("___", i);
    if (triple) {
      const mark = s.slice(i, i + 3);
      const close = s.indexOf(mark, i + 3);
      if (close > i + 3) {
        pushText();
        out.push(...emphasize("b", s.slice(i + 3, close)));
        i = close + 3;
        continue;
      }
    }
    const dbl = s.startsWith("**", i) || s.startsWith("__", i);
    if (dbl) {
      const mark = s.slice(i, i + 2);
      const close = s.indexOf(mark, i + 2);
      if (close > i + 2) {
        pushText();
        out.push(...emphasize("b", s.slice(i + 2, close)));
        i = close + 2;
        continue;
      }
    }
    if (s[i] === "`") {
      const close = s.indexOf("`", i + 1);
      if (close > i + 1) {
        pushText();
        out.push({ k: "c", s: s.slice(i + 1, close) });
        i = close + 1;
        continue;
      }
    }
    if (s[i] === "*" || s[i] === "_") {
      const mark = s[i];
      const wrapped = takeEm(s, i, mark);
      if (wrapped) {
        pushText();
        out.push(...emphasize("i", wrapped.inner));
        i = wrapped.next;
        continue;
      }
    }
    buf += s[i];
    i++;
  }
  pushText();
  return out;
}

function emphasize(kind: "b" | "i", inner: string): Inline[] {
  const parts = scan(inner);
  if (parts.every((p) => p.k === "t")) return [{ k: kind, s: inner }];
  return parts.flatMap((p) => (p.k === "t" ? [{ k: kind, s: p.s }] : [p]));
}

function takeEm(s: string, i: number, mark: string): { inner: string; next: number } | null {
  if (s[i + 1] === mark || s[i + 1] === " " || s[i + 1] === undefined) return null;
  if (mark === "_" && /\w/.test(s[i - 1] || "")) return null;
  for (let j = i + 1; j < s.length; j++) {
    if (s[j] !== mark || s[j + 1] === mark) continue;
    if (s[j - 1] === " ") continue;
    if (mark === "_" && /\w/.test(s[j + 1] || "")) continue;
    if (j === i + 1) return null;
    return { inner: s.slice(i + 1, j), next: j + 1 };
  }
  return null;
}

function inlines(line: string): Inline[] {
  const text = line
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  return scan(text);
}

function plain(parts: Inline[]): string {
  return parts.map((p) => (p.k === "br" ? "" : p.s)).join("").trim();
}

function appendItem(item: Inline[], extra: Inline[]) {
  if (!extra.length) return;
  const last = item[item.length - 1];
  if (last && last.k === "t" && extra[0].k === "t") {
    last.s += ` ${extra[0].s}`;
    item.push(...extra.slice(1));
    return;
  }
  item.push({ k: "t", s: " " }, ...extra);
}

export function breathBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let para: Inline[] = [];
  let list: Extract<Block, { k: "ul" | "ol" }> | null = null;
  let pre: string[] | null = null;

  const flushPara = () => {
    if (!para.length) return;
    blocks.push({ k: "p", body: para });
    para = [];
  };
  const flushList = () => {
    if (list && list.items.length) blocks.push(list);
    list = null;
  };

  const pushText = (line: string) => {
    flushList();
    const parts = inlines(line);
    if (!parts.length) return;
    if (para.length) para.push({ k: "br" });
    para.push(...parts);
  };

  for (const raw of lines) {
    if (pre) {
      if (FENCE.test(raw)) {
        blocks.push({ k: "pre", s: pre.join("\n") });
        pre = null;
      } else {
        pre.push(raw);
      }
      continue;
    }
    if (FENCE.test(raw)) {
      flushPara();
      flushList();
      pre = [];
      continue;
    }
    if (RULE.test(raw)) {
      flushPara();
      flushList();
      continue;
    }
    const line = QUOTE.test(raw) ? raw.replace(QUOTE, "") : raw;
    if (line.trim() === "") {
      flushPara();
      flushList();
      continue;
    }
    const ul = UL.exec(line);
    if (ul) {
      flushPara();
      if (!list || list.k !== "ul") {
        flushList();
        list = { k: "ul", items: [] };
      }
      const item = inlines(ul[1]);
      if (item.length) list.items.push(item);
      continue;
    }
    const ol = OL.exec(line);
    if (ol) {
      flushPara();
      if (!list || list.k !== "ol") {
        flushList();
        list = { k: "ol", nums: [], items: [] };
      }
      const item = inlines(ol[2]);
      if (item.length) {
        list.nums.push(Number(ol[1]));
        list.items.push(item);
      }
      continue;
    }
    if (list && CONT.test(line)) {
      const last = list.items[list.items.length - 1];
      if (last) appendItem(last, inlines(line.trim()));
      continue;
    }
    const head = HEAD.exec(line);
    if (head) {
      flushPara();
      flushList();
      const s = plain(inlines(head[1]));
      if (s) blocks.push({ k: "h", s });
      continue;
    }
    pushText(line);
  }
  if (pre) blocks.push({ k: "pre", s: pre.join("\n") });
  flushPara();
  flushList();
  return blocks;
}
