// Set the private lab's configuration before importing modules that derive paths.
process.env.SATS_DATA_DIR ||= '.data/sandbox';
process.env.BITCOIN_RPC_PORT ||= '18444';
process.env.BITCOIN_ZMQ = '0';
await import('./setup-bitcoin.ts');
export {};
