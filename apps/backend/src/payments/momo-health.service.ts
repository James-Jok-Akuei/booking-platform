import { Injectable } from '@nestjs/common';

/**
 * How mobile money is doing right now (§310), from our own deposits: when
 * MoMo is slow or not answering, shops and customers are told so — a seller
 * otherwise thinks the app is broken, and a customer pays twice.
 *
 * A short count kept in memory: the last 20 minutes of attempts and their
 * outcomes. Nothing about anyone is kept — only what happened and when. Each
 * server counts what it sees; a restart starts the count again, which is the
 * right answer after a restart anyway.
 */
export type MomoEvent =
  /** The prompt reached the customer's phone. */
  | 'started'
  /** MoMo did not answer the request to start (§282), or payments are down. */
  | 'unreachable'
  /** The customer approved: the deposit is paid. */
  | 'paid'
  /** Declined or failed on the phone. */
  | 'failed'
  /** Never answered, until the hold ran out. */
  | 'expired';

export type MomoState = 'ok' | 'slow' | 'down';

const WINDOW_MS = 20 * 60_000;

/** Enough attempts that a pattern means something, not one unlucky customer. */
const MIN_STARTS = 3;
const MIN_OUTCOMES = 5;

@Injectable()
export class MomoHealthService {
  private events: Array<{ at: number; event: MomoEvent }> = [];

  record(event: MomoEvent, at = Date.now()) {
    this.events.push({ at, event });
    this.trim(at);
  }

  state(now = Date.now()): MomoState {
    this.trim(now);
    const count = (event: MomoEvent) => this.events.filter((e) => e.event === event).length;
    const unreachable = count('unreachable');
    const tries = unreachable + count('started');
    if (unreachable >= MIN_STARTS && unreachable / tries >= 0.5) return 'down';
    const outcomes = count('paid') + count('failed') + count('expired');
    if (outcomes >= MIN_OUTCOMES && count('paid') / outcomes < 0.4) return 'slow';
    return 'ok';
  }

  private trim(now: number) {
    const from = now - WINDOW_MS;
    if (this.events.length && this.events[0].at < from) this.events = this.events.filter((e) => e.at >= from);
  }
}
