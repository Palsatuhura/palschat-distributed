import { useEffect, useState } from "react";
import { getAttachmentUrl, saveAttachment } from "../lib/attachments";
import { formatSize } from "../lib/attachmentInfo";

/**
 * AttachmentView
 * A picture (shown in the chat, click to enlarge) or a file (a card with a
 * Download button). The bytes are fetched with the login token and only if
 * the person is a member of the chat.
 */
const AttachmentView = ({ conversationId, attachment, isOwn }) => {
  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);
  const [zoom, setZoom] = useState(false);
  const [saving, setSaving] = useState(false);

  const isImage = attachment.kind === "image";

  useEffect(() => {
    if (!isImage) return undefined;
    let alive = true;
    getAttachmentUrl(conversationId, attachment.id)
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [conversationId, attachment.id, isImage]);

  useEffect(() => {
    if (!zoom) return undefined;
    const onKey = (e) => e.key === "Escape" && setZoom(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom]);

  if (isImage) {
    if (failed) {
      return <p className="text-xs italic opacity-70">Picture could not be loaded</p>;
    }
    return (
      <>
        <button
          type="button"
          onClick={() => url && setZoom(true)}
          aria-label={`Open picture ${attachment.name}`}
          className="block mb-1 rounded-lg overflow-hidden bg-black/10"
        >
          {url ? (
            <img src={url} alt={attachment.name} className="max-w-[240px] max-h-[260px] object-cover" />
          ) : (
            <div className="w-[200px] h-[140px] flex items-center justify-center text-xs opacity-70">
              Loading...
            </div>
          )}
        </button>
        {zoom && (
          <div
            className="fixed inset-0 z-[70] bg-black bg-opacity-80 flex items-center justify-center p-4"
            onClick={() => setZoom(false)}
          >
            <img
              src={url}
              alt={attachment.name}
              className="max-w-full max-h-full object-contain"
              onClick={(e) => e.stopPropagation()}
            />
            <button
              type="button"
              aria-label="Close picture"
              onClick={() => setZoom(false)}
              className="absolute top-4 right-4 text-white text-3xl leading-none"
            >
              ×
            </button>
          </div>
        )}
      </>
    );
  }

  return (
    <button
      type="button"
      disabled={saving}
      onClick={async () => {
        setSaving(true);
        setFailed(false);
        try {
          await saveAttachment(conversationId, attachment);
        } catch {
          setFailed(true);
        } finally {
          setSaving(false);
        }
      }}
      className={`flex items-center gap-2 mb-1 mr-4 px-3 py-2 rounded-lg text-left w-full max-w-[260px] ${
        isOwn ? "bg-brand-hover/60 hover:bg-brand-hover" : "bg-surface-3 hover:bg-surface-4"
      }`}
    >
      <span className="text-xl" aria-hidden="true">📎</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium truncate">{attachment.name}</span>
        <span className="block text-xs opacity-70">
          {failed ? "Download failed. Tap to retry." : saving ? "Downloading..." : `${formatSize(attachment.size)} · Download`}
        </span>
      </span>
    </button>
  );
};

export default AttachmentView;
