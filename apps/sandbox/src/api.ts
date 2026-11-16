import {
  waitForSigner,
  type Signer,
} from "../../../packages/academy/src/signers";

export type User = { id: string; pubkey: string; demo: boolean };
export type WalletId = "alpha" | "beta";
export type Utxo = {
  txid: string;
  vout: number;
  address: string;
  amountSats: number;
  confirmations: number;
  spendable: boolean;
};
export type WalletTransaction = {
  txid: string;
  type: string;
  amountSats: number;
  feeSats: number;
  confirmations: number;
  at: number;
};
export type LabWallet = {
  id: WalletId;
  name: string;
  address: string;
  balanceSats: number;
  pendingSats: number;
  utxos: Utxo[];
  transactions: WalletTransaction[];
};
export type LabSnapshot = {
  ready: boolean;
  network: "regtest";
  runId: string;
  blockHeight: number;
  bestBlockHash: string;
  mempool: { count: number; bytes: number };
  wallets: LabWallet[];
  createdAt: number;
  valueNotice: string;
};
export type TransactionPreview = {
  id: string;
  from: WalletId;
  to: WalletId;
  amountSats: number;
  feeSats: number;
  feeRate: number;
  estimatedVbytes: number;
  replaceable: boolean;
  expiresAt: number;
  inputs: Array<{ txid: string; vout: number; amountSats: number }>;
  outputs: Array<{
    index: number;
    address: string;
    amountSats: number;
    type: "payment" | "change";
  }>;
};
export type PreviewStatus = TransactionPreview & {
  state:
    "prepared" | "signing" | "unknown" | "broadcast" | "expired" | "failed";
  txid?: string | null;
  snapshot?: LabSnapshot;
};
export type DecodedTransaction = {
  txid: string;
  hash?: string;
  version?: number;
  size?: number;
  vsize: number;
  weight?: number;
  locktime?: number;
  confirmations?: number;
  blockhash?: string;
  ownedPreview?: TransactionPreview;
  vin: Array<{
    txid?: string;
    vout?: number;
    sequence?: number;
    coinbase?: string;
  }>;
  vout: Array<{
    n: number;
    value: number;
    scriptPubKey: { address?: string; type: string; hex?: string };
  }>;
};
export type Preferences = {
  displayName: string;
  unit: "sats" | "btc";
  autoRefresh: boolean;
  defaultFeeRate: number;
  reduceMotion: boolean;
};
export type ExperimentId = "first-transaction" | "utxos" | "confirmations";
export type Progress = {
  experiments: Array<{
    id: ExperimentId;
    completed: boolean;
    completedAt: number | null;
    txid?: string;
  }>;
  stats?: { runs: number; broadcasts: number; minedBlocks: number };
};
export const defaultPreferences: Preferences = {
  displayName: "Explorer",
  unit: "sats",
  autoRefresh: true,
  defaultFeeRate: 2,
  reduceMotion: false,
};
export const emptyProgress: Progress = {
  experiments: [],
  stats: { runs: 0, broadcasts: 0, minedBlocks: 0 },
};

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code = "REQUEST_FAILED",
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const controller = new AbortController();
  const signal = options.signal;
  const cancel = () => controller.abort();
  if (signal?.aborted) cancel();
  else signal?.addEventListener("abort", cancel, { once: true });
  const timer = window.setTimeout(cancel, 30000);
  try {
    const response = await fetch(path, {
      ...options,
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", ...options.headers },
    });
    let body: Record<string, unknown>;
    try {
      body = await response.json();
    } catch {
      throw new ApiError(
        "The lab service returned an incomplete response. Refresh its status before trying again.",
        response.status || 0,
        "INVALID_RESPONSE",
      );
    }
    if (!response.ok)
      throw new ApiError(
        typeof body.message === "string"
          ? body.message
          : typeof body.error === "string"
            ? body.error
            : "The lab could not complete that action. Please try again.",
        response.status,
        typeof body.code === "string"
          ? body.code
          : typeof body.error === "string"
            ? body.error
            : "REQUEST_FAILED",
      );
    return body as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (controller.signal.aborted)
      throw new ApiError(
        "The lab did not respond in time. Check the transaction status before repeating a broadcast.",
        0,
        "TIMEOUT",
      );
    throw new ApiError(
      "The lab connection was interrupted. Check your connection and refresh the lab status.",
      0,
      "UNAVAILABLE",
    );
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}
export const post = <T>(path: string, value: unknown = {}) =>
  api<T>(path, { method: "POST", body: JSON.stringify(value) });
export const patch = <T>(path: string, value: unknown) =>
  api<T>(path, { method: "PATCH", body: JSON.stringify(value) });

let temporarySecret: Uint8Array | null = null;

async function authenticate(signer: Signer, signal?: AbortSignal) {
  const path = "/api/auth/nostr";
  const body = "{}";
  const hash = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body)),
  );
  const payload = Array.from(hash, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  if (signal?.aborted)
    throw new DOMException("Sign-in was cancelled.", "AbortError");
  const event = await signer.signEvent({
    kind: 27235,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["u", `${window.location.origin}${path}`],
      ["method", "POST"],
      ["payload", payload],
      ["nonce", crypto.randomUUID()],
    ],
    content: "",
  });
  if (signal?.aborted)
    throw new DOMException("Sign-in was cancelled.", "AbortError");
  const encoded = btoa(
    Array.from(new TextEncoder().encode(JSON.stringify(event)), (byte) =>
      String.fromCharCode(byte),
    ).join(""),
  );
  return api<{ user: User }>(path, {
    method: "POST",
    body,
    signal,
    headers: { Authorization: `Nostr ${encoded}` },
  });
}
export async function signInWithNostr(signal?: AbortSignal) {
  const response = await authenticate(await waitForSigner(signal), signal);
  clearTemporaryIdentity();
  return response;
}
export async function signInTemporarily() {
  const { finalizeEvent, generateSecretKey } = await import("nostr-tools");
  const key = temporarySecret ?? generateSecretKey();
  try {
    const response = await authenticate({
      signEvent: async (event) => finalizeEvent(event, key),
    });
    temporarySecret = key;
    try {
      sessionStorage.setItem(
        "sandbox-temporary-identity",
        response.user.pubkey,
      );
    } catch {
      /* Only optional public metadata is persisted. */
    }
    return response;
  } catch (error) {
    key.fill(0);
    temporarySecret = null;
    throw error;
  }
}
export function isTemporaryIdentity(pubkey?: string) {
  if (temporarySecret) return true;
  try {
    return Boolean(
      pubkey && sessionStorage.getItem("sandbox-temporary-identity") === pubkey,
    );
  } catch {
    return false;
  }
}
export const hasTemporaryKey = () => temporarySecret !== null;
export function clearTemporaryIdentity() {
  temporarySecret?.fill(0);
  temporarySecret = null;
  try {
    sessionStorage.removeItem("sandbox-temporary-identity");
  } catch {
    /* No signing key was persisted. */
  }
}
export function shortHash(value: string, length = 8) {
  return value.length > length * 2 + 1
    ? `${value.slice(0, length)}…${value.slice(-length)}`
    : value;
}
export function formatSats(value: number) {
  return new Intl.NumberFormat("en").format(value);
}
export function amount(value: number, unit: Preferences["unit"] = "sats") {
  return unit === "btc" ? (value / 100000000).toFixed(8) : formatSats(value);
}
export function unitLabel(unit: Preferences["unit"]) {
  return unit === "btc" ? "test BTC" : "sats";
}
export function dateTime(at: number) {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(at);
}
