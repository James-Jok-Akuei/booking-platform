import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as ImagePicker from 'expo-image-picker';
import {
  getThread,
  listMessages,
  markThreadRead,
  sendMessage,
  type Message,
} from '../../src/api/chat';
import { ApiError } from '../../src/api/client';
import { useThreadSocket } from '../../src/useThreadSocket';
import { theme } from '../../src/theme';

const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

type Picked = { uri: string; name: string; type: string };

/**
 * One conversation.
 *
 * Live over the socket (§22) and polled underneath it. The poll is not
 * redundant: a phone sleeps, changes network and loses signal, and a socket
 * that quietly died would otherwise leave the screen looking like nobody had
 * replied. The socket makes it instant; the poll makes it correct.
 */
export default function ThreadScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState('');
  const [photo, setPhoto] = useState<Picked | null>(null);
  const listRef = useRef<FlatList<Message>>(null);

  const thread = useQuery({ queryKey: ['thread', id], queryFn: () => getThread(id) });

  const messages = useQuery({
    queryKey: ['messages', id],
    queryFn: () => listMessages(id, { limit: 100 }),
    refetchInterval: 6000,
  });

  useThreadSocket(id);

  const count = messages.data?.messages.length ?? 0;

  /**
   * Marking read is tied to the messages ARRIVING, not to the screen opening:
   * opening an empty thread and marking it read would clear a badge for
   * messages that had not loaded yet.
   *
   * Only the reader's own state moves — read state is per person, not per
   * thread (§21.3) — so this cannot clear a colleague's badge on the other side.
   */
  useEffect(() => {
    if (count === 0) return;
    markThreadRead(id)
      .then(() => queryClient.invalidateQueries({ queryKey: ['threads'] }))
      .catch(() => undefined);
  }, [id, count, queryClient]);

  const send = useMutation({
    mutationFn: () =>
      sendMessage(id, {
        body: draft.trim() || undefined,
        ...(photo ? { photo } : {}),
      }),
    onSuccess: (message) => {
      setDraft('');
      setPhoto(null);
      // Appended rather than refetched, so the message a person just sent does
      // not wait for the next poll to appear.
      queryClient.setQueryData(['messages', id], (page: typeof messages.data) =>
        page && !page.messages.some((m) => m.id === message.id)
          ? { ...page, total: page.total + 1, messages: [...page.messages, message] }
          : page,
      );
      queryClient.invalidateQueries({ queryKey: ['threads'] });
    },
    onError: (error) =>
      Alert.alert(
        'Not sent',
        error instanceof ApiError ? error.message : 'Please try again.',
      ),
  });

  const attach = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        'Photos are not allowed',
        'Allow photo access in Settings to send a picture. You can still send text.',
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.8,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    setPhoto({
      uri: asset.uri,
      name: asset.fileName ?? 'photo.jpg',
      // The endpoint allows jpg, png and webp only, and refuses anything else
      // with a clear message — so the type is passed through rather than
      // guessed at here.
      type: asset.mimeType ?? 'image/jpeg',
    });
  };

  const rows = messages.data?.messages ?? [];
  const canSend = (draft.trim().length > 0 || photo !== null) && !send.isPending;

  return (
    <>
      <Stack.Screen
        options={{ title: thread.data?.business.name ?? 'Messages' }}
      />
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 92 : 0}
      >
        {thread.data?.appointment && (
          <View style={styles.context}>
            <Text style={styles.contextText}>
              About {thread.data.appointment.serviceName} on{' '}
              {new Date(thread.data.appointment.startTime).toLocaleDateString(undefined, {
                day: 'numeric',
                month: 'short',
              })}
            </Text>
          </View>
        )}

        {messages.isLoading && <ActivityIndicator style={styles.spinner} color={theme.accent} />}

        <FlatList
          ref={listRef}
          data={rows}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          ListEmptyComponent={
            messages.isLoading ? null : (
              <Text style={styles.empty}>
                Nothing here yet. Ask them anything — prices, parking, what to bring.
              </Text>
            )
          }
          renderItem={({ item }) => {
            const mine = item.sender.role === 'CUSTOMER';
            return (
              <View style={[styles.bubbleRow, mine && styles.bubbleRowMine]}>
                <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
                  {item.photoUrl && (
                    <Image source={{ uri: item.photoUrl }} style={styles.photo} />
                  )}
                  {item.body && (
                    <Text style={[styles.body, mine && styles.bodyMine]}>{item.body}</Text>
                  )}
                  <Text style={[styles.time, mine && styles.timeMine]}>
                    {clock(item.createdAt)}
                  </Text>
                </View>
              </View>
            );
          }}
        />

        {photo && (
          <View style={styles.attached}>
            <Image source={{ uri: photo.uri }} style={styles.thumb} />
            <Text style={styles.attachedText} numberOfLines={1}>
              {photo.name}
            </Text>
            <Pressable onPress={() => setPhoto(null)} hitSlop={10}>
              <Text style={styles.remove}>Remove</Text>
            </Pressable>
          </View>
        )}

        <View style={styles.composer}>
          <Pressable onPress={attach} hitSlop={8} style={styles.attach}>
            <Text style={styles.attachText}>＋</Text>
          </Pressable>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder="Write a message"
            placeholderTextColor={theme.muted}
            multiline
            maxLength={2000}
          />
          <Pressable
            style={[styles.send, !canSend && styles.sendOff]}
            disabled={!canSend}
            onPress={() => send.mutate()}
          >
            <Text style={styles.sendText}>{send.isPending ? '…' : 'Send'}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  spinner: { marginTop: 24 },
  context: {
    backgroundColor: theme.panel,
    borderBottomWidth: 1,
    borderBottomColor: theme.line,
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  contextText: { color: theme.muted, fontSize: 13 },
  list: { padding: 14, gap: 8 },
  bubbleRow: { flexDirection: 'row' },
  bubbleRowMine: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '82%', borderRadius: 14, padding: 11, gap: 4 },
  mine: { backgroundColor: theme.accent, borderBottomRightRadius: 4 },
  theirs: {
    backgroundColor: theme.panel,
    borderWidth: 1,
    borderColor: theme.line,
    borderBottomLeftRadius: 4,
  },
  body: { color: theme.ink, fontSize: 15, lineHeight: 21 },
  bodyMine: { color: '#fff' },
  time: { color: theme.muted, fontSize: 11, alignSelf: 'flex-end' },
  timeMine: { color: 'rgba(255,255,255,0.75)' },
  photo: { width: 210, height: 160, borderRadius: 9, backgroundColor: theme.line },
  empty: { color: theme.muted, textAlign: 'center', padding: 28, lineHeight: 20 },
  attached: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: theme.panel,
    borderTopWidth: 1,
    borderTopColor: theme.line,
  },
  thumb: { width: 36, height: 36, borderRadius: 6, backgroundColor: theme.line },
  attachedText: { flex: 1, color: theme.muted, fontSize: 13 },
  remove: { color: theme.danger, fontWeight: '600', fontSize: 13 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: theme.line,
    backgroundColor: theme.panel,
  },
  attach: { paddingHorizontal: 6, paddingVertical: 9 },
  attachText: { fontSize: 24, color: theme.accent, lineHeight: 26 },
  input: {
    flex: 1,
    backgroundColor: theme.bg,
    borderWidth: 1,
    borderColor: theme.line,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    maxHeight: 110,
    fontSize: 15,
    color: theme.ink,
  },
  send: {
    backgroundColor: theme.accent,
    borderRadius: 18,
    paddingHorizontal: 17,
    paddingVertical: 11,
  },
  sendOff: { backgroundColor: theme.line },
  sendText: { color: '#fff', fontWeight: '700' },
});
