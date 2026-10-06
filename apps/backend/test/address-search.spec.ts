import { jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AddressSearchService, describePlace } from '../src/routing/address-search.service';
import { AddressSearchQueryDto } from '../src/routing/dto/address.dto';

/**
 * Address suggestions while typing (§172, §174). What matters: only places in
 * Rwanda that someone could live or work at are offered, each said the way a
 * person says it; the shared map search is asked politely — named, spaced, the
 * same letters not asked twice — and a map search that is down never fails the
 * customer, it says so.
 */
describe('Address suggestions while typing (§172, §174)', () => {
  const realFetch = global.fetch;
  const fetchMock = jest.fn<typeof fetch>();

  const service = (settings: Record<string, string> = {}) =>
    new AddressSearchService({
      get: (key: string) =>
        ({ GEOCODING_BASE_URL: 'https://geo.test', GEOCODING_SPACING_MS: '0', ...settings })[key],
    } as unknown as ConfigService);

  /** One place as Photon describes it: GeoJSON, longitude first. */
  const place = (lng: number, lat: number, properties: Record<string, string>) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: [lng, lat] },
    properties: { countrycode: 'RW', ...properties },
  });
  const answer = (features: unknown[], status = 200) =>
    new Response(JSON.stringify({ type: 'FeatureCollection', features }), { status });

  const market = place(30.1262, -1.9497, {
    name: 'Kimironko Market',
    street: 'KG 153 Street',
    district: 'Kimironko',
    city: 'Kigali',
    osm_key: 'amenity',
  });

  beforeAll(() => {
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterAll(() => {
    global.fetch = realFetch;
  });
  beforeEach(() => fetchMock.mockReset());

  it('says a place the way a person would', () => {
    expect(describePlace(market.properties)).toEqual({
      label: 'Kimironko Market, KG 153 Street, Kimironko',
      detail: 'Kigali',
    });
    expect(
      describePlace({ housenumber: '11', street: 'KG 28 Avenue', district: 'Kimihurura', city: 'Kigali' }),
    ).toEqual({ label: '11 KG 28 Avenue, Kimihurura', detail: 'Kigali' });
    // A district is WHERE a place is, not what it is called.
    expect(
      describePlace({ name: 'Kigali Heights', street: 'KG 7 Avenue', district: 'Gasabo District', city: 'Kigali' }),
    ).toEqual({ label: 'Kigali Heights, KG 7 Avenue', detail: 'Gasabo District, Kigali' });
    // The same name in four provinces is told apart by where it is.
    expect(
      describePlace({ name: 'Remera', city: 'Musanze', state: 'Northern Province, Rwanda' }),
    ).toEqual({ label: 'Remera', detail: 'Musanze, Northern Province' });
    // Smallest first outside Kigali: the sector, then its district.
    expect(
      describePlace({ name: 'Remera', city: 'Ruheru', county: 'Nyaruguru District', state: 'Southern Province' }),
    ).toEqual({ label: 'Remera', detail: 'Ruheru, Nyaruguru District' });
  });

  it('offers only places in Rwanda that are somewhere to be, once each', async () => {
    fetchMock.mockResolvedValueOnce(
      answer([
        market,
        place(30.4, -1.3, { name: 'Nyamirama', countrycode: 'UG', city: 'Ntungamo' }),
        place(30.3, -1.6, { name: 'Nyamirama', osm_key: 'waterway', county: 'Nyagatare District' }),
        { type: 'Feature', geometry: { type: 'Point' }, properties: { countrycode: 'RW', name: 'Nowhere' } },
        // The same shop as a building: one choice, not two.
        { ...market, properties: { ...market.properties, osm_key: 'building' } },
      ]),
    );

    const found = await service().search('kimir');

    expect(found).toEqual({
      available: true,
      results: [
        {
          label: 'Kimironko Market, KG 153 Street, Kimironko',
          detail: 'Kigali',
          latitude: -1.9497,
          longitude: 30.1262,
        },
      ],
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/^https:\/\/geo\.test\/api\/\?/);
    expect(String(url)).toContain('q=kimir');
    expect(String(url)).toContain(`bbox=${encodeURIComponent('28.85,-2.85,30.9,-1.04')}`);
    expect((init?.headers as Record<string, string>)['User-Agent']).toMatch(/booking-platform/);
  });

  it('offers at most six', async () => {
    fetchMock.mockResolvedValueOnce(
      answer(Array.from({ length: 12 }, (_, i) => place(30 + i / 100, -1.9, { name: `Place ${i}` }))),
    );
    expect((await service().search('place')).results).toHaveLength(6);
  });

  it('does not ask twice for the same letters', async () => {
    const addresses = service();
    fetchMock.mockResolvedValueOnce(answer([market]));

    await addresses.search('Kimir');
    const again = await addresses.search('kimir');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(again.results).toHaveLength(1);
  });

  it('says it could not search — not that nothing matched — when the service fails', async () => {
    const addresses = service();
    fetchMock.mockRejectedValueOnce(new Error('timeout'));
    expect(await addresses.search('KG 11')).toEqual({ results: [], available: false });

    fetchMock.mockResolvedValueOnce(new Response('busy', { status: 429 }));
    expect(await addresses.search('KG 11')).toEqual({ results: [], available: false });

    // A failure is not remembered: the next try asks again.
    fetchMock.mockResolvedValueOnce(answer([market]));
    expect((await addresses.search('KG 11')).available).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('finding nothing is an answer, and says so', async () => {
    fetchMock.mockResolvedValueOnce(answer([]));
    expect(await service().search('zzzz')).toEqual({ results: [], available: true });
  });

  it('asks nobody when search is turned off', async () => {
    expect(await service({ GEOCODING_BASE_URL: '' }).search('KG 11')).toEqual({
      results: [],
      available: false,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('waits its turn: searches are spaced, even when they arrive together', async () => {
    const addresses = service({ GEOCODING_SPACING_MS: '250' });
    const askedAt: number[] = [];
    fetchMock.mockImplementation(async () => {
      askedAt.push(Date.now());
      return answer([market]);
    });

    await Promise.all([addresses.search('kim'), addresses.search('kimi'), addresses.search('kimir')]);

    expect(askedAt).toHaveLength(3);
    expect(askedAt[1] - askedAt[0]).toBeGreaterThanOrEqual(240);
    expect(askedAt[2] - askedAt[1]).toBeGreaterThanOrEqual(240);
  });

  it('tidies what was typed, and refuses too little or too much', async () => {
    const tidy = plainToInstance(AddressSearchQueryDto, { q: '  KG   11 Ave ' });
    expect(await validate(tidy)).toHaveLength(0);
    expect(tidy.q).toBe('KG 11 Ave');

    expect(await validate(plainToInstance(AddressSearchQueryDto, { q: 'ab' }))).not.toHaveLength(0);
    expect(
      await validate(plainToInstance(AddressSearchQueryDto, { q: 'x'.repeat(121) })),
    ).not.toHaveLength(0);
  });
});
