import { useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { requestOtp, verifyOtp } from '../src/api/auth';
import { ApiError } from '../src/api/client';
import { font, radius, theme, type } from '../src/theme';
import { Button } from '../src/ui/Button';
import { FadeIn } from '../src/ui/FadeIn';
import { cheer } from '../src/ui/haptic';
import { Icon, type IconName } from '../src/ui/Icon';
import { IconButton } from '../src/ui/IconButton';
import { PressableScale } from '../src/ui/PressableScale';

/**
 * Two steps, one screen: ask for a code, then enter it. No password anywhere.
 *
 * No role is sent on the first attempt — role belongs to registration, and
 * sending it is what locked every administrator out once (§50). If the server
 * says the address has no account, that is a registration prompt, so it becomes
 * an offer rather than a dead end (§90.3).
 *
 * Each step is one question with one field and one button (§133), under a
 * picture that changes with the step, so it is obvious at a glance that the
 * screen has moved on. The code is typed into six boxes — which is one hidden
 * field underneath, so paste and the keyboard's own "from Messages" suggestion
 * still work.
 */
export default function SignIn() {
  const { next } = useLocalSearchParams<{ next?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const codeInput = useRef<TextInput>(null);

  const [step, setStep] = useState<'email' | 'register' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /**
   * Only the registration step asks. Somebody logging back in agreed when they
   * joined, and asking again at every sign-in would turn a meaningful tick into
   * a reflex (§126.2).
   */
  const [agreed, setAgreed] = useState(false);

  const ask = async (role?: 'CUSTOMER') => {
    setError(null);
    setBusy(true);
    try {
      await requestOtp(email.trim().toLowerCase(), role);
      setStep('code');
    } catch (caught) {
      if (caught instanceof ApiError && /no account yet/i.test(caught.message) && !role) {
        setStep('register');
      } else {
        setError(caught instanceof ApiError ? caught.message : 'Could not send a code.');
      }
    } finally {
      setBusy(false);
    }
  };

  const submitCode = async () => {
    setError(null);
    setBusy(true);
    try {
      const user = await verifyOtp(email.trim().toLowerCase(), code.trim());
      if (user.role !== 'CUSTOMER') {
        setError(
          `This app is for customers, and ${user.email} is a ${user.role.toLowerCase()} account.`,
        );
        return;
      }
      cheer();
      // Everything on screen was fetched as a stranger. The tabs stay mounted
      // now (§133.6), so they are asked again as this person — which is what
      // puts the hearts on the places already being looked at.
      queryClient.invalidateQueries();
      // Back where they were, which is usually a slot they are about to lose.
      // `dismissTo` rather than `replace` (§133.6): the screen they came from
      // is still there underneath this one, so this closes down to it instead
      // of stacking a second copy — and falls back to replacing when it is not.
      router.dismissTo((next ?? '/') as never);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  };

  const hero: Record<typeof step, IconName> = {
    email: 'mail-outline',
    register: 'person-add-outline',
    code: 'keypad-outline',
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={[styles.top, { paddingTop: insets.top + 10 }]}>
        <IconButton
          icon="close"
          label="Close"
          flat
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
        />
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 28 }]}
      >
        {/* Re-keyed on the step, so each one fades in as its own thing. */}
        <FadeIn key={step} style={styles.step}>
          <View style={styles.halo}>
            <View style={styles.disc}>
              <Icon name={hero[step]} size={30} color={theme.accent} />
            </View>
          </View>

          <Text style={[type.display, styles.centre]}>Sign in</Text>

          {step === 'email' && (
            <>
              <Text style={[type.body, styles.centre]}>
                We will email you a six-digit code. There is no password.
              </Text>
              <View style={styles.field}>
                <Icon name="mail-outline" size={19} color={theme.muted} />
                <TextInput
                  style={styles.input}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="you@example.com"
                  placeholderTextColor={theme.muted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  autoFocus
                  returnKeyType="send"
                  onSubmitEditing={() => email.trim() && ask()}
                />
              </View>
              <Button label="Send code" busy={busy} disabled={!email.trim()} onPress={() => ask()} />
            </>
          )}

          {step === 'register' && (
            <>
              <Text style={[type.body, styles.centre]}>
                There is no account for <Text style={styles.strong}>{email}</Text> yet.
              </Text>
              <Text style={[type.body, styles.centre]}>
                Creating one takes a code and nothing else — no password, no form.
              </Text>

              {/* An explicit tick, not "by continuing you agree" buried in grey
                  text (§126.2). The documents are readable from here BEFORE the
                  box can be ticked — being asked to agree to something you cannot
                  open is the thing that makes consent worthless. */}
              <Pressable
                style={styles.agreeRow}
                onPress={() => setAgreed((was) => !was)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: agreed }}
              >
                <View style={[styles.checkbox, agreed && styles.checkboxOn]}>
                  {agreed && <Icon name="checkmark" size={16} color="#FFFFFF" />}
                </View>
                <Text style={styles.agreeText}>
                  I have read and agree to the{' '}
                  <Text style={styles.link} onPress={() => router.push('/legal')}>
                    Terms of Use
                  </Text>{' '}
                  and{' '}
                  <Text style={styles.link} onPress={() => router.push('/legal')}>
                    Privacy Policy
                  </Text>
                  .
                </Text>
              </Pressable>

              <Button
                label="Create an account"
                busy={busy}
                disabled={!agreed}
                onPress={() => ask('CUSTOMER')}
              />
              <PressableScale onPress={() => setStep('email')} hitSlop={8}>
                <Text style={[styles.link, styles.centre]}>Use a different email</Text>
              </PressableScale>
            </>
          )}

          {step === 'code' && (
            <>
              <Text style={[type.body, styles.centre]}>
                Enter the code sent to <Text style={styles.strong}>{email}</Text>.
              </Text>

              {/* Six boxes drawn over ONE real field. The field is what takes
                  the typing, the paste and the keyboard's suggested code; the
                  boxes only show it. */}
              <Pressable style={styles.codeRow} onPress={() => codeInput.current?.focus()}>
                {[0, 1, 2, 3, 4, 5].map((index) => {
                  const filled = index < code.length;
                  const current = index === code.length;
                  return (
                    <View
                      key={index}
                      style={[
                        styles.codeBox,
                        filled && styles.codeBoxFilled,
                        current && styles.codeBoxCurrent,
                      ]}
                    >
                      <Text style={styles.codeDigit}>{code[index] ?? ''}</Text>
                    </View>
                  );
                })}
                <TextInput
                  ref={codeInput}
                  style={styles.codeHidden}
                  value={code}
                  onChangeText={(text) => setCode(text.replace(/\D/g, '').slice(0, 6))}
                  keyboardType="number-pad"
                  textContentType="oneTimeCode"
                  autoComplete="one-time-code"
                  maxLength={6}
                  autoFocus
                  caretHidden
                  accessibilityLabel="Six-digit code"
                />
              </Pressable>

              <Button
                label="Sign in"
                busy={busy}
                disabled={code.length !== 6}
                onPress={submitCode}
              />
              <PressableScale onPress={() => setStep('email')} hitSlop={8}>
                <Text style={[styles.link, styles.centre]}>Start again</Text>
              </PressableScale>
            </>
          )}

          {error && (
            <View style={styles.error}>
              <Icon name="alert-circle-outline" size={18} color={theme.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}
        </FadeIn>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  top: { paddingHorizontal: 16, alignItems: 'flex-start' },
  content: { paddingHorizontal: 24, paddingTop: 10 },
  step: { gap: 16, width: '100%', maxWidth: 440, alignSelf: 'center' },
  centre: { textAlign: 'center' },
  halo: {
    alignSelf: 'center',
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: theme.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  disc: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: theme.panel,
    alignItems: 'center',
    justifyContent: 'center',
  },
  strong: { fontFamily: font.bold, color: theme.ink },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 56,
    paddingHorizontal: 18,
    borderRadius: radius.pill,
    backgroundColor: theme.panel,
    borderWidth: 1.5,
    borderColor: theme.line,
  },
  input: {
    flex: 1,
    fontFamily: font.semibold,
    fontSize: 16,
    color: theme.ink,
    paddingVertical: 0,
  },
  codeRow: { flexDirection: 'row', justifyContent: 'center', gap: 8 },
  codeBox: {
    flex: 1,
    maxWidth: 54,
    height: 62,
    borderRadius: radius.md,
    backgroundColor: theme.panel,
    borderWidth: 1.5,
    borderColor: theme.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeBoxFilled: { borderColor: theme.ink },
  codeBoxCurrent: { borderColor: theme.accent, backgroundColor: theme.accentSoft },
  codeDigit: { fontFamily: font.extrabold, fontSize: 24, color: theme.ink },
  // Covers the boxes and is invisible: it must still be ON SCREEN and full
  // size, or iOS will not offer the code from Messages and a tap on a box
  // would not open the keyboard.
  codeHidden: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0.02,
    color: 'transparent',
  },
  agreeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: theme.panel,
    borderRadius: radius.lg,
    padding: 14,
  },
  checkbox: {
    width: 26,
    height: 26,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: theme.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: theme.accent, borderColor: theme.accent },
  agreeText: { flex: 1, fontFamily: font.medium, color: theme.ink2, fontSize: 14, lineHeight: 21 },
  link: { fontFamily: font.bold, color: theme.accent, fontSize: 14 },
  error: {
    flexDirection: 'row',
    gap: 9,
    backgroundColor: theme.dangerSoft,
    borderRadius: radius.md,
    padding: 13,
  },
  errorText: { flex: 1, fontFamily: font.semibold, color: theme.danger, fontSize: 13.5, lineHeight: 19 },
});
