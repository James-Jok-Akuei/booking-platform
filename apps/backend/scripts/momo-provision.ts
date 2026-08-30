/**
 * One-time MTN MoMo sandbox provisioning.
 *
 *   npm run momo:provision
 *
 * The sandbox requires you to create your own API user and API key before you
 * can obtain an access token. MTN issues these directly for production, so
 * these two endpoints are SANDBOX-ONLY and this script has no production
 * equivalent.
 *
 * Deliberately a script rather than a startup check: it is run once per sandbox
 * account, its output has to be pasted into .env by a human, and something that
 * mints credentials should never fire as a side effect of booting a server.
 * Running it again simply creates a second, equally valid API user — it does
 * not rotate or invalidate the first.
 */
import 'dotenv/config';
import * as crypto from 'crypto';

async function main() {
  const baseUrl = (process.env.MOMO_BASE_URL ?? 'https://sandbox.momodeveloper.mtn.com').replace(/\/+$/, '');
  const subscriptionKey = process.env.MOMO_SUBSCRIPTION_KEY_PRIMARY?.trim();

  if (!subscriptionKey) {
    console.error('MOMO_SUBSCRIPTION_KEY_PRIMARY is not set in .env.');
    process.exit(1);
  }

  if (process.env.MOMO_API_USER && process.env.MOMO_API_KEY) {
    console.log(
      'MOMO_API_USER and MOMO_API_KEY are already set in .env.\n' +
        'Provisioning again would create a NEW, separate sandbox user rather than\n' +
        'rotating this one. Clear both values first if that is genuinely what you want.',
    );
    process.exit(0);
  }

  // We choose the API user id; MTN echoes it back as the account identifier.
  const apiUserId = crypto.randomUUID();
  console.log(`Creating sandbox API user ${apiUserId} ...`);

  const createUser = await fetch(`${baseUrl}/v1_0/apiuser`, {
    method: 'POST',
    headers: {
      'X-Reference-Id': apiUserId,
      'Ocp-Apim-Subscription-Key': subscriptionKey,
      'Content-Type': 'application/json',
    },
    // providerCallbackHost is required by the API even though this integration
    // polls rather than relying on callbacks (sandbox callback delivery is
    // unreliable — see DECISIONS.md).
    body: JSON.stringify({ providerCallbackHost: 'example.com' }),
  });

  if (createUser.status !== 201) {
    console.error(`  Failed (HTTP ${createUser.status}): ${await createUser.text()}`);
    process.exit(1);
  }
  console.log('  API user created (HTTP 201).');

  const createKey = await fetch(`${baseUrl}/v1_0/apiuser/${apiUserId}/apikey`, {
    method: 'POST',
    headers: { 'Ocp-Apim-Subscription-Key': subscriptionKey },
  });

  if (createKey.status !== 201) {
    console.error(`  Failed to create API key (HTTP ${createKey.status}): ${await createKey.text()}`);
    process.exit(1);
  }

  const { apiKey } = (await createKey.json()) as { apiKey: string };
  console.log('  API key generated (HTTP 201).');

  // Prove the credentials work before asking anyone to save them.
  const basic = Buffer.from(`${apiUserId}:${apiKey}`).toString('base64');
  const token = await fetch(`${baseUrl}/collection/token/`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Ocp-Apim-Subscription-Key': subscriptionKey,
    },
  });
  console.log(
    token.ok
      ? `  Verified: access token obtained (HTTP ${token.status}).`
      : `  WARNING: credentials created but token request returned HTTP ${token.status}.`,
  );

  console.log('\nAdd these to apps/backend/.env:\n');
  console.log(`MOMO_API_USER="${apiUserId}"`);
  console.log(`MOMO_API_KEY="${apiKey}"`);
  console.log('\nThey do not expire. Regenerate only if the sandbox account is reset.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
