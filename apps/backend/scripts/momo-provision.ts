/**
 * One-time MTN MoMo sandbox provisioning.
 *
 *   npm run momo:provision                      # Collections (money in)
 *   npm run momo:provision -- --disbursement    # Disbursements (money out)
 *
 * The sandbox requires you to create your own API user and API key before you
 * can obtain an access token. MTN issues these directly for production, so
 * these two endpoints are SANDBOX-ONLY and this script has no production
 * equivalent.
 *
 * ## Two products, two sets of credentials
 *
 * Collections and Disbursements are separate subscriptions with separate
 * subscription keys, so each gets its own API user. They could conceivably
 * share one — the sandbox is not strict about it — but provisioning separately
 * costs nothing and means a key regenerated for one product cannot silently
 * break the other. Money out is worth the extra minute.
 *
 * Deliberately a script rather than a startup check: it is run once per product,
 * its output has to be pasted into .env by a human, and something that mints
 * credentials should never fire as a side effect of booting a server. Running it
 * again simply creates a second, equally valid API user — it does not rotate or
 * invalidate the first.
 */
import 'dotenv/config';
import * as crypto from 'crypto';

interface Product {
  /** What MTN calls it in the token path. */
  readonly tokenPath: string;
  readonly label: string;
  readonly subscriptionKeyVar: string;
  readonly apiUserVar: string;
  readonly apiKeyVar: string;
}

const PRODUCTS: Record<'collection' | 'disbursement', Product> = {
  collection: {
    tokenPath: 'collection',
    label: 'Collections (money in)',
    // Unprefixed, because collections came first and these names are already in
    // every .env. Renaming them for symmetry would break a working sandbox for
    // a tidiness that nobody reading this file needs.
    subscriptionKeyVar: 'MOMO_SUBSCRIPTION_KEY_PRIMARY',
    apiUserVar: 'MOMO_API_USER',
    apiKeyVar: 'MOMO_API_KEY',
  },
  disbursement: {
    tokenPath: 'disbursement',
    label: 'Disbursements (money out)',
    subscriptionKeyVar: 'MOMO_DISBURSEMENT_SUBSCRIPTION_KEY_PRIMARY',
    apiUserVar: 'MOMO_DISBURSEMENT_API_USER',
    apiKeyVar: 'MOMO_DISBURSEMENT_API_KEY',
  },
};

async function main() {
  const wantsDisbursement = process.argv.includes('--disbursement');
  const product = wantsDisbursement ? PRODUCTS.disbursement : PRODUCTS.collection;

  const baseUrl = (
    process.env.MOMO_BASE_URL ?? 'https://sandbox.momodeveloper.mtn.com'
  ).replace(/\/+$/, '');

  const subscriptionKey = process.env[product.subscriptionKeyVar]?.trim();

  console.log(`\nProvisioning: ${product.label}\n`);

  if (!subscriptionKey) {
    console.error(
      `${product.subscriptionKeyVar} is not set in .env.\n\n` +
        'Get it from https://momodeveloper.mtn.com → Profile → Subscriptions.\n' +
        `Use the PRIMARY key of the ${product.label.split(' ')[0]} subscription — ` +
        'each product has its own, and using the wrong one fails with a ' +
        '"subscription not found" error that reads like a broken integration.',
    );
    process.exit(1);
  }

  if (process.env[product.apiUserVar] && process.env[product.apiKeyVar]) {
    console.log(
      `${product.apiUserVar} and ${product.apiKeyVar} are already set in .env.\n` +
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
    console.error(
      `  Failed to create API key (HTTP ${createKey.status}): ${await createKey.text()}`,
    );
    process.exit(1);
  }

  const { apiKey } = (await createKey.json()) as { apiKey: string };
  console.log('  API key generated (HTTP 201).');

  // Prove the credentials work against THIS product before asking anyone to
  // save them. A token minted from the collection path proves nothing about
  // whether disbursement will accept them.
  const basic = Buffer.from(`${apiUserId}:${apiKey}`).toString('base64');
  const token = await fetch(`${baseUrl}/${product.tokenPath}/token/`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Ocp-Apim-Subscription-Key': subscriptionKey,
    },
  });
  console.log(
    token.ok
      ? `  Verified: ${product.tokenPath} access token obtained (HTTP ${token.status}).`
      : `  WARNING: credentials created but ${product.tokenPath} token request ` +
        `returned HTTP ${token.status}. Check you used the ${product.label} key.`,
  );

  console.log('\nAdd these to apps/backend/.env:\n');
  console.log(`${product.apiUserVar}="${apiUserId}"`);
  console.log(`${product.apiKeyVar}="${apiKey}"`);
  console.log('\nThey do not expire. Regenerate only if the sandbox account is reset.\n');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
