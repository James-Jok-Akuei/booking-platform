import {
  ValidationArguments,
  ValidationOptions,
  registerDecorator,
} from 'class-validator';

/**
 * Rejects 0,0 — "Null Island", in the Gulf of Guinea.
 *
 * A valid pair of numbers and almost never a real place. It is what a form
 * submits when both fields were left empty and coerced, or when a geocoder
 * failed and returned zeroes, so accepting it would put every misconfigured
 * business at the same point in the ocean — and they would all be each other's
 * nearest neighbour.
 *
 * Declared on `latitude` but validates the pair, since only together do the two
 * values mean anything.
 */
export function IsNotNullIsland(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isNotNullIsland',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(latitude: unknown, args: ValidationArguments) {
          const longitude = (args.object as { longitude?: unknown }).longitude;
          return !(Number(latitude) === 0 && Number(longitude) === 0);
        },
        defaultMessage() {
          return (
            'latitude and longitude cannot both be 0 — that point is in the ' +
            'Gulf of Guinea, and is almost always an empty or failed lookup.'
          );
        },
      },
    });
  };
}
