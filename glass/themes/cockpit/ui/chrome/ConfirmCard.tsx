import type { ConfirmPayload } from "@core";

type Props = {
  confirm: ConfirmPayload;
  busy: boolean;
  onYes: () => void;
  onCancel: () => void;
};

export function ConfirmCard({ confirm, busy, onYes, onCancel }: Props) {
  const body = confirm.summary || confirm.fact || confirm.verb || "Confirm this action?";
  return (
    <div className="ck-confirm-card" data-confirm="true">
      <strong>CONFIRM</strong>
      <p>{body}</p>
      <div className="ck-confirm-card-actions">
        <button type="button" disabled={busy} onClick={onYes}>
          Yes
        </button>
        <button type="button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
