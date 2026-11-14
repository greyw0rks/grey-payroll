import { decode } from 'light-bolt11-decoder';
import { GateError } from './types.ts';

export function parseBolt11(input: string) {
  try {
    if (typeof input !== 'string' || input.length > 12000) throw new Error();
    const bolt11 = input.trim().replace(/^lightning:/i, '');
    const invoice = decode(bolt11);
    const value = (name: string) => invoice.sections.find(section => section.name === name && 'value' in section) as { value?: unknown } | undefined;
    const msats = BigInt(String(value('amount')?.value ?? '0'));
    if (msats <= 0n || msats % 1000n !== 0n || msats > BigInt(Number.MAX_SAFE_INTEGER) * 1000n) throw new Error();
    const paymentHash = String(value('payment_hash')?.value ?? '');
    if (!/^[0-9a-f]{64}$/i.test(paymentHash)) throw new Error();
    const timestamp = Number(value('timestamp')?.value);
    const expirySeconds = Number(value('expiry')?.value ?? 3600);
    if (!Number.isSafeInteger(timestamp) || !Number.isSafeInteger(expirySeconds) || expirySeconds < 1) throw new Error();
    const networkSection = invoice.sections.find(section => section.name === 'coin_network');
    const prefix = networkSection && 'letters' in networkSection ? networkSection.letters : '';
    const network = ({ bc: 'bitcoin', tb: 'testnet', tbs: 'signet', bcrt: 'regtest', sb: 'simnet' } as Record<string, string>)[prefix] ?? prefix;
    return { bolt11, paymentHash: paymentHash.toLowerCase(), amountSats: Number(msats / 1000n), expiresAt: (timestamp + expirySeconds) * 1000, network, description: String(value('description')?.value ?? '') };
  } catch {
    throw new GateError('INVALID_INVOICE', 'Paste a valid, fixed-amount BOLT11 Lightning invoice.');
  }
}
