/**
 * Settings that are right in development and dangerous in production (§116.3).
 *
 * Checked at boot and thrown, never warned. This codebase already does it in two
 * places — `MomoPaymentProvider` refuses to start when the sandbox currency
 * override is set in production, and `CurrencyGuard` refuses when the ledger
 * holds a currency the deployment no longer uses — for the same reason each
 * time: a misconfiguration found at boot is an ops problem, and the same one
 * found at runtime is a customer losing something.
 *
 * Every item below has already cost something in this project. They are not
 * hypotheticals.
 */
export function assertProductionReady(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== 'production') return;

  const problems: string[] = [];

  // §116.1. Any origin, from a browser, against an API that moves money.
  if (!env.CORS_ORIGINS?.trim()) {
    problems.push(
      'CORS_ORIGINS is empty, which allows every browser origin. Set it to the ' +
        'comma-separated origins of the admin, business and customer apps.',
    );
  }

  // §113.1. This is stamped into the URL of every uploaded file. At localhost,
  // every image in the apps is a broken box while the API beside it works.
  const base = env.APP_BASE_URL ?? '';
  if (!base || /localhost|127\.0\.0\.1|^http:\/\/\d/.test(base)) {
    problems.push(
      `APP_BASE_URL is "${base || 'unset'}". It is stamped into the address of ` +
        'every uploaded file, so a private or missing one means every image is ' +
        'broken for everyone outside this machine.',
    );
  }

  // Local disk is a development fallback. On most hosts the filesystem is
  // replaced on each deploy, so every photo anyone uploads is deleted the next
  // time this ships — silently, and only noticed much later.
  if (!env.R2_PUBLIC_URL?.trim() && env.ALLOW_LOCAL_UPLOADS !== 'true') {
    problems.push(
      'R2_PUBLIC_URL is empty, so uploads fall back to local disk. On a host ' +
        'with an ephemeral filesystem every uploaded file is lost on the next ' +
        'deploy. Configure R2, or accept this deliberately by setting ' +
        'ALLOW_LOCAL_UPLOADS=true.',
    );
  }

  if (env.OPENAPI_PUBLIC === 'true') {
    problems.push(
      'OPENAPI_PUBLIC is true, which serves the full API description publicly. ' +
        'It is a complete map of the attack surface and the three clients are ' +
        'built from a generated file, not from this endpoint.',
    );
  }

  if (problems.length > 0) {
    throw new Error(
      'Refusing to start in production:\n' +
        problems.map((p) => `  - ${p}`).join('\n') +
        '\n\nEach of these is safe in development and is not safe here. See ' +
        'docs/DEPLOYMENT.md.',
    );
  }
}

/** Escape hatch for a deployment that really does keep uploads on its own disk. */
export function localUploadsAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== 'production' || env.ALLOW_LOCAL_UPLOADS === 'true';
}
