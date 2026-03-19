import { JsonRpcProvider, Wallet, Contract, parseUnits, formatUnits, isAddress, getAddress } from 'ethers';
import { AppError } from './errors';

// Native USDC on Base (Circle-issued, 6 decimals)
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const USDC_DECIMALS = 6;
const BASE_RPC = 'https://mainnet.base.org';

const ERC20_ABI = [
  'function transfer(address to, uint256 value) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
];

function getTreasuryWallet(): Wallet {
  const pk = process.env.TREASURY_PRIVATE_KEY;
  if (!pk) throw new AppError('TREASURY_PRIVATE_KEY is not configured', 500);
  const provider = new JsonRpcProvider(BASE_RPC);
  return new Wallet(pk, provider);
}

export function validateWalletAddress(address: string): string {
  if (!isAddress(address)) throw new AppError('Invalid EVM wallet address', 400);
  return getAddress(address); // checksum form
}

/** Sends USDC on Base from the treasury wallet. Returns the tx hash. */
export async function sendUsdc(to: string, usdcAmount: number): Promise<string> {
  const wallet = getTreasuryWallet();
  const usdc = new Contract(USDC_ADDRESS, ERC20_ABI, wallet);
  const value = parseUnits(usdcAmount.toFixed(USDC_DECIMALS), USDC_DECIMALS);
  const tx = await usdc.transfer(getAddress(to), value);
  return tx.hash as string;
}

/** Returns treasury USDC balance on Base in decimal form (e.g. 100.50). */
export async function getTreasuryUsdcBalance(): Promise<number> {
  const wallet = getTreasuryWallet();
  const usdc = new Contract(USDC_ADDRESS, ERC20_ABI, wallet.provider!);
  const raw = await usdc.balanceOf(wallet.address);
  return Number(formatUnits(raw, USDC_DECIMALS));
}

export function getTreasuryAddress(): string {
  const pk = process.env.TREASURY_PRIVATE_KEY;
  if (!pk) throw new AppError('TREASURY_PRIVATE_KEY is not configured', 500);
  return new Wallet(pk).address;
}
