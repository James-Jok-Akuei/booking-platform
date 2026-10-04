/**
 * The file picker, as a button (§132.3).
 *
 * Lived inside ProfilePage until service photos needed the same control. A
 * second copy would have been a second `accept` list to keep in step with the
 * server's allow-list — and the one that drifts is always the copy nobody
 * remembered.
 *
 * A hidden input with a styled label, rather than a button that clicks the
 * input: the label IS the control, so it is reachable by keyboard and reads
 * correctly to a screen reader without any extra wiring.
 */
export function ImageButton({
  id,
  label,
  busy,
  onPick,
}: {
  id: string;
  label: string;
  busy: boolean;
  onPick: (file: File | null) => void;
}) {
  return (
    <>
      <input
        id={id}
        type="file"
        className="visually-hidden"
        // Mirrors ALLOWED_MIME_TYPES on the server. Widening one without the
        // other turns a greyed-out file into a failed upload, or the reverse.
        accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
        disabled={busy}
        onChange={(event) => {
          onPick(event.target.files?.[0] ?? null);
          // Cleared so picking the SAME file twice still fires a change.
          event.target.value = '';
        }}
      />
      <label htmlFor={id} className={busy ? 'file-trigger disabled' : 'file-trigger'}>
        {busy ? 'Uploading…' : label}
      </label>
    </>
  );
}
