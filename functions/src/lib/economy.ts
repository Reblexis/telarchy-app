/**
 * Pure helpers for credit issuance from USDC deposits (no chain I/O).
 */

export function depositBuyRateUsd(creditValueUsd: number, buyFeePercent: number): number {
  return creditValueUsd * (1 + buyFeePercent / 100);
}

/** Credits minted for a verified USDC amount, using the same formula as POST /api/agents/:id/deposit. */
export function creditsIssuedForUsdcDeposit(usdcAmount: number, creditValueUsd: number, buyFeePercent: number): number {
  const buyRate = depositBuyRateUsd(creditValueUsd, buyFeePercent);
  return Math.floor(usdcAmount / buyRate);
}
