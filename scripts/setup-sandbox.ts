// Set the private lab's configuration before importing modules that derive paths.
process.env.SATS_DATA_DIR ||= '.data/sandbox';
process.env.BITCOIN_RPC_PORT ||= '18444';
process.env.BITCOIN_ZMQ = '0';
// Core derives eight descriptor address pools for every new wallet. A small
// pool keeps classroom setup/reset responsive; Core still tops it up as needed.
process.env.BITCOIN_KEYPOOL_SIZE ||= '32';
await import('./setup-bitcoin.ts');
export {};
