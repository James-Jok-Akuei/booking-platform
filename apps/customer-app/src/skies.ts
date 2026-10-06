/**
 * Ten skies for the profile header, one a day (§154).
 *
 * The header was the same dark gradient forever. Now the day picks one of ten
 * — the same one for everybody that day, a new one at midnight on the phone's
 * clock — so the page is a little different each time someone comes back,
 * without a server, a setting, or a download. Day 11 is day 1 again.
 *
 * Each is three colours for the gradient and two for the soft lights over it,
 * named for something in Rwanda it is painted after. Every base is dark
 * enough for white text; that is the one rule a new sky must keep.
 */
export type Sky = {
  name: string;
  /** Three stops, top-left to bottom-right. */
  colors: [string, string, string];
  /** The two soft lights: top-right, then bottom-left. */
  glows: [string, string];
};

export const SKIES: Sky[] = [
  { name: 'Kigali at dusk', colors: ['#23252E', '#15171C', '#2E1A14'], glows: ['rgba(240,83,45,0.22)', 'rgba(255,176,32,0.10)'] },
  { name: 'Lake Kivu', colors: ['#0E2A3A', '#101C28', '#0B2F3C'], glows: ['rgba(0,161,222,0.28)', 'rgba(32,96,61,0.18)'] },
  { name: 'Volcanoes', colors: ['#1B2320', '#121715', '#2A1C16'], glows: ['rgba(32,96,61,0.32)', 'rgba(240,83,45,0.14)'] },
  { name: 'Nyungwe', colors: ['#10251C', '#0F1A16', '#1A2E1F'], glows: ['rgba(80,200,120,0.22)', 'rgba(250,210,1,0.10)'] },
  { name: 'Savannah', colors: ['#2E2012', '#1A1510', '#3A2410'], glows: ['rgba(255,176,32,0.26)', 'rgba(240,83,45,0.14)'] },
  { name: 'Coffee', colors: ['#2A1C16', '#171210', '#1F1A17'], glows: ['rgba(196,80,27,0.24)', 'rgba(255,214,170,0.10)'] },
  { name: 'Thousand hills', colors: ['#1A2430', '#131A22', '#1E2A24'], glows: ['rgba(120,160,255,0.22)', 'rgba(80,200,120,0.14)'] },
  { name: 'Imigongo', colors: ['#1E1B22', '#141317', '#2B1A1A'], glows: ['rgba(255,255,255,0.10)', 'rgba(240,83,45,0.20)'] },
  { name: 'Akagera', colors: ['#2A2618', '#17160F', '#1E2A1C'], glows: ['rgba(250,210,1,0.18)', 'rgba(80,200,120,0.16)'] },
  { name: 'Night market', colors: ['#1C1530', '#14111F', '#2E1428'], glows: ['rgba(170,110,255,0.24)', 'rgba(240,83,45,0.16)'] },
];

/** Days since 1 January 1970 on the phone's clock, so it rolls at local midnight. */
const dayNumber = (now = new Date()) =>
  Math.floor((now.getTime() - now.getTimezoneOffset() * 60_000) / 86_400_000);

export const skyForToday = (now = new Date()): Sky => SKIES[dayNumber(now) % SKIES.length];
