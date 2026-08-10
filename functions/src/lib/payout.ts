/**
 * Structured payment methods (owner direction 2026-08-10: one free-text
 * handle was too broad; support entering different providers).
 *
 * A method is { provider, ...fields }, validated per provider so the
 * owner can actually pay against what is stored: a mistyped IBAN or a
 * malformed address fails at entry, not at payout time. The account
 * stores the structured object (agents.payout_method) plus a derived
 * human-readable summary (agents.payout_handle) that proposal snapshots
 * and the owner's payout view read; the summary is never written
 * directly when a structured method exists.
 *
 * Providers carried today: PayPal, bank transfer (IBAN), crypto
 * (Ethereum / Bitcoin / Solana), Revolut, Wise, and a validated
 * free-text "other" as the escape hatch for anything not listed.
 */

export type PayoutMethod =
  | { provider: 'paypal'; email: string }
  | { provider: 'bank'; iban: string; holder: string }
  | { provider: 'crypto'; network: 'ethereum' | 'bitcoin' | 'solana'; address: string }
  | { provider: 'revolut'; handle: string }
  | { provider: 'wise'; email: string }
  | { provider: 'other'; details: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** ISO 13616 shape plus the real mod-97 checksum, so typos die at entry. */
export function isValidIban(raw: string): boolean {
  const iban = raw.replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const part = ch >= 'A' ? String(ch.charCodeAt(0) - 55) : ch;
    for (const digit of part) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}

const CRYPTO_ADDRESS: Record<string, RegExp> = {
  // EIP-55 casing is not enforced: an all-lower or all-upper address is
  // valid on chain, and rejecting it would refuse real addresses.
  ethereum: /^0x[0-9a-fA-F]{40}$/,
  // Legacy base58 (1/3) and bech32 (bc1) mainnet shapes.
  bitcoin: /^(bc1[02-9ac-hj-np-z]{11,87}|[13][1-9A-HJ-NP-Za-km-z]{25,34})$/,
  solana: /^[1-9A-HJ-NP-Za-km-z]{32,44}$/,
};

export const PAYOUT_PROVIDERS = ['paypal', 'bank', 'crypto', 'revolut', 'wise', 'other'] as const;
export const CRYPTO_NETWORKS = ['ethereum', 'bitcoin', 'solana'] as const;

/**
 * Validate an incoming method object. Returns the normalized method, or
 * an Error naming exactly what is wrong (surfaced verbatim to the form).
 */
export function normalizePayoutMethod(input: unknown): PayoutMethod | Error {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return new Error('payoutMethod must be an object like { provider, ...fields }');
  }
  const m = input as Record<string, unknown>;
  const provider = m.provider;
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

  switch (provider) {
    case 'paypal': {
      const email = str(m.email);
      if (!EMAIL.test(email) || email.length > 200) return new Error('Enter the email of your PayPal account');
      return { provider, email };
    }
    case 'bank': {
      const iban = str(m.iban).replace(/\s+/g, '').toUpperCase();
      const holder = str(m.holder);
      if (!isValidIban(iban)) return new Error('That IBAN does not check out; copy it exactly from your bank');
      if (holder.length < 2 || holder.length > 100) return new Error('Enter the account holder name, as the bank knows it');
      return { provider, iban, holder };
    }
    case 'crypto': {
      const network = str(m.network) as 'ethereum' | 'bitcoin' | 'solana';
      const address = str(m.address);
      if (!CRYPTO_NETWORKS.includes(network)) return new Error('Pick a network: Ethereum, Bitcoin, or Solana');
      if (!CRYPTO_ADDRESS[network].test(address)) return new Error(`That does not look like a ${network} address`);
      return { provider, network, address };
    }
    case 'revolut': {
      const handle = str(m.handle).replace(/^@/, '');
      if (!/^[A-Za-z0-9_]{3,32}$/.test(handle) && !/^\+?\d{7,15}$/.test(handle)) {
        return new Error('Enter your Revtag (like @john1abc) or the phone number on the account');
      }
      return { provider, handle };
    }
    case 'wise': {
      const email = str(m.email);
      if (!EMAIL.test(email) || email.length > 200) return new Error('Enter the email of your Wise account');
      return { provider, email };
    }
    case 'other': {
      const details = str(m.details);
      if (details.length < 5) return new Error('Describe how to pay you, at least a few words');
      if (details.length > 200) return new Error('Keep it under 200 characters');
      return { provider, details };
    }
    default:
      return new Error('provider must be one of: paypal, bank, crypto, revolut, wise, other');
  }
}

/** The human-readable summary the owner pays against. */
export function payoutSummary(method: PayoutMethod): string {
  switch (method.provider) {
    case 'paypal': return `PayPal: ${method.email}`;
    case 'bank': return `Bank (IBAN): ${method.iban}, holder ${method.holder}`;
    case 'crypto': {
      const net = method.network[0].toUpperCase() + method.network.slice(1);
      return `Crypto (${net}): ${method.address}`;
    }
    case 'revolut': return `Revolut: @${method.handle}`;
    case 'wise': return `Wise: ${method.email}`;
    case 'other': return method.details;
  }
}
