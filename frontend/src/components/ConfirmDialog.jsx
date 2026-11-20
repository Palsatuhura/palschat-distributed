import { useEffect } from "react";

/**
 * ConfirmDialog
 * A small "Are you sure?" box used before things that cannot be undone.
 * Escape or a click outside cancels.
 */
const ConfirmDialog = ({
  title,
  message,
  confirmLabel = "Confirm",
  danger = false,
  busy = false,
  error = "",
  onConfirm,
  onCancel,
}) => {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && !busy) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  return (
    <div
      className="fixed inset-0 z-[60] bg-black bg-opacity-40 flex items-center justify-center px-4"
      onClick={busy ? undefined : onCancel}
    >
      <div
        className="bg-surface rounded-2xl shadow-xl w-full max-w-sm p-6"
        onClick={(e) => e.stopPropagation()}
        role="alertdialog"
        aria-label={title}
      >
        <h2 className="text-lg font-semibold text-ink">{title}</h2>
        <p className="text-sm text-ink-2 mt-2">{message}</p>
        {error && <p className="text-sm text-danger-text mt-2">{error}</p>}
        <div className="flex justify-end gap-2 mt-5">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 text-sm rounded-lg text-ink-2 hover:bg-surface-3 disabled:text-ink-4"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`px-4 py-2 text-sm rounded-lg text-white disabled:opacity-60 ${
              danger ? "bg-danger hover:bg-danger-hover" : "bg-brand hover:bg-brand-hover"
            }`}
          >
            {busy ? "Please wait..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
