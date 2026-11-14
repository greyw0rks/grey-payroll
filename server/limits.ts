import { GateError } from '../packages/nwc-gate/src/types.ts';

export function paymentLimitSats() {
  const value = Number(process.env.SATS_MAX_PAYMENT_SATS ?? 1_000_000);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new GateError('SERVER_CONFIGURATION', 'The server payment limit is not configured correctly.', 503);
  }
  return value;
}

export function assertPaymentAmount(amountSats: number) {
  if (!Number.isSafeInteger(amountSats) || amountSats <= 0) {
    throw new GateError('INVALID_AMOUNT', 'Choose a valid payment amount.');
  }
  if (amountSats > paymentLimitSats()) {
    throw new GateError('PAYMENT_LIMIT', 'This payment exceeds the configured per-payment limit.', 403);
  }
}
