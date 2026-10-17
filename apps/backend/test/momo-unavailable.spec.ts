import { jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';
import { MomoPaymentProvider } from '../src/payments/momo-payment.provider';
import { MomoDisbursementProvider } from '../src/payments/momo-disbursement.provider';

/**
 * MTN not answering (§282), with MTN faked.
 *
 * Its token service refusing, or the network failing, used to escape as a
 * thrown error — the customer read "Internal server error". It is now a
 * failed start the booking flow can put into words, and, for a payment
 * already under way, "not known yet".
 */
describe('MTN MoMo not answering (§282)', () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock<(url: string, init?: RequestInit) => Promise<Response>>;
  let provider: MomoPaymentProvider;

  const settings: Record<string, string> = {
    MOMO_BASE_URL: 'https://momo.test',
    MOMO_SUBSCRIPTION_KEY_PRIMARY: 'key',
    MOMO_API_USER: 'user',
    MOMO_API_KEY: 'secret',
    MOMO_TARGET_ENVIRONMENT: 'sandbox',
  };

  const answer = (status: number, body: unknown = {}) =>
    new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

  const params = {
    phoneNumber: '250788123456',
    amountMinor: 2700,
    currency: 'RWF',
    externalReferenceId: 'appointment-1',
  };

  beforeEach(() => {
    fetchMock = jest.fn<(url: string, init?: RequestInit) => Promise<Response>>();
    global.fetch = fetchMock as unknown as typeof fetch;
    provider = new MomoPaymentProvider({ get: (key: string) => settings[key] } as unknown as ConfigService);
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  it('a token refused with MTN’s own 500 is a passing failure, not a crash', async () => {
    fetchMock.mockResolvedValue(answer(500, { statusCode: 500, message: 'Internal server error' }));

    const result = await provider.initiatePayment(params);

    expect(result).toMatchObject({ status: 'FAILED', failureKind: 'TRANSIENT' });
    expect(result.failureReason).toMatch(/did not answer \(HTTP 500\)/);
  });

  it('MTN out of reach is the same', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    const result = await provider.initiatePayment(params);

    expect(result).toMatchObject({ status: 'FAILED', failureKind: 'TRANSIENT' });
    expect(result.failureReason).toMatch(/could not be reached/);
  });

  it('a token refused as 401 is our own keys — the admins are to be told', async () => {
    fetchMock.mockResolvedValue(answer(401, { message: 'Access denied' }));

    const result = await provider.initiatePayment(params);

    expect(result).toMatchObject({ status: 'FAILED', failureKind: 'CONFIGURATION' });
  });

  it('a request lost on the way — after a token — is kept as under way, never "not started"', async () => {
    // MTN may have queued it and be prompting the customer: calling it not
    // started could let them pay with no booking to show for it.
    fetchMock
      .mockResolvedValueOnce(answer(200, { access_token: 'token', expires_in: 3600 }))
      .mockRejectedValueOnce(new TypeError('socket hang up'));

    const result = await provider.initiatePayment(params);

    expect(result.status).toBe('PENDING');
    expect(result.providerReferenceId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('a payment under way is "not known yet" while MTN is down — never failed', async () => {
    fetchMock.mockResolvedValue(answer(500, { statusCode: 500, message: 'Internal server error' }));
    expect(await provider.checkPaymentStatus('reference-1')).toEqual({ status: 'PENDING' });

    fetchMock.mockRejectedValue(new TypeError('fetch failed'));
    expect(await provider.checkPaymentStatus('reference-1')).toEqual({ status: 'PENDING' });
  });

  it('when MTN answers, a payment starts as before', async () => {
    fetchMock
      .mockResolvedValueOnce(answer(200, { access_token: 'token', expires_in: 3600 }))
      .mockResolvedValueOnce(answer(202, ''));

    const result = await provider.initiatePayment(params);

    expect(result.status).toBe('PENDING');
    expect(result.providerReferenceId).toMatch(/^[0-9a-f-]{36}$/);
  });

  describe('payouts', () => {
    it('no token means nothing was sent: a refusal, so the payout goes back to waiting', async () => {
      const payouts = new MomoDisbursementProvider({
        get: (key: string) =>
          ({
            ...settings,
            MOMO_DISBURSEMENT_SUBSCRIPTION_KEY_PRIMARY: 'key',
            MOMO_DISBURSEMENT_API_USER: 'user',
            MOMO_DISBURSEMENT_API_KEY: 'secret',
          })[key],
      } as unknown as ConfigService);
      fetchMock.mockResolvedValue(answer(500, { statusCode: 500, message: 'Internal server error' }));

      const result = await payouts.sendTransfer({
        msisdn: '250788123456',
        amountMinor: 10_000,
        currency: 'RWF',
        externalReferenceId: 'payout-1',
      });

      expect(result).toMatchObject({ status: 'FAILED', failureKind: 'TRANSIENT' });
    });
  });
});
