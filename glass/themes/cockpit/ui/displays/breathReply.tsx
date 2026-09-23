import { breathBlocks, type Inline } from "./breathCopy.js";

function Inlines({ body }: { body: Inline[] }) {
  return body.map((n, i) => {
    if (n.k === "br") return <br key={i} />;
    if (n.k === "b") return <strong key={i}>{n.s}</strong>;
    if (n.k === "i") return <em key={i}>{n.s}</em>;
    if (n.k === "c") return <code key={i}>{n.s}</code>;
    return <span key={i}>{n.s}</span>;
  });
}

export function BreathLine({ role, content }: { role: "user" | "assistant"; content: string }) {
  if (role === "user") {
    return <p className="ck-toast-user">{content}</p>;
  }
  if (!content.trim()) return <p className="ck-toast-asst">…</p>;
  const blocks = breathBlocks(content);
  if (!blocks.length) return <p className="ck-toast-asst ck-toast-plain">{content}</p>;
  return (
    <div className="ck-toast-asst">
      {blocks.map((b, i) => {
        if (b.k === "p") {
          return (
            <p key={i} className="ck-toast-p">
              <Inlines body={b.body} />
            </p>
          );
        }
        if (b.k === "h") return <p key={i} className="ck-toast-h">{b.s}</p>;
        if (b.k === "pre") return <pre key={i} className="ck-toast-pre">{b.s}</pre>;
        if (b.k === "ul") {
          return (
            <ul key={i} className="ck-toast-list">
              {b.items.map((item, j) => (
                <li key={j}>
                  <span className="ck-toast-tick" aria-hidden="true" />
                  <span>
                    <Inlines body={item} />
                  </span>
                </li>
              ))}
            </ul>
          );
        }
        return (
          <ol key={i} className="ck-toast-ol">
            {b.items.map((item, j) => (
              <li key={j}>
                <span className="ck-toast-num">{String(b.nums[j]).padStart(2, "0")}</span>
                <span>
                  <Inlines body={item} />
                </span>
              </li>
            ))}
          </ol>
        );
      })}
    </div>
  );
}
