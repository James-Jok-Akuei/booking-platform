import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  Easing,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { requestOtp, signOut, verifyOtp } from '../src/api/auth';
import { ApiError } from '../src/api/client';
import { AuthWall } from '../src/auth/AuthWall';
import { CodeBoxes, type CodeState } from '../src/auth/CodeBoxes';
import { looksLikeEmail, suggestEmail } from '../src/auth/email';
import { RotatingWord } from '../src/auth/RotatingWord';
import { bookWords } from '../src/auth/bookWords';
import { listCategories } from '../src/api/discovery';
import { font, radius, theme } from '../src/theme';
import { useKeyboardScroll } from '../src/useKeyboardScroll';
import { Button } from '../src/ui/Button';
import { FadeIn } from '../src/ui/FadeIn';
import { cheer, tick } from '../src/ui/haptic';
import { Icon, type IconName } from '../src/ui/Icon';
import { MomoLogo } from '../src/ui/Momo';
import { PopIn } from '../src/ui/Motion';
import { Pill } from '../src/ui/Pill';
import { PressableScale } from '../src/ui/PressableScale';
import { RwandaFlag } from '../src/ui/RwandaFlag';
import { Trans } from '@lingui/react/macro';
import { t } from '@lingui/core/macro';

/** What the headline says can be booked, one after another. */
/** The server's own wait between codes (`OTP_RESEND_COOLDOWN_SECONDS`). */
const RESEND_SECONDS = 60;
/** How long a code works (`OTP_EXPIRES_IN_MINUTES`). */
const CODE_MINUTES = 10;
/** The gold of the changing word: warm against the night, apart from the coral. */
const GOLD = '#FFC857';

type Step = 'email' | 'register' | 'code' | 'done';

/** The server's sentences, said the way a person would. */
function friendly(caught: unknown, fallback: string): string {
  if (!(caught instanceof ApiError)) return fallback;
  const m = caught.message;
  if (/invalid or expired/i.test(m)) return t`That code is not right, or it has run out. Check it and try again.`;
  if (/too many incorrect/i.test(m)) return t`Too many wrong tries. Ask for a new code below.`;
  if (/too many verification code requests/i.test(m))
    return t`That is a lot of codes for one hour. Please try again a little later.`;
  return m;
}

/**
 * Signing in, and signing up, as one short conversation (§183).
 *
 * The rule underneath is unchanged (§50, §90.3, §126.2): ONE email box for
 * everybody. The server is asked for a code; an address with an account gets
 * one at once, and an address without one is somebody new — they are welcomed,
 * shown what an account is for, tick the Terms once, and the same code then
 * creates their account. No password anywhere.
 *
 * What changed is how it looks. A wall of real shops' photos drifts behind a
 * coral-to-night shade, under "Book your next haircut." — the last word
 * changing every couple of seconds. A white sheet over it asks one question at
 * a time. When the keyboard opens the wall folds away to a strip, so the
 * question and its button always fit.
 */
