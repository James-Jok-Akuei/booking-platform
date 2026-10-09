import { useEffect, useState } from 'react';

/**
 * One word that keeps changing (§183, §238): "barbershop." rises away and
 * "salon." rises in after it, with a small overshoot, every couple of
 * seconds — the headline saying, without a list, how many kinds of business
 * take bookings here.
 *
 * Held on the first word when the browser asks for less motion.
 */
export function RotatingWord({ words, every = 2300, className = '' }: { words: string[]; every?: number; className?: string }) {
  const [index, setIndex] = useState(0);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (words.length < 2 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let swap: ReturnType<typeof setTimeout> | undefined;
    const timer = setInterval(() => {
      setLeaving(true);
      swap = setTimeout(() => {
        setIndex((i) => (i + 1) % words.length);
        setLeaving(false);
      }, 240);
    }, every);
    return () => {
      clearInterval(timer);
      clearTimeout(swap);
    };
  }, [words.length, every]);

  return (
    <span className={`au-word ${leaving ? 'is-leaving' : 'is-coming'} ${className}`} aria-hidden="true">
      {words[index]}
    </span>
  );
}
