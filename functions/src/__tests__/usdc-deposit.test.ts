import { getAddress, id, parseUnits, toBeHex, zeroPadValue } from 'ethers';
import { extractUsdcDepositFromLogs, type TransferLogLike, USDC_ON_BASE_MAINNET } from '../lib/usdc';

const TRANSFER_TOPIC = id('Transfer(address,address,uint256)');

function addressTopic(addr: string): string {
  return zeroPadValue(getAddress(addr), 32);
}

function makeTransferLog(params: {
  token: string;
  from: string;
  to: string;
  amountMicroUsdc: bigint;
}): TransferLogLike {
  const { token, from, to, amountMicroUsdc } = params;
  return {
    address: getAddress(token),
    data: toBeHex(amountMicroUsdc, 32),
    topics: [TRANSFER_TOPIC, addressTopic(from), addressTopic(to)],
  };
}

describe('extractUsdcDepositFromLogs', () => {
  const treasury = getAddress('0x1111111111111111111111111111111111111111');
  const sender = getAddress('0x2222222222222222222222222222222222222222');
  const usdc = getAddress(USDC_ON_BASE_MAINNET);

  test('extracts amount and sender from a USDC transfer to treasury', () => {
    const amount = parseUnits('12.345678', 6);
    const log = makeTransferLog({
      token: usdc,
      from: sender,
      to: treasury,
      amountMicroUsdc: amount,
    });
    const parsed = extractUsdcDepositFromLogs([log], treasury.toLowerCase(), usdc.toLowerCase());
    expect(parsed).toEqual({ usdcAmount: 12.345678, from: sender });
  });

  test('returns null when recipient is not treasury', () => {
    const other = getAddress('0x3333333333333333333333333333333333333333');
    const log = makeTransferLog({
      token: usdc,
      from: sender,
      to: other,
      amountMicroUsdc: parseUnits('1', 6),
    });
    expect(extractUsdcDepositFromLogs([log], treasury.toLowerCase(), usdc.toLowerCase())).toBeNull();
  });

  test('returns null for non-USDC contract', () => {
    const fakeToken = getAddress('0x4444444444444444444444444444444444444444');
    const log = makeTransferLog({
      token: fakeToken,
      from: sender,
      to: treasury,
      amountMicroUsdc: parseUnits('1', 6),
    });
    expect(extractUsdcDepositFromLogs([log], treasury.toLowerCase(), usdc.toLowerCase())).toBeNull();
  });

  test('returns null for empty logs', () => {
    expect(extractUsdcDepositFromLogs([], treasury.toLowerCase())).toBeNull();
  });
});
