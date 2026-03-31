import { JsonRpcProvider, Wallet, Contract, parseUnits, formatUnits, isAddress, getAddress, id as ethersId, formatEther } from 'ethers';
import { AppError } from './errors';

// Native USDC on Base (Circle-issued, 6 decimals)
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const USDC_DECIMALS = 6;
const BASE_RPC = 'https://mainnet.base.org';

const ERC20_ABI = [
  'function transfer(address to, uint256 value) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
];

function readTreasuryPrivateKey(): string {
  const pk = process.env.TREASURY_PRIVATE_KEY?.trim();
  if (!pk) throw new AppError('TREASURY_PRIVATE_KEY is not configured', 500);
  return pk;
}

export function assertTreasuryConfigured(): void {
  const pk = readTreasuryPrivateKey();
  try {
    new Wallet(pk);
  } catch (error) {
    throw new AppError('TREASURY_PRIVATE_KEY is invalid', 500);
  }
}

function getTreasuryWallet(): Wallet {
  const pk = readTreasuryPrivateKey();
  assertTreasuryConfigured();
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

export interface TreasuryBalances {
  usdcBalance: number;
  ethBalance: number;
  address: string;
}

/** Returns treasury USDC and ETH balances on Base. */
export async function getTreasuryBalances(): Promise<TreasuryBalances> {
  const wallet = getTreasuryWallet();
  const provider = wallet.provider!;
  const usdc = new Contract(USDC_ADDRESS, ERC20_ABI, provider);
  const [usdcRaw, ethRaw] = await Promise.all([
    usdc.balanceOf(wallet.address),
    provider.getBalance(wallet.address),
  ]);
  return {
    address: wallet.address,
    usdcBalance: Number(formatUnits(usdcRaw, USDC_DECIMALS)),
    ethBalance: Number(formatEther(ethRaw)),
  };
}

export function getTreasuryAddress(): string {
  const pk = readTreasuryPrivateKey();
  assertTreasuryConfigured();
  return new Wallet(pk).address;
}

const TRANSFER_TOPIC = ethersId('Transfer(address,address,uint256)');

export interface DepositVerification {
  usdcAmount: number;
  from: string;
}

/**
 * Verifies that a tx hash represents a USDC transfer to the treasury on Base.
 * Throws AppError if the tx is not found, not confirmed, or not a valid deposit.
 */
export async function verifyUsdcDeposit(txHash: string): Promise<DepositVerification> {
  const provider = new JsonRpcProvider(BASE_RPC);
  const receipt = await provider.getTransactionReceipt(txHash);

  if (!receipt) throw new AppError('Transaction not found or not yet confirmed', 400);
  if (receipt.status !== 1) throw new AppError('Transaction failed on-chain', 400);

  const treasuryAddr = getTreasuryAddress().toLowerCase();

  const log = receipt.logs.find(l =>
    l.address.toLowerCase() === USDC_ADDRESS.toLowerCase() &&
    l.topics[0] === TRANSFER_TOPIC &&
    l.topics.length === 3 &&
    `0x${l.topics[2].slice(26)}`.toLowerCase() === treasuryAddr,
  );

  if (!log) throw new AppError('Transaction does not contain a USDC transfer to the treasury', 400);

  const usdcAmount = Number(formatUnits(BigInt(log.data), USDC_DECIMALS));
  const from = getAddress(`0x${log.topics[1].slice(26)}`);

  return { usdcAmount, from };
}
