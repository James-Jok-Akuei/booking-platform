/**
 * A plain sentence confirming something happened (§128.15).
 *
 * Several actions answer with nothing but a message: removing a saved number,
 * revoking an invitation, closing an account. They all used `{ message: string }`
 * written out again at each call site in each client, which is three places to
 * change and no single name for the shape.
 *
 * The message is meant to be SHOWN. It is written for the person who pressed the
 * button, not for a developer reading a log.
 */
export class ActionMessageDto {
  message!: string;
}
