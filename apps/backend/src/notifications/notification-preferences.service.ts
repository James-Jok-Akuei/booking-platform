import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationCategory, NotificationChannel } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_LOCALE, type Locale } from '../i18n/locales';
import { asLocale, msg, say } from '../i18n/say';
import { Audience, CATEGORY_RULES, CHOICE_CHANNELS, ChoiceChannel, audienceOf, ruleFor } from './notification-catalog';

/** On or off, for one kind on one channel. */
export type Choices = Map<string, boolean>;
const key = (category: NotificationCategory, channel: NotificationChannel) => `${category}:${channel}`;

/** The words a person agrees to for news and offers, kept with their yes (§287). */
export const NEWS_YES = msg('Yes, send me news and offers. I can stop at any time.');

/**
 * What each person has chosen to receive, and how (§287).
 *
 * Only choices that differ from the default are stored; the defaults live in
 * the catalog, so changing one changes it for everyone who never chose. A
 * locked channel cannot be turned off, whatever is stored.
 */
@Injectable()
export class NotificationPreferencesService {
  private readonly secret: string;
  private readonly apiBase: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.secret = config.get<string>('JWT_ACCESS_SECRET') ?? 'notifications';
    this.apiBase = (config.get<string>('APP_BASE_URL') ?? 'http://localhost:4100').replace(/\/$/, '');
  }

  /** This person's stored choices. */
  async choicesOf(userId: string): Promise<Choices> {
    const rows = await this.prisma.notificationPreference.findMany({
      where: { userId },
      select: { category: true, channel: true, enabled: true },
    });
    return new Map(rows.map((r) => [key(r.category, r.channel), r.enabled]));
  }

  /** Whether a kind goes out on a channel, for this audience and these choices. */
  isOn(choices: Choices, audience: Audience, category: NotificationCategory, channel: ChoiceChannel): boolean {
    const rule = ruleFor(audience, category);
    const channelRule = channel === NotificationChannel.EMAIL ? rule?.email : rule?.push;
    if (!rule || !channelRule) return false;
    if (channelRule.locked) return true;
    return choices.get(key(category, channel)) ?? channelRule.on;
  }

  /** Everything the settings screen shows, in the reader's language (§308). */
  async settings(userId: string, locale: Locale = DEFAULT_LOCALE) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: { role: true, quietHoursOn: true, quietFrom: true, quietTo: true, bookingEmailDigest: true },
    });
    const audience = audienceOf(user.role);
    const choices = await this.choicesOf(userId);
    const channel = (category: NotificationCategory, ch: ChoiceChannel) => {
      const rule = ruleFor(audience, category)!;
      const channelRule = ch === NotificationChannel.EMAIL ? rule.email : rule.push;
      if (!channelRule) return null;
      return { on: this.isOn(choices, audience, category, ch), locked: channelRule.locked ? say(locale, channelRule.locked) : null };
    };
    return {
      audience,
      categories: CATEGORY_RULES[audience].map((rule) => ({
        category: rule.category,
        title: say(locale, rule.title),
        hint: say(locale, rule.hint),
        email: channel(rule.category, NotificationChannel.EMAIL),
        push: channel(rule.category, NotificationChannel.PUSH),
        canWait: rule.canWait,
        needsYes: rule.needsYes ?? false,
      })),
      quietHours: { on: user.quietHoursOn, from: user.quietFrom, to: user.quietTo },
      bookingEmailDigest: audience === 'BUSINESS' ? user.bookingEmailDigest : null,
      newsWording: say(locale, NEWS_YES),
    };
  }

  /** Changes some choices. Locked ones are refused; a yes to news is kept with its words. */
  async update(
    userId: string,
    change: {
      choices?: Array<{ category: NotificationCategory; channel: NotificationChannel; on: boolean }>;
      quietHours?: { on: boolean; from: number; to: number };
      bookingEmailDigest?: boolean;
      source: string;
    },
    locale: Locale = DEFAULT_LOCALE,
  ) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { role: true } });
    const audience = audienceOf(user.role);

    for (const choice of change.choices ?? []) {
      if (!CHOICE_CHANNELS.includes(choice.channel as ChoiceChannel)) {
        throw new BadRequestException('Only email and push can be chosen.');
      }
      const rule = ruleFor(audience, choice.category);
      const channelRule = choice.channel === NotificationChannel.EMAIL ? rule?.email : rule?.push;
      if (!rule || !channelRule) throw new BadRequestException('That kind of notification is not yours to choose.');
      if (channelRule.locked && !choice.on) throw new BadRequestException(channelRule.locked);
    }

    await this.prisma.$transaction(async (tx) => {
      for (const choice of change.choices ?? []) {
        await tx.notificationPreference.upsert({
          where: { userId_category_channel: { userId, category: choice.category, channel: choice.channel } },
          create: { userId, category: choice.category, channel: choice.channel, enabled: choice.on },
          update: { enabled: choice.on },
        });
        if (ruleFor(audience, choice.category)?.needsYes) {
          await tx.consentRecord.create({
            data: {
              userId,
              purpose: `${choice.category.toLowerCase()}.${choice.channel.toLowerCase()}`,
              granted: choice.on,
              // The words as they were shown, in the language they were read in.
              wording: choice.on ? say(locale, NEWS_YES) : 'Turned off.',
              source: change.source,
            },
          });
        }
      }
      if (change.quietHours || change.bookingEmailDigest !== undefined) {
        const q = change.quietHours;
        if (q && (q.from < 0 || q.from >= 1440 || q.to < 0 || q.to >= 1440)) {
          throw new BadRequestException('Quiet hours are times of day.');
        }
        await tx.user.update({
          where: { id: userId },
          data: {
            ...(q ? { quietHoursOn: q.on, quietFrom: q.from, quietTo: q.to } : {}),
            ...(change.bookingEmailDigest !== undefined && audience === 'BUSINESS'
              ? { bookingEmailDigest: change.bookingEmailDigest }
              : {}),
          },
        });
      }
    });

    return this.settings(userId, locale);
  }

  // ---------- "Stop emails like this", without signing in ----------

  private sign(userId: string, category: NotificationCategory) {
    return createHmac('sha256', this.secret)
      .update(`unsubscribe:${userId}:${category}`)
      .digest('base64url')
      .slice(0, 32);
  }

  /** The link in an email's footer, for a kind that may be turned off. */
  unsubscribeUrl(userId: string, category: NotificationCategory) {
    const params = new URLSearchParams({ u: userId, c: category, t: this.sign(userId, category) });
    return `${this.apiBase}/notifications/unsubscribe?${params.toString()}`;
  }

  /** Turns email off for that kind. True when the link was genuine; the kind named in the person's language. */
  async unsubscribe(
    userId: string,
    category: string,
    token: string,
  ): Promise<{ ok: boolean; title?: string; locale?: Locale }> {
    if (!(Object.values(NotificationCategory) as string[]).includes(category)) return { ok: false };
    const expected = Buffer.from(this.sign(userId, category as NotificationCategory));
    const given = Buffer.from(token ?? '');
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return { ok: false };

    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true, locale: true } });
    if (!user) return { ok: false };
    const locale = asLocale(user.locale);
    const audience = audienceOf(user.role);
    const rule = ruleFor(audience, category as NotificationCategory);
    if (!rule?.email || rule.email.locked) return { ok: false, locale };

    await this.update(userId, {
      choices: [{ category: category as NotificationCategory, channel: NotificationChannel.EMAIL, on: false }],
      source: 'email-link',
    });
    return { ok: true, title: say(locale, rule.title), locale };
  }
}
