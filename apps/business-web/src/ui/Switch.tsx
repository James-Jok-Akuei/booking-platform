/**
 * An on/off switch (§194) — for a setting that takes effect the moment it is
 * flipped, like a service being on sale at one branch. A checkbox underneath,
 * so the keyboard and screen readers treat it as one.
 */
export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** What flipping it does, read out and shown on hover. */
  label: string;
  disabled?: boolean;
}) {
  return (
    <label className={`switch${checked ? ' is-on' : ''}${disabled ? ' is-disabled' : ''}`} title={label}>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="switch-track" aria-hidden="true">
        <span className="switch-thumb" />
      </span>
    </label>
  );
}