export default function SignIn() {
  const { next } = useLocalSearchParams<{ next?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const window = useWindowDimensions();
  const queryClient = useQueryClient();
  // Every kind of place that is switched on in the admin console (§284).
  const categories = useQuery({ queryKey: ['categories'], queryFn: listCategories, staleTime: 10 * 60_000 });
  const words = useMemo(() => bookWords(categories.data), [categories.data]);
  // "Book your next {word}" as ONE sentence for translators (§308), so a
  // language may put the changing word wherever its grammar wants it; it is
  // cut at the word to draw the word in gold.
  const headline = useMemo(() => {
    const word = '\u2063';
    const sentence = t({
      message: `Book your next ${word}`,
      comment: '{word} changes every two seconds: “haircut.”, “car wash.”, “yoga class.” — each one ends with its own full stop.',
    });
    const at = sentence.indexOf(word);
    return at === -1
      ? { lead: sentence.trim(), tail: '' }
      : { lead: sentence.slice(0, at).trim(), tail: sentence.slice(at + word.length).trim() };
  }, []);
  // A small phone gets a smaller headline, so long words still fit above the sheet.
  const narrow = window.width < 360;
  // Keeps the field being typed into above the keyboard (§168).
  const keys = useKeyboardScroll();

  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [emailFocused, setEmailFocused] = useState(false);
  const [isNew, setIsNew] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [code, setCode] = useState('');
  const [codeState, setCodeState] = useState<CodeState>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);

  const clean = email.trim().toLowerCase();
  const valid = looksLikeEmail(clean);
  const suggestion = suggestEmail(clean);

  // Timers that outlive a tap — the pause before closing — are cleared if the
  // screen goes first, so nothing navigates from a screen that has gone.
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const later = (fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms));
  };

  // ---- the keyboard: the wall folds away ----
  const [keyboardUp, setKeyboardUp] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => setKeyboardUp(true),
    );
    const hide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKeyboardUp(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  const fold = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fold, {
      toValue: keyboardUp ? 1 : 0,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [keyboardUp, fold]);

  // Tall enough for the headline in any language (§308): measured, it grows
  // the wall rather than running under the "Made for Rwanda" chip.
  const [headlineHeight, setHeadlineHeight] = useState(0);
  const HERO = Math.round(
    Math.max(250, Math.min(400, window.height * 0.42), headlineHeight ? headlineHeight + 54 + insets.top + 64 : 0),
  );
  const STRIP = insets.top + 62;
  const heroHeight = fold.interpolate({ inputRange: [0, 1], outputRange: [HERO, STRIP] });
  const headlineFade = fold.interpolate({ inputRange: [0, 0.4], outputRange: [1, 0], extrapolate: 'clamp' });
  // The words line up with the sheet's column, on a phone and on a tablet.
  const column = Math.min(window.width - 48, 440);

  // ---- "send a new code" waits as long as the server does ----
  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  /** Asks for a code. `role` only when somebody new has asked to join (§50). */
  const send = async (role?: 'CUSTOMER') => {
    if (busy) return;
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      await requestOtp(clean, role);
      setIsNew(Boolean(role));
      setCode('');
      setCodeState('idle');
      setResendIn(RESEND_SECONDS);
      setStep('code');
    } catch (caught) {
      // The check the user asked for: an email with no account is not a
      // mistake, it is somebody new (§90.3).
      if (caught instanceof ApiError && /no account yet/i.test(caught.message) && !role) {
        setIsNew(true);
        setStep('register');
        return;
      }
      // A code went out less than a minute ago and still works — so the
      // answer is "use that one", not an error.
      const wait = caught instanceof ApiError ? /wait (\d+)s/i.exec(caught.message) : null;
      if (wait) {
        setIsNew(Boolean(role));
        setCode('');
        setCodeState('idle');
        setResendIn(Number(wait[1]));
        setInfo(t`We sent you a code a moment ago. Enter that one.`);
        setStep('code');
        return;
      }
      setError(friendly(caught, t`Could not send a code. Check your connection and try again.`));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (entered: string) => {
    setError(null);
    setInfo(null);
    setCodeState('busy');
    try {
      const user = await verifyOtp(clean, entered);
      if (user.role !== 'CUSTOMER') {
        // Signed straight back out: leaving a shop's tokens on the phone
        // signed this app in as the shop, under an error saying it had not.
        await signOut();
        setCodeState('error');
        const email = user.email;
        setError(
          user.role === 'BUSINESS'
            ? t`${email} is a business account. This app is for customers — sign in with a different email.`
            : t`${email} is an admin account. This app is for customers — sign in with a different email.`,
        );
        later(() => {
          setCode('');
          setCodeState('idle');
        }, 700);
        return;
      }
      setCodeState('ok');
      cheer();
      // Everything on screen was fetched as a stranger (§133.6).
      queryClient.invalidateQueries();
      later(() => setStep('done'), 450);
      // Back where they were, which is usually a slot they are about to lose.
      later(() => router.dismissTo((next ?? '/') as never), 1750);
    } catch (caught) {
      setCodeState('error');
      setError(friendly(caught, t`That code did not work. Please try again.`));
      later(() => {
        setCode('');
        setCodeState('idle');
      }, 700);
    }
  };

  const typed = (value: string) => {
    setCode(value);
    if (error) setError(null);
    if (value.length === 6 && codeState === 'idle') void verify(value);
  };

  // Said under the thing it is about — the field, the tick, the boxes — not at
  // the foot of the sheet, where the keyboard covers it.
  const problem = error ? (
    <FadeIn key={error} style={styles.error}>
      <Icon name="alert-circle" size={18} color={theme.danger} />
      <Text style={styles.errorText}>{error}</Text>
    </FadeIn>
  ) : null;

  const startAgain = () => {
    tick();
    setStep('email');
    setAgreed(false);
    setCode('');
    setCodeState('idle');
    setError(null);
    setInfo(null);
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      // Padding on BOTH platforms (§166): edge-to-edge Android no longer
      // shrinks the window for the keyboard on its own.
      behavior="padding"
    >
      <StatusBar style="light" />

      {/* THE WALL. */}
      <Animated.View style={[styles.hero, { height: heroHeight }]}>
        <AuthWall width={window.width} height={HERO} />

        <View style={[styles.heroTop, { paddingTop: insets.top + 10 }]}>
          <View style={styles.glassPill}>
            <RwandaFlag width={18} />
            <Text style={styles.glassText} numberOfLines={1}><Trans>Made for Rwanda</Trans></Text>
          </View>
          <PressableScale
            onPress={close}
            hitSlop={10}
            scaleTo={0.9}
            accessibilityRole="button"
            accessibilityLabel={t`Close`}
            style={styles.glassClose}
          >
            <Icon name="close" size={20} color="#FFFFFF" />
          </PressableScale>
        </View>

        <Animated.View
          style={[styles.headline, { width: column, opacity: headlineFade }]}
          onLayout={(event) => setHeadlineHeight(Math.round(event.nativeEvent.layout.height))}
          accessible
          accessibilityLabel={t`Book your next appointment at real shops near you, in a few taps.`}
        >
          {headline.lead ? <Text style={[styles.h1, narrow && styles.h1Narrow]}>{headline.lead}</Text> : null}
          <RotatingWord words={words} style={[styles.h1Gold, narrow && styles.h1GoldNarrow]} />
          {headline.tail ? <Text style={[styles.h1, narrow && styles.h1Narrow]}>{headline.tail}</Text> : null}
          <Text style={styles.h1Sub}><Trans>Real shops near you, booked in a few taps.</Trans></Text>
        </Animated.View>
      </Animated.View>

      {/* THE SHEET: one question at a time. */}
      <View style={styles.sheet}>
        <ScrollView
          ref={keys.ref}
          onScroll={keys.track}
          scrollEventThrottle={16}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[styles.sheetBody, { paddingBottom: insets.bottom + 28 }]}
        >
          <FadeIn key={step} style={[styles.step, { width: column }]}>
            {step === 'email' && (
              <>
                <Text style={styles.title}>
                  <Trans>
                    One email.{'\n'}
                    <Text style={styles.hot}>No password.</Text>
                  </Trans>
                </Text>
                <Text style={styles.lead}>
                  <Trans>
                    Type your email and we will send you a 6-digit code. New here? The same code
                    creates your account.
                  </Trans>
                </Text>

                <View style={[styles.field, emailFocused && styles.fieldOn]}>
                  <View style={[styles.fieldIcon, emailFocused && styles.fieldIconOn]}>
                    <Icon name="mail" size={18} color={emailFocused ? '#FFFFFF' : theme.ink2} />
                  </View>
                  <TextInput
                    style={styles.input}
                    value={email}
                    onChangeText={(text) => {
                      setEmail(text);
                      if (error) setError(null);
                    }}
                    onFocus={() => {
                      setEmailFocused(true);
                      keys.reveal();
                    }}
                    onBlur={() => setEmailFocused(false)}
                    placeholder={t`you@example.com`}
                    placeholderTextColor={theme.muted}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="email"
                    textContentType="emailAddress"
                    keyboardType="email-address"
                    returnKeyType="go"
                    onSubmitEditing={() => valid && send()}
                    accessibilityLabel={t`Email address`}
                  />
                  {valid && (
                    <PopIn>
                      <Icon name="checkmark-circle" size={22} color={theme.ok} />
                    </PopIn>
                  )}
                </View>

                {/* "Did you mean …@gmail.com?" — offered, never applied. */}
                {suggestion && (
                  <FadeIn>
                    <PressableScale
                      onPress={() => {
                        tick();
                        setEmail(suggestion);
                      }}
                      accessibilityRole="button"
                      style={styles.suggest}
                    >
                      <Icon name="bulb" size={16} color={theme.warn} />
                      <Text style={styles.suggestText}>
                        <Trans>Did you mean <Text style={styles.strong}>{suggestion}</Text>?</Trans>
                      </Text>
                      <Text style={styles.suggestFix}><Trans>Fix</Trans></Text>
                    </PressableScale>
                  </FadeIn>
                )}

                {problem}
                <Button label={t`Continue`} busy={busy} disabled={!valid} onPress={() => send()} />

                <View style={styles.footnote}>
                  <Icon name="lock-closed" size={13} color={theme.muted} />
                  <Text style={styles.footnoteText}><Trans>No password to remember. A fresh code every time.</Trans></Text>
                </View>
              </>
            )}

            {step === 'register' && (
              <>
                <Pill label={t`New here`} tone="accent" icon="sparkles" />
                <Text style={styles.title}><Trans>Nice to <Text style={styles.hot}>meet you.</Text></Trans>
                </Text>
                <Text style={styles.lead}>
                  <Trans>
                    There is no account for <Text style={styles.strong}>{clean}</Text> yet. Let us make
                    one — it takes one code, and nothing else.
                  </Trans>
                </Text>

                <View style={styles.perks}>
                  <Perk
                    icon="calendar"
                    color={theme.accent}
                    tint={theme.accentSoft}
                    title={t`Book in seconds`}
                    text={t`Pick a time and hold it with a small deposit.`}
                  />
                  <Perk
                    mark={<MomoLogo size={40} />}
                    title={t`Pay with MTN MoMo`}
                    text={t`Approve the deposit on your own phone.`}
                  />
                  <Perk
                    icon="heart"
                    color={theme.ask}
                    tint={theme.askSoft}
                    title={t`Keep what you love`}
                    text={t`Save places and services for later.`}
                  />
                </View>

                {/* An explicit tick, not "by continuing you agree" (§126.2).
                    The documents open from here BEFORE the box is ticked. */}
                <Pressable
                  onPress={() => {
                    tick();
                    setAgreed((was) => !was);
                  }}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: agreed }}
                  style={[styles.agree, agreed && styles.agreeOn]}
                >
                  <View style={[styles.checkbox, agreed && styles.checkboxOn]}>
                    {agreed && (
                      <PopIn>
                        <Icon name="checkmark" size={16} color="#FFFFFF" />
                      </PopIn>
                    )}
                  </View>
                  {/* One sentence for translators, the two documents inside it (§308). */}
                  <Text style={styles.agreeText}>
                    <Trans>
                      I have read and agree to the{' '}
                      <Text style={styles.link} onPress={() => router.push('/legal')}>
                        Terms of Use
                      </Text>{' '}
                      and the{' '}
                      <Text style={styles.link} onPress={() => router.push('/legal')}>
                        Privacy Policy
                      </Text>
                      .
                    </Trans>
                  </Text>
                </Pressable>

                {problem}
                <Button
                  label={t`Create my account`}
                  busy={busy}
                  disabled={!agreed}
                  onPress={() => send('CUSTOMER')}
                />
                <PressableScale onPress={startAgain} hitSlop={8} accessibilityRole="button">
                  <Text style={styles.linkCentre}><Trans>Use a different email</Trans></Text>
                </PressableScale>
              </>
            )}

            {step === 'code' && (
              <>
                <Pill
                  label={isNew ? t`Creating your account` : t`Welcome back`}
                  tone={isNew ? 'accent' : 'ok'}
                  icon={isNew ? 'sparkles' : undefined}
                  dot={!isNew}
                />
                <Text style={styles.title}><Trans>Check your <Text style={styles.hot}>inbox.</Text></Trans>
                </Text>
                <Text style={styles.lead}><Trans>Enter the 6-digit code we sent to</Trans></Text>
                <PressableScale
                  onPress={startAgain}
                  accessibilityRole="button"
                  accessibilityLabel={t`${clean}. Change email`}
                  style={styles.emailChip}
                >
                  <Icon name="mail" size={15} color={theme.accent} />
                  <Text style={styles.emailChipText} numberOfLines={1}>
                    {clean}
                  </Text>
                  <Text style={styles.emailChipEdit}><Trans>Change</Trans></Text>
                </PressableScale>

                <CodeBoxes
                  value={code}
                  onChange={typed}
                  state={codeState}
                  compact={window.width < 360}
                  onFocus={keys.reveal}
                />

                {problem}
                {info && (
                  <View style={styles.info}>
                    <Icon name="information-circle" size={18} color={theme.ask} />
                    <Text style={styles.infoText}>{info}</Text>
                  </View>
                )}

                <Button
                  label={codeState === 'ok' ? t`Signed in` : t`Verify`}
                  busy={codeState === 'busy'}
                  disabled={code.length !== 6 || codeState === 'ok'}
                  onPress={() => verify(code)}
                />

                <View style={styles.resend}>
                  <Text style={styles.resendText}><Trans>Didn't get it?</Trans></Text>
                  {resendIn > 0 ? (
                    <Text style={styles.resendWait}><Trans>Send a new one in 0:{String(resendIn).padStart(2, '0')}</Trans>
                    </Text>
                  ) : (
                    <PressableScale
                      onPress={() => send(isNew ? 'CUSTOMER' : undefined)}
                      hitSlop={8}
                      accessibilityRole="button"
                    >
                      <Text style={styles.link}>{busy ? t`Sending…` : t`Send a new code`}</Text>
                    </PressableScale>
                  )}
                </View>
                <Text style={styles.small}>
                  <Trans>Look in your spam folder too. Each code works for {CODE_MINUTES} minutes.</Trans>
                </Text>
              </>
            )}

            {step === 'done' && (
              <View style={styles.done}>
                <PopIn>
                  <View style={styles.doneRing}>
                    <View style={styles.doneDisc}>
                      <Icon name="checkmark" size={46} color="#FFFFFF" />
                    </View>
                  </View>
                </PopIn>
                <Text style={[styles.title, styles.centre]}>
                  {isNew ? (
                    <><Trans>Welcome <Text style={styles.hot}>aboard!</Text></Trans>
                    </>
                  ) : (
                    <><Trans>You are <Text style={styles.hot}>in!</Text></Trans>
                    </>
                  )}
                </Text>
                <Text style={[styles.lead, styles.centre]}>
                  {isNew ? t`Your account is ready. Let us find you something good.` : t`Good to see you again.`}
                </Text>
              </View>
            )}

          </FadeIn>
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

