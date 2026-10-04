import { Platform, type TextStyle, type ViewStyle } from 'react-native';

/**
 * One place for colour, type, spacing and depth (§133).
 *
 * The first seven keys are the ones the app was built on, and they keep their
 * names — every screen reads `theme.ink` and `theme.accent`, so a change of
 * mind about either is still one edit rather than forty.
 *
 * What changed is the VALUES and what sits beside them. The app had one grey
 * border and one blue; it now has a warm paper background, a single confident
 * coral, soft tints for every state, and a real scale for space, corners and
 * shadow, so two screens built a month apart still look like one product.
 */
export const theme = {
  // ---- surfaces ----
  /** Warm paper, not grey: white cards need something to sit ON. */
  bg: '#F6F4F0',
  panel: '#FFFFFF',
  /** A card inside a card, an input, a quiet tile. */
  sunken: '#F3F1EC',
  /** The floating tab bar and the darkest buttons. */
  night: '#15171C',

  // ---- text ----
  ink: '#15171C',
  ink2: '#4B505B',
  muted: '#8B909B',
  line: '#ECE9E3',

  // ---- the one colour ----
  accent: '#F0532D',
  accentDeep: '#D7421E',
  accentSoft: '#FFEEE8',

  // ---- states, each with the tint it sits on ----
  ok: '#0E9F54',
  okSoft: '#E5F6EC',
  warn: '#C27803',
  warnSoft: '#FFF3DC',
  danger: '#D92D20',
  dangerSoft: '#FDECEA',
  star: '#FFB020',

  // ---- kept for the screens that still read them ----
  radius: 16,
  gap: 12,
} as const;

/** Corners. Cards are generous; chips and buttons are fully round. */
export const radius = { sm: 10, md: 16, lg: 22, xl: 28, pill: 999 } as const;

/** A 4-point scale. Anything not on it is a mistake waiting to be noticed. */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28, xxxl: 40 } as const;

/**
 * Plus Jakarta Sans, loaded in the root layout.
 *
 * A custom face on React Native is picked by FAMILY NAME per weight — setting
 * `fontWeight` beside it makes Android fake a bold on top of the real one. So
 * weight is never written in a style here; it is chosen by which of these is
 * used.
 */
export const font = {
  regular: 'PlusJakartaSans_400Regular',
  medium: 'PlusJakartaSans_500Medium',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
  extrabold: 'PlusJakartaSans_800ExtraBold',
} as const;

/** The type ramp. Seven sizes; a screen needing an eighth needs a rethink. */
export const type = {
  display: { fontFamily: font.extrabold, fontSize: 30, lineHeight: 36, color: theme.ink, letterSpacing: -0.6 },
  title: { fontFamily: font.extrabold, fontSize: 24, lineHeight: 30, color: theme.ink, letterSpacing: -0.4 },
  heading: { fontFamily: font.bold, fontSize: 18, lineHeight: 24, color: theme.ink, letterSpacing: -0.2 },
  subheading: { fontFamily: font.bold, fontSize: 15.5, lineHeight: 21, color: theme.ink },
  body: { fontFamily: font.medium, fontSize: 14.5, lineHeight: 21, color: theme.ink2 },
  small: { fontFamily: font.medium, fontSize: 13, lineHeight: 18, color: theme.muted },
  tiny: { fontFamily: font.semibold, fontSize: 11.5, lineHeight: 15, color: theme.muted },
  label: {
    fontFamily: font.bold,
    fontSize: 11.5,
    lineHeight: 15,
    color: theme.muted,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
} satisfies Record<string, TextStyle>;

/**
 * Depth. Three levels and no more.
 *
 * Android draws `elevation` and ignores the iOS shadow props, and iOS does the
 * reverse, so both are stated. The Android values are lower than they look
 * like they should be: elevation there is harsher than the same number
 * suggests.
 */
const shadowOf = (y: number, blur: number, opacity: number, elevation: number): ViewStyle =>
  Platform.select<ViewStyle>({
    android: { elevation },
    default: {
      shadowColor: '#1B1D22',
      shadowOffset: { width: 0, height: y },
      shadowRadius: blur,
      shadowOpacity: opacity,
    },
  }) as ViewStyle;

export const shadow = {
  /** A card at rest. */
  card: shadowOf(6, 16, 0.06, 2),
  /** Something lifted: a floating button, a sticky footer. */
  raised: shadowOf(10, 24, 0.1, 6),
  /** The tab bar and anything that floats over content. */
  float: shadowOf(14, 28, 0.2, 12),
} as const;

/**
 * Room to leave at the bottom of a tab screen so the last row clears the
 * floating bar. The bar's own height plus its gap from the edge.
 */
export const TAB_BAR_CLEARANCE = 104;
