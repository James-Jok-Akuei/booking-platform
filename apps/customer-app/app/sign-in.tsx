import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { requestOtp, verifyOtp } from '../src/api/auth';
import { ApiError } from '../src/api/client';
import { theme } from '../src/theme';

/**
 * Two steps, one screen: ask for a code, then enter it. No password anywhere.
 *
 * No role is sent on the first attempt — role belongs to registration, and
 * sending it is what locked every administrator out once (§50). If the server
 * says the address has no account, that is a registration prompt, so it becomes
 * an offer rather than a dead end (§90.3).
 */
export default function SignIn() {
  const { next } = useLocalSearchParams<{ next?: string }>();
  const router = useRouter();

  const [step, setStep] = useState<'email' | 'register' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
      // Back where they were, which is usually a slot they are about to lose.
      if (next) router.replace(next as never);
      else router.replace('/');
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Sign in' }} />
      <View style={styles.screen}>
        {step === 'email' && (
          <>
            <Text style={styles.lead}>
              We will email you a six-digit code. There is no password.
            </Text>
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
            />
            <Button label="Send code" busy={busy} disabled={!email.trim()} onPress={() => ask()} />
          </>
        )}

        {step === 'register' && (
          <>
            <Text style={styles.lead}>
              There is no account for <Text style={styles.strong}>{email}</Text> yet.
            </Text>
            <Text style={styles.lead}>
              Creating one takes a code and nothing else — no password, no form.
            </Text>
            <Button label="Create an account" busy={busy} onPress={() => ask('CUSTOMER')} />
            <Pressable onPress={() => setStep('email')}>
              <Text style={styles.link}>Use a different email</Text>
            </Pressable>
          </>
        )}

        {step === 'code' && (
          <>
            <Text style={styles.lead}>
              Enter the code sent to <Text style={styles.strong}>{email}</Text>.
            </Text>
            <TextInput
              style={[styles.input, styles.code]}
              value={code}
              onChangeText={(text) => setCode(text.replace(/\D/g, '').slice(0, 6))}
              placeholder="000000"
              placeholderTextColor={theme.muted}
              keyboardType="number-pad"
              autoFocus
            />
            <Button
              label="Sign in"
              busy={busy}
              disabled={code.length !== 6}
              onPress={submitCode}
            />
            <Pressable onPress={() => setStep('email')}>
              <Text style={styles.link}>Start again</Text>
            </Pressable>
          </>
        )}

        {error && <Text style={styles.error}>{error}</Text>}
      </View>
    </>
  );
}

function Button({
  label,
  busy,
  disabled,
  onPress,
}: {
  label: string;
  busy: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.cta, (disabled || busy) && styles.ctaOff]}
      disabled={disabled || busy}
      onPress={onPress}
    >
      {busy ? (
        <ActivityIndicator color="#fff" />
      ) : (
        <Text style={styles.ctaText}>{label}</Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg, padding: 20, gap: 14 },
  lead: { color: theme.ink, lineHeight: 21 },
  strong: { fontWeight: '700' },
  input: {
    backgroundColor: theme.panel,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: theme.radius,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 16,
    color: theme.ink,
  },
  code: { fontSize: 26, letterSpacing: 8, textAlign: 'center' },
  cta: {
    backgroundColor: theme.accent,
    borderRadius: theme.radius,
    paddingVertical: 15,
    alignItems: 'center',
  },
  ctaOff: { backgroundColor: theme.line },
  ctaText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  link: { color: theme.accent, textAlign: 'center', paddingVertical: 8 },
  error: { color: theme.danger, lineHeight: 19 },
});