/** One reason to have an account: a mark in its own colour, and a line about it. */
function Perk({
  mark,
  icon,
  color,
  tint,
  title,
  text,
}: {
  mark?: ReactNode;
  icon?: IconName;
  color?: string;
  tint?: string;
  title: string;
  text: string;
}) {
  return (
    <View style={styles.perk}>
      {mark ?? (
        <View style={[styles.perkMark, { backgroundColor: tint }]}>
          <Icon name={icon!} size={19} color={color} />
        </View>
      )}
      <View style={styles.flex}>
        <Text style={styles.perkTitle}>{title}</Text>
        <Text style={styles.perkText}>{text}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.night },
  flex: { flex: 1 },
  centre: { textAlign: 'center' },

  // ---- the wall ----
  hero: { overflow: 'hidden', backgroundColor: theme.night },
  heroTop: {
    position: 'absolute',
    top: 0,
    left: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  // Gives way to the close button when its words are long (§308).
  glassPill: {
    flexShrink: 1,
    marginRight: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 34,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  glassText: { flexShrink: 1, fontFamily: font.bold, fontSize: 12.5, color: '#FFFFFF' },
  glassClose: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  headline: { position: 'absolute', bottom: 54, alignSelf: 'center' },
  h1: { fontFamily: font.extrabold, fontSize: 30, lineHeight: 36, color: '#FFFFFF', letterSpacing: -0.6 },
  h1Gold: { fontFamily: font.extrabold, fontSize: 36, lineHeight: 42, color: GOLD, letterSpacing: -0.8 },
  h1Narrow: { fontSize: 25, lineHeight: 30 },
  h1GoldNarrow: { fontSize: 29, lineHeight: 35 },
  h1Sub: { fontFamily: font.semibold, fontSize: 14.5, lineHeight: 20, color: 'rgba(255,255,255,0.82)', marginTop: 8 },

  // ---- the sheet ----
  sheet: {
    flex: 1,
    marginTop: -28,
    backgroundColor: theme.panel,
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    overflow: 'hidden',
  },
  sheetBody: { paddingTop: 28, paddingHorizontal: 24, alignItems: 'center' },
  step: { gap: 16, maxWidth: 440 },
  title: { fontFamily: font.extrabold, fontSize: 28, lineHeight: 34, color: theme.ink, letterSpacing: -0.6 },
  hot: { color: theme.accent },
  lead: { fontFamily: font.medium, fontSize: 15, lineHeight: 22, color: theme.ink2 },
  strong: { fontFamily: font.bold, color: theme.ink },
  small: { fontFamily: font.medium, fontSize: 12.5, lineHeight: 18, color: theme.muted, textAlign: 'center' },

  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    height: 62,
    paddingLeft: 8,
    paddingRight: 16,
    borderRadius: 20,
    backgroundColor: theme.sunken,
    borderWidth: 2,
    borderColor: 'transparent',
  },
  fieldOn: { backgroundColor: theme.panel, borderColor: theme.accent },
  fieldIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: theme.panel,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fieldIconOn: { backgroundColor: theme.accent },
  // No outline of its own: the whole field lights up instead (the web draws
  // one by default; a phone does not).
  input: {
    flex: 1,
    fontFamily: font.semibold,
    fontSize: 16,
    color: theme.ink,
    paddingVertical: 0,
    outlineWidth: 0,
  },
  suggest: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: theme.warnSoft,
    borderRadius: radius.md,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  suggestText: { flex: 1, fontFamily: font.medium, fontSize: 13.5, color: theme.ink2 },
  suggestFix: { fontFamily: font.extrabold, fontSize: 13.5, color: theme.warn },
  footnote: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  footnoteText: { fontFamily: font.medium, fontSize: 12.5, color: theme.muted },

  perks: {
    gap: 14,
    backgroundColor: theme.bg,
    borderRadius: radius.lg,
    padding: 16,
  },
  perk: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  perkMark: {
    width: 40,
    height: 40,
    borderRadius: 10.4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  perkTitle: { fontFamily: font.bold, fontSize: 15, color: theme.ink },
  perkText: { fontFamily: font.medium, fontSize: 13, lineHeight: 18, color: theme.ink2, marginTop: 1 },
  agree: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderRadius: radius.lg,
    padding: 14,
    borderWidth: 1.5,
    borderColor: theme.line,
  },
  agreeOn: { borderColor: theme.accent, backgroundColor: theme.accentSoft },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: theme.line,
    backgroundColor: theme.panel,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  agreeText: { flex: 1, fontFamily: font.medium, fontSize: 14, lineHeight: 21, color: theme.ink2 },
  link: { fontFamily: font.bold, fontSize: 14, color: theme.accent },
  linkCentre: { fontFamily: font.bold, fontSize: 14, color: theme.accent, textAlign: 'center' },

  emailChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 8,
    maxWidth: '100%',
    height: 38,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: theme.accentSoft,
    marginTop: -6,
  },
  emailChipText: { flexShrink: 1, fontFamily: font.bold, fontSize: 14, color: theme.ink },
  emailChipEdit: { fontFamily: font.extrabold, fontSize: 13, color: theme.accent },
  info: {
    flexDirection: 'row',
    gap: 9,
    alignItems: 'center',
    backgroundColor: theme.askSoft,
    borderRadius: radius.md,
    padding: 12,
  },
  infoText: { flex: 1, fontFamily: font.semibold, fontSize: 13.5, lineHeight: 19, color: theme.ask },
  resend: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6 },
  resendText: { fontFamily: font.medium, fontSize: 14, color: theme.ink2 },
  resendWait: {
    fontFamily: font.bold,
    fontSize: 14,
    color: theme.muted,
    fontVariant: ['tabular-nums'],
  },

  done: { alignItems: 'center', gap: 14, paddingTop: 8 },
  doneRing: {
    width: 124,
    height: 124,
    borderRadius: 62,
    backgroundColor: theme.okSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneDisc: {
    width: 86,
    height: 86,
    borderRadius: 43,
    backgroundColor: theme.ok,
    alignItems: 'center',
    justifyContent: 'center',
  },

  error: {
    flexDirection: 'row',
    gap: 9,
    backgroundColor: theme.dangerSoft,
    borderRadius: radius.md,
    padding: 13,
  },
  errorText: { flex: 1, fontFamily: font.semibold, color: theme.danger, fontSize: 13.5, lineHeight: 19 },
});
