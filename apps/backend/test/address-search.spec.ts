import { jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { AddressSearchService, describePlace } from '../src/routing/address-search.service';
import { AddressSearchQueryDto } from '../src/routing/dto/address.dto';

/**
 * Finding a typed address (§172). What matters: the public map search's rules
 * are kept — Rwanda only, the caller named, one request a second, the same
 * words not asked twice — and a map search that is down never fails the
 * customer, it says so.
 */
describe('Finding a typed address (§172)', () => {
  const realFetch = global.fetch;
  const fetchMock = jest.fn<typeof fetch>();

  const service = (settings: Record<string, string> = {}) =>
    new AddressSearchService({
      get: (key: string) =>
        ({ GEOCODING_BASE_URL: 'https://geo.test', GEOCODING_SPACING_MS: '0', ...settings })[key],
    } as unknown as ConfigService);

  const answer = (places: unknown, status = 200) =>
    new Response(JSON.stringify(places), { status });

  const market = {
    lat: '-1.9497',
    lon: '30.1262',
    name: 'Kimironko Market',
    display_name: 'Kimironko Market, KG 11 Ave, Kimironko, Gasabo, Kigali, Rwanda',
    address: {
      road: 'KG 11 Ave',
      suburb: 'Kimironko',
      county: 'Gasabo',
      city: 'Kigali',
      country: 'Rwanda',
    },
  };

  beforeAll(() => {
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterAll(() => {
    global.fetch = realFetch;
  });
  beforeEach(() => fetchMock.mockReset());

  it('says a place the way a person would, not the whole map line', () => {
    expect(describePlace(market)).toEqual({
      label: 'Kimironko Market, KG 11 Ave, Kimironko',
      detail: 'Gasabo, Kigali',
    });
    expect(
      describePlace({
        address: { house_number: '24', road: 'KN 5 Rd', suburb: 'Kiyovu', county: 'Nyarugenge', city: 'Kigali' },
      }),
    ).toEqual({ label: '24 KN 5 Rd, Kiyovu', detail: 'Nyarugenge, Kigali' });
    // Nothing to build from but the map's own line: its first two parts.
    expect(describePlace({ display_name: 'Musanze, Northern Province, Rwanda' }).label).toBe(
      'Musanze, Northern Province',
    );
  });

  it('asks for Rwanda only, names itself, and answers with places to pick', async () => {
    fetchMock.mockResolvedValueOnce(
      answer([market, { lat: 'nowhere', lon: '30.1', name: 'Broken' }, market]),
    );

    const found = await service().search('Kimironko Market');

    expect(found).toEqual({
      available: true,
      results: [
        {
          label: 'Kimironko Market, KG 11 Ave, Kimironko',
          detail: 'Gasabo, Kigali',
          latitude: -1.9497,
          longitude: 30.1262,
        },
      ],
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/^https:\/\/geo\.test\/search\?/);
    expect(String(url)).toContain('countrycodes=rw');
    expect(String(url)).toContain('q=Kimironko+Market');
    expect((init?.headers as Record<string, string>)['User-Agent']).toMatch(/booking-platform/);
  });

  it('does not ask twice for the same words', async () => {
    const addresses = service();
    fetchMock.mockResolvedValueOnce(answer([market]));

    await addresses.search('Kimironko Market');
    const again = await addresses.search('kimironko market');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(again.results).toHaveLength(1);
  });

  it('says it could not search — not that nothing matched — when the service fails', async () => {
    const addresses = service();
    fetchMock.mockRejectedValueOnce(new Error('timeout'));
    expect(await addresses.search('KG 11 Ave')).toEqual({ results: [], available: false });

    fetchMock.mockResolvedValueOnce(answer({ error: 'busy' }, 429));
    expect(await addresses.search('KG 11 Ave')).toEqual({ results: [], available: false });

    // A failure is not remembered: the next try asks again.
    fetchMock.mockResolvedValueOnce(answer([market]));
    expect((await addresses.search('KG 11 Ave')).available).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('finding nothing is an answer, and says so', async () => {
    fetchMock.mockResolvedValueOnce(answer([]));
    expect(await service().search('Nowhere Street')).toEqual({ results: [], available: true });
  });

  it('asks nobody when search is turned off', async () => {
    expect(await service({ GEOCODING_BASE_URL: '' }).search('KG 11 Ave')).toEqual({
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

    await Promise.all([addresses.search('one'), addresses.search('two'), addresses.search('three')]);

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
