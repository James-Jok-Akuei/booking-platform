import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PushDeviceKind } from '@prisma/client';
import { Expo, type ExpoPushMessage, type ExpoPushTicket } from 'expo-server-sdk';
import * as webpush from 'web-push';
import { PrismaService } from '../prisma/prisma.service';

/** What a push says, wherever it lands. */
export interface PushMessage {
  title: string;
  body: string;
  /** Where tapping it opens, inside the app it arrives in. */
  link: string | null;
  notificationId: string;
  /** The app's red number, when known. */
  badge?: number;
}

export interface PushResult {
  /** Devices this person has that can take a push. */
  devices: number;
  sent: number;
  /** Expo's tickets, checked later for devices that have gone (§287). */
  tickets: Array<{ deviceId: string; ticketId: string }>;
  errors: string[];
}

/**
 * Push notifications (§287): the customer app's phones through Expo's push
 * service (free, and the one place that talks to Apple and Google for us), and
 * the seller app's browsers through web push.
 *
 * A device the service says is gone is switched off here and never tried
 * again; it comes back when the app registers it afresh.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly expo: Expo;
  private readonly webReady: boolean;
  private readonly businessAppUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.expo = new Expo({ accessToken: config.get<string>('EXPO_ACCESS_TOKEN') || undefined });
    const publicKey = config.get<string>('VAPID_PUBLIC_KEY');
    const privateKey = config.get<string>('VAPID_PRIVATE_KEY');
    this.webReady = Boolean(publicKey && privateKey);
    if (this.webReady) {
      webpush.setVapidDetails(
        config.get<string>('VAPID_SUBJECT') || 'mailto:support@example.com',
        publicKey!,
        privateKey!,
      );
    }
    this.businessAppUrl = (config.get<string>('BUSINESS_APP_URL') ?? 'http://localhost:5174').replace(/\/$/, '');
    this.vapidPublicKey = publicKey || null;
  }

  /** Handed to browsers so they can subscribe; null while web push is not set up. */
  readonly vapidPublicKey: string | null;

  /** Whether this person has anywhere a push can go. */
  async hasDevices(userId: string): Promise<boolean> {
    const count = await this.prisma.pushDevice.count({ where: { userId, disabledAt: null } });
    return count > 0;
  }

  /**
   * Remembers a phone or a browser for this person. A token already known is
   * moved to them: one phone, signed out of one account and into another,
   * belongs to whoever is signed in now.
   */
  async register(
    userId: string,
    device: { kind: PushDeviceKind; token: string; p256dh?: string; auth?: string; label?: string },
  ) {
    if (device.kind === PushDeviceKind.EXPO && !Expo.isExpoPushToken(device.token)) {
      return { registered: false, reason: 'Not an Expo push token.' };
    }
    if (device.kind === PushDeviceKind.WEB && (!device.p256dh || !device.auth)) {
      return { registered: false, reason: 'A browser subscription needs its keys.' };
    }
    await this.prisma.pushDevice.upsert({
      where: { token: device.token },
      create: {
        userId,
        kind: device.kind,
        token: device.token,
        p256dh: device.p256dh ?? null,
        auth: device.auth ?? null,
        label: device.label?.slice(0, 60) ?? null,
      },
      update: {
        userId,
        kind: device.kind,
        p256dh: device.p256dh ?? null,
        auth: device.auth ?? null,
        label: device.label?.slice(0, 60) ?? null,
        lastSeenAt: new Date(),
        disabledAt: null,
        disabledReason: null,
      },
    });
    return { registered: true, reason: null };
  }

  /** Forgets a device — on sign-out, or when its person turns alerts off there. */
  async unregister(userId: string, token: string) {
    const { count } = await this.prisma.pushDevice.updateMany({
      where: { userId, token, disabledAt: null },
      data: { disabledAt: new Date(), disabledReason: 'Signed out or turned off on the device.' },
    });
    return { removed: count > 0 };
  }

  async devicesOf(userId: string) {
    return this.prisma.pushDevice.findMany({
      where: { userId, disabledAt: null },
      orderBy: { lastSeenAt: 'desc' },
      select: { id: true, kind: true, label: true, lastSeenAt: true, createdAt: true },
    });
  }

  /** Sends one push to every device this person has. Never throws. */
  async sendToUser(userId: string, message: PushMessage): Promise<PushResult> {
    const devices = await this.prisma.pushDevice.findMany({
      where: { userId, disabledAt: null },
      select: { id: true, kind: true, token: true, p256dh: true, auth: true },
    });
    const result: PushResult = { devices: devices.length, sent: 0, tickets: [], errors: [] };
    if (devices.length === 0) return result;

    // Phones, through Expo.
    const phones = devices.filter((d) => d.kind === PushDeviceKind.EXPO);
    if (phones.length > 0) {
      const messages: ExpoPushMessage[] = phones.map((d) => ({
        to: d.token,
        title: message.title,
        body: message.body,
        sound: 'default',
        channelId: 'default',
        badge: message.badge,
        data: { link: message.link, notificationId: message.notificationId },
      }));
      try {
        const tickets: ExpoPushTicket[] = [];
        for (const chunk of this.expo.chunkPushNotifications(messages)) {
          tickets.push(...(await this.expo.sendPushNotificationsAsync(chunk)));
        }
        // Tickets come back in the order the messages went (Expo's docs).
        for (let i = 0; i < tickets.length; i++) {
          const ticket = tickets[i];
          const device = phones[i];
          if (ticket.status === 'ok') {
            result.sent++;
            result.tickets.push({ deviceId: device.id, ticketId: ticket.id });
          } else {
            result.errors.push(ticket.message);
            if (ticket.details?.error === 'DeviceNotRegistered') {
              await this.disable(device.id, 'The phone no longer takes pushes from the app.');
            }
          }
        }
      } catch (error) {
        result.errors.push(error instanceof Error ? error.message : String(error));
      }
    }

    // Browsers, through web push.
    const browsers = devices.filter((d) => d.kind === PushDeviceKind.WEB);
    if (browsers.length > 0 && !this.webReady) {
      result.errors.push('Web push is not set up on the server.');
    }
    if (browsers.length > 0 && this.webReady) {
      const payload = JSON.stringify({
        title: message.title,
        body: message.body,
        url: message.link ? `${this.businessAppUrl}${message.link}` : this.businessAppUrl,
        tag: message.notificationId,
      });
      for (const device of browsers) {
        try {
          await webpush.sendNotification(
            { endpoint: device.token, keys: { p256dh: device.p256dh ?? '', auth: device.auth ?? '' } },
            payload,
            { TTL: 24 * 60 * 60 },
          );
          result.sent++;
        } catch (error) {
          const status = (error as { statusCode?: number }).statusCode;
          result.errors.push(error instanceof Error ? error.message : String(error));
          // 404 and 410: the browser dropped the subscription; it will not come back.
          if (status === 404 || status === 410) {
            await this.disable(device.id, 'The browser dropped the subscription.');
          }
        }
      }
    }

    return result;
  }

  /**
   * Reads Expo's receipts for pushes sent at least 15 minutes ago (its advice)
   * and switches off any phone Apple or Google says is gone.
   */
  async checkReceipts(tickets: Array<{ deviceId: string; ticketId: string }>): Promise<number> {
    if (tickets.length === 0) return 0;
    let gone = 0;
    const byTicket = new Map(tickets.map((t) => [t.ticketId, t.deviceId]));
    for (const chunk of this.expo.chunkPushNotificationReceiptIds([...byTicket.keys()])) {
      try {
        const receipts = await this.expo.getPushNotificationReceiptsAsync(chunk);
        for (const [ticketId, receipt] of Object.entries(receipts)) {
          if (receipt.status === 'error' && receipt.details?.error === 'DeviceNotRegistered') {
            const deviceId = byTicket.get(ticketId);
            if (deviceId) {
              await this.disable(deviceId, 'The phone no longer takes pushes from the app.');
              gone++;
            }
          } else if (receipt.status === 'error') {
            this.logger.warn(`Push receipt ${ticketId}: ${receipt.message}`);
          }
        }
      } catch (error) {
        this.logger.warn(`Could not read push receipts: ${error instanceof Error ? error.message : error}`);
      }
    }
    return gone;
  }

  private async disable(deviceId: string, reason: string) {
    await this.prisma.pushDevice.updateMany({
      where: { id: deviceId, disabledAt: null },
      data: { disabledAt: new Date(), disabledReason: reason },
    });
  }
}
