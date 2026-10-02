/**
 * A switch, not a checkbox.
 *
 * A checkbox reads as "tick this to apply later"; these take effect the moment
 * they move, so they are drawn as something already on or off. The underlying
 * control is still a real checkbox input — it keeps the keyboard behaviour and
 * the label association that a div with an onClick would have to reimplement
 * and usually gets wrong.
 */
export function Toggle({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  label: string;
}) {
  return (
    <label className={disabled ? 'toggle disabled' : 'toggle'}>
      <input
        type="checkbox"
        className="visually-hidden"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="toggle-track" aria-hidden="true">
        <span className="toggle-knob" />
      </span>
      <span className="toggle-label small">{label}</span>
    </label>
  );
}
