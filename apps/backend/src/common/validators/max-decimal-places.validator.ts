import {
  ValidationArguments,
  ValidationOptions,
  registerDecorator,
} from 'class-validator';
import { Prisma } from '@prisma/client';

/**
 * Caps how many decimal places a numeric value may carry.
 *
 * Replaces class-validator's `@IsNumber({ maxDecimalPlaces })`, which crashes
 * on any number JavaScript stringifies in exponent form. Its implementation is
 * effectively `value.toString().split('.')[1].length`, and `(0.0000001)
 * .toString()` is `"1e-7"` — no `"."`, so the split yields undefined and
 * reading `.length` throws a TypeError. That surfaces as a 500 on ordinary user
 * input; anything below 1e-6 triggers it.
 *
 * Prisma.Decimal parses exponent notation correctly and reports the true scale,
 * which is also the type this value is ultimately stored and multiplied as.
 */
export function MaxDecimalPlaces(max: number, options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'maxDecimalPlaces',
      target: object.constructor,
      propertyName,
      constraints: [max],
      options,
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'number' || !Number.isFinite(value)) return false;
          try {
            return (new Prisma.Decimal(value).decimalPlaces() ?? 0) <= max;
          } catch {
            return false;
          }
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must have at most ${args.constraints[0]} decimal places.`;
        },
      },
    });
  };
}
