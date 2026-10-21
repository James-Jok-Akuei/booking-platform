import { useEffect, useRef } from 'react';

import { t } from '@lingui/core/macro';

/** Where a code stands (§238): being typed, being checked, wrong, or right. */
export type CodeState = 'idle' | 'busy' | 'error' | 'ok';

/**
 * The code in whatever was pasted (§283). Copied from the email's six boxes it
 * arrives as "1 2 3 4 5 6" — digits with gaps — and from the subject as
 * "Your sign-in code: 123456". A run of exactly `length` digits wins, so other
 * numbers around it are left out; otherwise every digit is taken, in order.
 * Fewer digits than boxes fill as many boxes as there are digits.
 */
export function codeFrom(text: string, length: number): string {
  const run = text.match(new RegExp(`(?<!\\d)\\d{${length}}(?!\\d)`));
  return run ? run[0] : text.replace(/\D/g, '').slice(0, length);
}

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
  state = 'idle',
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
  /** The row answers back (§238): it breathes while checked, turns green when right. */
  state?: CodeState;
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
    const typed = codeFrom(raw, length);
    if (!typed) return;
    // A whole code — pasted, or auto-filled by the phone — replaces what is
    // there; one digit typed (or a few pasted) goes in from this box on.
    const next = set(typed.length >= length ? typed : value.slice(0, index) + typed);
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
      className={`codeboxes${invalid || state === 'error' ? ' is-invalid' : ''}${shake ? ' is-shaking' : ''}${
        state === 'busy' ? ' is-busy' : ''
      }${state === 'ok' ? ' is-ok' : ''}`}
      // Only the row's own shake: a digit's pop ending inside it bubbles here too.
      onAnimationEnd={(event) => event.target === event.currentTarget && onShakeEnd?.()}
      role="group"
      aria-label={t`${length}-digit code`}
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
          // No maxLength: the browser cut a pasted "1 2 3 4 5 6" to its first
          // six characters — three digits — before the code ever saw it (§283).
          disabled={disabled}
          aria-label={t`Digit ${index + 1}`}
          onFocus={(event) => event.target.select()}
          onChange={(event) => typeAt(index, event.target.value)}
          // A paste is read from the clipboard itself, all of it (§283).
          onPaste={(event) => {
            event.preventDefault();
            typeAt(index, event.clipboardData.getData('text'));
          }}
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
