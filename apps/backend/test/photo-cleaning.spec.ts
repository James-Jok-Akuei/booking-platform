import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';
import { cleanImage } from '../src/storage/storage.service';

/**
 * Pictures are saved again without what they hid (§296): a phone's GPS spot,
 * its make, the time — and a file that only claims to be a picture is
 * refused.
 */
describe('Cleaning uploaded pictures (§296)', () => {
  /** A 40×20 photo with a location, a camera and "turn it 90°" written in it. */
  const photoWithSecrets = () =>
    sharp({ create: { width: 40, height: 20, channels: 3, background: { r: 240, g: 83, b: 45 } } })
      .withMetadata({
        orientation: 6,
        exif: {
          IFD0: { Make: 'PhoneMaker', Model: 'Phone 12', Software: 'Camera 1.0' },
          IFD3: { GPSLatitudeRef: 'S', GPSLatitude: '1/1 56/1 49/1', GPSLongitudeRef: 'E', GPSLongitude: '30/1 3/1 32/1' },
        },
      })
      .jpeg()
      .toBuffer();

  it('drops the location, the phone and every other hidden detail from a photo', async () => {
    const before = await photoWithSecrets();
    const had = await sharp(before).metadata();
    expect(had.exif).toBeDefined();
    expect(had.exif!.toString('latin1')).toContain('PhoneMaker');

    const after = await cleanImage(before, 'image/jpeg');
    const has = await sharp(after).metadata();
    expect(has.exif).toBeUndefined();
    expect(has.xmp).toBeUndefined();
    expect(has.iptc).toBeUndefined();
    expect(after.toString('latin1')).not.toContain('PhoneMaker');
  });

  it('keeps the photo the right way up — the turn is applied before it is dropped', async () => {
    const after = await cleanImage(await photoWithSecrets(), 'image/jpeg');
    const has = await sharp(after).metadata();
    // Written as 40 wide, 20 high, "turned 90°": it is now 20 wide, 40 high, and needs no turning.
    expect([has.width, has.height]).toEqual([20, 40]);
    expect(has.orientation).toBeUndefined();
  });

  it('keeps each format as it was', async () => {
    for (const [mime, format] of [
      ['image/png', 'png'],
      ['image/webp', 'webp'],
    ] as const) {
      const input = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#1f2a1f' } })
        .toFormat(format)
        .toBuffer();
      const out = await sharp(await cleanImage(input, mime)).metadata();
      expect(out.format).toBe(format);
    }
  });

  it('refuses a file that only says it is a picture', async () => {
    await expect(cleanImage(Buffer.from('%PDF-1.7 not a photo at all'), 'image/jpeg')).rejects.toThrow(BadRequestException);
  });

  it('leaves other files — a PDF for a help request — as they were', async () => {
    const pdf = Buffer.from('%PDF-1.7 a statement');
    expect(await cleanImage(pdf, 'application/pdf')).toBe(pdf);
  });
});
