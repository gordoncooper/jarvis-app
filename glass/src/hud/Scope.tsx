export function Scope() {
  return (
    <div className="hud-scope" aria-hidden="true">
      <div className="hud-scope-oval" />
      <div className="hud-scope-cross" />
      <span className="hud-scope-br tl" />
      <span className="hud-scope-br tr" />
      <span className="hud-scope-br bl" />
      <span className="hud-scope-br br" />
      <div className="hud-scope-hash hud-scope-hash-n" />
      <div className="hud-scope-hash hud-scope-hash-s" />
      <div className="hud-scope-hash hud-scope-hash-e" />
      <div className="hud-scope-hash hud-scope-hash-w" />
    </div>
  );
}
