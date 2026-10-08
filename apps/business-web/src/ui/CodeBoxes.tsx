import { useEffect, useRef } from 'react';

/**
 * Six boxes for a six-digit code (§191) — the same shape the customer sees the
 * code in, in their email and their app (§183), so what they read out and
 * what is typed look alike.
 *
 * Typing moves on a box; Backspace on an empty box goes back one; a pasted or
 * auto-filled code spreads across all six. When the last digit lands,
 * `onComplete` is called with the whole code, so checking someone in is six
 * keystrokes and nothing else.
 */
export function CodeBoxes({
  value,
  onChange,
  onComplete,
  invalid = false,
  shake = false,
  onShakeEnd,
  disabled = false,
  autoFocus = false,
  length = 6,
}: {
  value: string;
  onChange: (code: string) => void;
  onComplete?: (code: string) => void;
  invalid?: boolean;
  /** Plays the "that was wrong" shake once; `onShakeEnd` resets it. */
  shake?: boolean;
  onShakeEnd?: () => void;
  disabled?: boolean;
  autoFocus?: boolean;
  length?: number;
}) {
  const boxes = useRef<Array<HTMLInputElement | null>>([]);
  const digits = Array.from({ length }, (_, i) => value[i] ?? '');

  useEffect(() => {
    if (autoFocus) boxes.current[Math.min(value.length, length - 1)]?.focus();
    // Only on mount, and after a reset to empty.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus, value === '']);

  const set = (next: string) => {
    const clean = next.replace(/\D/g, '').slice(0, length);
    onChange(clean);
    if (clean.length === length) onComplete?.(clean);
    return clean;
  };

  const typeAt = (index: number, raw: string) => {
    const typed = raw.replace(/\D/g, '');
    if (!typed) return;
    // One digit typed, or a whole code pasted / auto-filled into this box.
    const before = value.slice(0, index);
    const next = set(before + typed);
    boxes.current[Math.min(next.length, length - 1)]?.focus();
  };

  const onKeyDown = (index: number) => (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace') {
      event.preventDefault();
      if (digits[index]) {
        set(value.slice(0, index) + value.slice(index + 1));
      } else if (index > 0) {
        set(value.slice(0, index - 1) + value.slice(index));
        boxes.current[index - 1]?.focus();
      }
    } else if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault();
      boxes.current[index - 1]?.focus();
    } else if (event.key === 'ArrowRight' && index < length - 1) {
      event.preventDefault();
      boxes.current[index + 1]?.focus();
    }
  };

  return (
    <div
      className={`codeboxes${invalid ? ' is-invalid' : ''}${shake ? ' is-shaking' : ''}`}
      onAnimationEnd={onShakeEnd}
      role="group"
      aria-label={`${length}-digit code`}
    >
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(el) => {
            boxes.current[index] = el;
          }}
          className={`codebox${digit ? ' is-filled' : ''}`}
          value={digit}
          inputMode="numeric"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          maxLength={length}
          disabled={disabled}
          aria-label={`Digit ${index + 1}`}
          onFocus={(event) => event.target.select()}
          onChange={(event) => typeAt(index, event.target.value)}
          onKeyDown={onKeyDown(index)}
          // Never start typing past the first empty box.
          onMouseDown={(event) => {
            if (index > value.length) {
              event.preventDefault();
              boxes.current[value.length]?.focus();
            }
          }}
        />
      ))}
    </div>
  );
}
