/**
 * Real-money USDC settlement is gated by an env flag. Managed (telarchy.com)
 * runs with this off so the legal posture is "play-money simulation"; self-hosted
 * and enterprise instances flip it on to enable USDC deposits and withdrawals.
 */
export function isUsdcSettlementEnabled(): boolean {
  return process.env.USDC_SETTLEMENT_ENABLED === 'true';
}
