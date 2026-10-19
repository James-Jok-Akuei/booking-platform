import type { Plugin } from 'vite';

/** Browser protections for the web apps (§298) — see web-security.mjs. */
export function contentSecurityPolicy(options?: { apiUrl?: string; selfHostedFonts?: boolean; frames?: string[] }): string;
export function webSecurity(options?: {
  apiUrl?: string;
  selfHostedFonts?: boolean;
  frames?: string[];
  extraFiles?: Record<string, string>;
}): Plugin;
export function securityTxt(options: { contact: string; siteUrl?: string; policyUrl?: string }): string;
