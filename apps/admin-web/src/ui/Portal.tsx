import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

/**
 * Draws its children at the end of <body> (§204), for anything laid over the
 * whole screen — panels, drawers. The page area sizes itself by its own width
 * (a CSS container), and a container holds fixed-position layers inside it.
 */
export function Portal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body);
}
