import {
  assertProductionReady,
  localUploadsAllowed,
} from '../src/common/production-readiness';

/**
 * The settings that are fine here and dangerous in production (§116.3).
 *
 * Pure, and takes its environment as an argument, so these run without booting
 * anything and without touching `process.env` — a test that mutated the real one
 * would leak into every suite after it in a `maxWorkers: 1` run.
 */
describe('Refusing to start in production (§116.3)', () => {
  const GOOD = {
    NODE_ENV: 'production',
    CORS_ORIGINS: 'https://admin.example.com,https://business.example.com',
    APP_BASE_URL: 'https://api.example.com',
    R2_PUBLIC_URL: 'https://files.example.com',
  } as NodeJS.ProcessEnv;

  it('says nothing outside production, whatever is set', () => {
    expect(() =>
      assertProductionReady({ NODE_ENV: 'development' } as NodeJS.ProcessEnv),
    ).not.toThrow();
    // Not even the worst combination, because in development every one of these
    // is the right answer.
    expect(() =>
      assertProductionReady({
        NODE_ENV: 'test',
        APP_BASE_URL: 'http://localhost:3000',
        OPENAPI_PUBLIC: 'true',
      } as NodeJS.ProcessEnv),
    ).not.toThrow();
  });

  it('starts when everything is set properly', () => {
    expect(() => assertProductionReady(GOOD)).not.toThrow();
  });

  it('refuses a wide-open CORS policy', () => {
    expect(() => assertProductionReady({ ...GOOD, CORS_ORIGINS: '' })).toThrow(
      /CORS_ORIGINS is empty/,
    );
    // Whitespace is not a list.
    expect(() => assertProductionReady({ ...GOOD, CORS_ORIGINS: '   ' })).toThrow(
      /CORS_ORIGINS is empty/,
    );
  });

  it('refuses an APP_BASE_URL nobody outside the machine can reach', () => {
    // §113.1: this is stamped into every uploaded file's address, so the symptom
    // is every image broken while the API beside it answers perfectly.
    for (const base of ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://192.168.1.89:3000', '']) {
      expect(() => assertProductionReady({ ...GOOD, APP_BASE_URL: base })).toThrow(
        /APP_BASE_URL/,
      );
    }
  });

  it('refuses local-disk uploads unless they are chosen on purpose', () => {
    expect(() => assertProductionReady({ ...GOOD, R2_PUBLIC_URL: '' })).toThrow(
      /R2_PUBLIC_URL is empty/,
    );
    // An escape hatch, because a deployment with a real persistent disk is a
    // legitimate choice — it just must not be the one nobody made.
    expect(() =>
      assertProductionReady({ ...GOOD, R2_PUBLIC_URL: '', ALLOW_LOCAL_UPLOADS: 'true' }),
    ).not.toThrow();
  });

  it('refuses to publish the API description', () => {
    expect(() => assertProductionReady({ ...GOOD, OPENAPI_PUBLIC: 'true' })).toThrow(
      /OPENAPI_PUBLIC/,
    );
  });

  it('reports every problem at once, not the first one', () => {
    // Someone fixing these is on a deploy pipeline with a slow feedback loop.
    // One error per attempt would be four deploys.
    const error = (() => {
      try {
        assertProductionReady({ NODE_ENV: 'production' } as NodeJS.ProcessEnv);
      } catch (e) {
        return e as Error;
      }
      throw new Error('expected it to refuse');
    })();

    expect(error.message).toMatch(/CORS_ORIGINS/);
    expect(error.message).toMatch(/APP_BASE_URL/);
    expect(error.message).toMatch(/R2_PUBLIC_URL/);
    expect(error.message).toMatch(/docs\/DEPLOYMENT\.md/);
  });

  it('localUploadsAllowed is permissive everywhere but production', () => {
    expect(localUploadsAllowed({ NODE_ENV: 'development' } as NodeJS.ProcessEnv)).toBe(true);
    expect(localUploadsAllowed({ NODE_ENV: 'production' } as NodeJS.ProcessEnv)).toBe(false);
    expect(
      localUploadsAllowed({
        NODE_ENV: 'production',
        ALLOW_LOCAL_UPLOADS: 'true',
      } as NodeJS.ProcessEnv),
    ).toBe(true);
  });
});
