import {
  ValidationArguments,
  ValidationOptions,
  registerDecorator,
} from 'class-validator';

/**
 * Strips control and format characters, then trims.
 *
 * Runs as a @Transform, so the *stored* value is the cleaned one and every
 * length check downstream measures what will actually be displayed. Zero-width
 * and bidirectional-override characters are included deliberately: they are
 * invisible, so they defeat both the length rules and any human review of a
 * reported name.
 */
export const normalizeDisplayName = (value: unknown) =>
  typeof value === 'string' ? value.replace(/[\p{Cc}\p{Cf}]/gu, '').trim() : value;

/** Something a person could have typed as their name — not an address. */
export function IsDisplayName(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isDisplayName',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'string') return false;

          // An email address. Checked as "@ together with a dot" rather than a
          // full email grammar: the point is to stop a customer publishing
          // their address on a public page, not to validate one.
          if (value.includes('@') && value.includes('.')) return false;

          // Anything the platform would render, or a reader would read, as a
          // link. A scheme is decisive; so is a single unspaced token ending
          // in a dot and a TLD-shaped suffix.
          if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return false;
          if (/^www\./i.test(value)) return false;
          if (/^\S+\.[a-z]{2,}$/i.test(value)) return false;
          try {
            // Catches the schemes without slashes — mailto:, data:, javascript:.
            new URL(value);
            return false;
          } catch {
            // Not a URL. Good.
          }

          return true;
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} cannot be an email address, a link, or a web address.`;
        },
      },
    });
  };
}
