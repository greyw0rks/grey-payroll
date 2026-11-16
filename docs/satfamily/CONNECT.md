# Sign in to GreyFinance with Connect

Connect must be enabled for the website before GreyFinance can use its Nostr signer. Installing the extension alone does not grant website access.

1. Open [GreyFinance](https://grey-finance.vercel.app/app) in the desktop browser where Connect is installed.
2. Click Connect in the browser toolbar and unlock your wallet.
3. In **Connections**, choose **Enable for current website**. Check the address is `https://grey-finance.vercel.app` and select **Allow** in the browser permission prompt.
4. Return to GreyFinance. It should show **Connect is available for this website**. Choose **Sign in with Connect**, review the website address in Connect, and approve **Sign request**.

GreyFinance detects Connect when it becomes available, including after the page has opened. **Check again** refreshes detection. Sign-in requests a signature only when you click; declining a request leaves you signed out. Each new attempt requires a fresh signature.

If you have another Nostr signer enabled, **Use another Nostr signer** deliberately chooses that identity. Selecting Connect does not fall back to a different identity. A different deployment URL needs its own website permission. Connect's current developer release supports desktop Chrome, Brave and Edge; the phone layouts are browser layout checks, not proof of mobile extension support.

[Install Connect](https://connect-wallet-vert.vercel.app/#install) if needed. The temporary identity option is under **Trying the product with a temporary identity?**. Its signing key stays in tab memory; use your persistent signer for an ongoing company account.

## Company wallet

Connect supplies Nostr identity authentication here. GreyFinance's company Lightning treasury connects separately through **Nostr Wallet Connect (NWC)** in Wallet settings. Connect 0.1.0 implements NIP-07 and WebLN; it does not expose an NWC wallet service. Signing in does not grant GreyFinance spending access to Connect.

## Reproduce the installed-extension check

Build Connect in a separate checkout. With Linux, Xvfb, Node 22 and Playwright Chromium installed, run from the GreyFinance repository:

```sh
CONNECT_CHECKOUT=/path/to/connect pnpm exec tsx scripts/verify-connect-browser.ts published
```

Use `SATS_CHROMIUM_PATH` when Chromium is installed elsewhere. The check creates an isolated browser profile and its own display, uses the actual Connect toolbar and native site-permission prompt, and exercises real signed login against the public Convex backend. It verifies decline, locked-wallet unlock, replay rejection, session persistence, temporary sign-in and desktop/390px/360px layouts. It never connects a company wallet, creates a company, requests an invoice or makes a payment. It logs out its disposable sessions and removes the isolated profile.

After `pnpm build -- greyfinance`, use `candidate` instead of `published` to test the local frontend build. This replaces only static frontend assets in the isolated browser; the canonical public backend still verifies all authentication. `baseline` verifies the preceding frontend and preserves its historical evidence. Reports contain results and public runtime hashes; authorization events, cookies, passwords and recovery words are not saved.
