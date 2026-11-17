import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const origin = process.env.SANDBOX_UI_ORIGIN || "http://127.0.0.1:4404";
const url = new URL(origin);
const hosted = process.env.SANDBOX_UI_ALLOW_HOSTED === "1";
if (
  hosted
    ? url.protocol !== "https:" || url.hostname !== "grey-finance.vercel.app"
    : !["127.0.0.1", "localhost"].includes(url.hostname) || url.protocol !== "http:"
)
  throw new Error(
    "This builder-controlled UI verification only runs against a local regtest lab.",
  );
const output = resolve(process.env.SANDBOX_UI_OUTPUT || "apps/sandbox/.qa");
const appPath = hosted ? "/sandbox/" : "/";
mkdirSync(output, { recursive: true });
writeFileSync(resolve(output, ".gitignore"), "*\n");
const report = {
  startedAt: new Date().toISOString(),
  origin,
  classification:
    `builder-controlled Chromium ${hosted ? "hosted Convex" : "local Core"} regtest UI test; no monetary value or independent adoption`,
  sourceHashes: Object.fromEntries(
    ["App.tsx", "api.ts", "components.tsx", "content.ts", "styles.css"].map(
      (file) => [
        file,
        createHash("sha256")
          .update(readFileSync(resolve("apps/sandbox/src", file)))
          .digest("hex"),
      ],
    ),
  ),
  checks: [],
  captures: [],
  pageErrors: [],
  broadcasts: [],
  complete: false,
};
function check(name, value) {
  report.checks.push({ name, pass: Boolean(value) });
  assert.ok(value, name);
}
const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
    : {}),
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  acceptDownloads: true,
});
const page = await context.newPage();
page.on("pageerror", (error) => report.pageErrors.push(error.message));
page.on("request", (request) => {
  if (
    request.method() === "POST" &&
    new URL(request.url()).pathname === "/api/sandbox/broadcast"
  )
    report.broadcasts.push({ at: new Date().toISOString() });
});
async function capture(name) {
  const file = resolve(output, name + ".png");
  const metrics = await page.evaluate(() => ({
    width: innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    h1: document.querySelector("h1")?.innerText,
    noOverflow: document.documentElement.scrollWidth <= innerWidth,
  }));
  await page.screenshot({ path: file, fullPage: true });
  report.captures.push({ name, file, ...metrics });
  check(name + ": no horizontal overflow", metrics.noOverflow);
}
async function nav(name) {
  const phone = (page.viewportSize()?.width || 1440) <= 700;
  await page
    .getByRole("navigation", {
      name: phone ? "Phone navigation" : "Main navigation",
      exact: true,
    })
    .getByRole("link", { name, exact: true })
    .click();
}
async function state() {
  const result = await page.request.get(origin + "/api/sandbox/state");
  check("Owned lab state is readable", result.ok());
  return result.json();
}
async function createPreview() {
  const response = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/sandbox/preview" &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: /^(Create|Rebuild) preview$/ })
    .click();
  const result = await response;
  check("Preview is prepared by Core", result.status() === 201);
  return result.json();
}
async function openReview() {
  await page
    .getByRole("button", { name: "Review and broadcast", exact: true })
    .click();
  await page.getByRole("dialog").waitFor();
}
async function reviewAndBroadcast() {
  await openReview();
  const dialog = page.getByRole("dialog");
  check(
    "Broadcast requires deliberate review",
    await dialog
      .getByRole("button", { name: "Broadcast transaction", exact: true })
      .isDisabled(),
  );
  await dialog.getByRole("checkbox").check();
  await dialog
    .getByRole("button", { name: "Broadcast transaction", exact: true })
    .click();
}
async function complete(id, txid, outputIndex) {
  await nav("Experiments");
  const row = page
    .locator(".experiment-row")
    .filter({
      has: page.getByRole("heading", {
        name:
          id === "first-transaction"
            ? "Your first transaction"
            : id === "utxos"
              ? "Follow the change"
              : "From mempool to block",
        exact: true,
      }),
    });
  await row
    .getByRole("button", { name: "Start experiment", exact: true })
    .click();
  await page.locator("#experiment-transaction").selectOption(txid);
  if (id === "utxos")
    await page.locator("#change-output-index").fill(String(outputIndex));
  await page
    .getByRole("button", { name: "Verify experiment", exact: true })
    .click();
  await page.locator(".experiment-receipt").waitFor();
  check(
    id + ": backend-verified completion",
    await page
      .locator(".experiment-receipt")
      .getByText("Core verified", { exact: true })
      .isVisible(),
  );
}

try {
  await page.goto(origin + appPath + "#lab", { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  const node = await (
    await page.request.get(origin + "/api/sandbox/status")
  ).json();
  check(
    "Actual Core regtest node is ready",
    node.ready && node.network === "regtest",
  );
  await page.locator(".account-button").click();
  await page.locator(".temporary-options summary").click();
  await page
    .getByRole("button", { name: "Create temporary identity", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  check(
    "Temporary identity uses a real signed session",
    (await (await page.request.get(origin + "/api/session")).json()).user
      ?.demo === false,
  );
  await page.getByRole("button", { name: "Create lab", exact: true }).click();
  await page.locator(".wallet-card").first().waitFor();
  const initial = await state();
  check("Two real wallets are created", initial.wallets.length === 2);
  check(
    "Both wallets start with valueless regtest sats",
    initial.wallets.every((wallet) => wallet.balanceSats === 1000000),
  );
  report.runId = initial.runId;
  await page.locator(".utxo-node").first().click();
  check(
    "Selecting a real UTXO reveals its output index",
    await page
      .locator(".output-inspector")
      .getByText("Output index", { exact: true })
      .isVisible(),
  );
  await capture("desktop-live-lab");
  await nav("Build");
  await page.locator("#send-amount").fill("20000");
  const preview = await createPreview();
  check(
    "Input values conserve payment, change and fee",
    preview.inputs.reduce((sum, item) => sum + item.amountSats, 0) ===
      preview.outputs.reduce((sum, item) => sum + item.amountSats, 0) +
        preview.feeSats,
  );
  await page.locator(".payment-node").click();
  check(
    "Anatomy inspection explains payment output",
    await page
      .locator(".anatomy-explanation")
      .getByText("The payment becomes a new output.", { exact: true })
      .isVisible(),
  );
  await capture("desktop-live-preview");
  await openReview();
  await capture("desktop-broadcast-review");
  await page.keyboard.press("Escape");
  check(
    "Escape closes the protected review",
    (await page.getByRole("dialog").count()) === 0,
  );
  await reviewAndBroadcast();
  await page.locator(".broadcast-success").waitFor();
  let current = await state();
  const tx = current.wallets
    .flatMap((wallet) => wallet.transactions)
    .find((transaction) => transaction.type === "send");
  check("The UI broadcast produced a Core transaction", Boolean(tx?.txid));
  report.firstTransaction = {
    txid: tx.txid,
    amountSats: 20000,
    feeSats: preview.feeSats,
    network: "regtest",
  };
  await page
    .locator(".broadcast-success")
    .getByRole("button", { name: "Inspect transaction", exact: true })
    .click();
  await page.locator(".transaction-detail").waitFor();
  check(
    "Explorer reports pending state before mining",
    await page
      .locator(".transaction-facts")
      .getByText("In mempool", { exact: true })
      .isVisible(),
  );
  await page.locator("#ledger-wallet").selectOption("beta");
  check(
    "Receiving-wallet filter includes the shared transaction",
    await page
      .getByRole("button", {
        name: "Inspect transaction " + tx.txid,
        exact: true,
      })
      .isVisible(),
  );
  await page.locator("#ledger-wallet").selectOption("all");
  await capture("desktop-pending-transaction");
  await page
    .locator(".pending-transaction-note")
    .getByRole("button", { name: "Mine 1 block", exact: true })
    .click();
  await page
    .locator(".transaction-facts")
    .getByText("In a block", { exact: true })
    .waitFor();
  check(
    "Core confirmation appears after mining",
    await page.locator(".block-proof").isVisible(),
  );
  await capture("desktop-confirmed-transaction");
  await complete("first-transaction", tx.txid);
  await complete(
    "utxos",
    tx.txid,
    preview.outputs.find((output) => output.type === "change").index,
  );
  await complete("confirmations", tx.txid);
  current = await state();
  check(
    "All three experiments have verified backend records",
    current.progress.experiments.every((item) => item.completed),
  );
  await page
    .getByRole("button", { name: "Open lab settings", exact: true })
    .click();
  await page.locator("#display-name").fill("Sandbox UI explorer");
  await page.locator("#display-unit").selectOption("btc");
  await page
    .getByRole("checkbox", { name: /Refresh the lab automatically/ })
    .uncheck();
  await page.getByRole("checkbox", { name: /Reduce interface motion/ }).check();
  await page
    .getByRole("button", { name: "Save preferences", exact: true })
    .click();
  await page.getByText("Lab preferences saved.", { exact: true }).waitFor();
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("Signed in · Bitcoin Core regtest", { exact: true }).waitFor();
  check(
    "Display preferences persist after reload",
    (await page.locator("#display-unit").inputValue()) === "btc",
  );
  check(
    "Reload clearly reports temporary signing-key loss",
    await page
      .getByText(/Reloading lost this temporary signing key/)
      .isVisible(),
  );
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download lab record", exact: true })
    .click();
  const recordFile = resolve(output, "owned-lab-record.json");
  await (await download).saveAs(recordFile);
  const exported = JSON.parse(readFileSync(recordFile, "utf8"));
  check(
    "Export contains verified receipts",
    exported.receipts.some(
      (receipt) => receipt.txid === tx.txid && receipt.state === "broadcast",
    ),
  );
  check(
    "Export omits signing material",
    !/"(?:psbt|signed_hex|signedHex|privateKey|secretKey|rpcpassword)"\s*:/.test(
      JSON.stringify(exported),
    ),
  );
  await page
    .getByRole("button", { name: "Reset wallet run", exact: true })
    .click();
  check(
    "Reset requires exact confirmation text",
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Reset wallet run", exact: true })
      .isDisabled(),
  );
  await page.locator("#reset-confirmation").fill("RESET");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Reset wallet run", exact: true })
    .click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  current = await state();
  check(
    "Reset creates a fresh wallet run",
    current.runId !== initial.runId &&
      current.wallets.every((wallet) => wallet.balanceSats === 1000000),
  );
  check(
    "Reset retains verified experiment records",
    current.progress.experiments.every((item) => item.completed),
  );
  await nav("Build");
  await page.locator("#send-amount").fill("10000");
  const recoveryPreview = await createPreview();
  const beforeRecovery = report.broadcasts.length;
  let acceptedTxid;
  await page.route("**/api/sandbox/broadcast", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    acceptedTxid = body.txid;
    await route.abort("failed");
  });
  await reviewAndBroadcast();
  await page.locator(".recovery-panel").waitFor();
  check(
    "Lost response shows a recovery action",
    await page
      .getByRole("button", { name: "Check transaction status", exact: true })
      .isVisible(),
  );
  check(
    "Uncertain state blocks a new payment preview",
    await page
      .getByRole("button", { name: "Create preview", exact: true })
      .isDisabled(),
  );
  check(
    "Uncertain state keeps exact payment fields fixed",
    await page.locator("#send-amount").isDisabled() &&
      await page.locator("#fee-rate").isDisabled() &&
      await page.locator("#from-wallet").isDisabled() &&
      await page.locator("#to-wallet").isDisabled(),
  );
  await capture("desktop-lost-response");
  await page.unroute("**/api/sandbox/broadcast");
  await page
    .getByRole("button", { name: "Check transaction status", exact: true })
    .click();
  await page.locator(".broadcast-success").waitFor();
  check(
    "Recovery reads the original accepted transaction",
    acceptedTxid &&
      (
        await (
          await page.request.get(
            origin + "/api/sandbox/previews/" + recoveryPreview.id,
          )
        ).json()
      ).txid === acceptedTxid,
  );
  check(
    "Recovery does not resend the transaction",
    report.broadcasts.length - beforeRecovery === 1,
  );
  report.recoveryTransaction = {
    txid: acceptedTxid,
    amountSats: 10000,
    network: "regtest",
    extraBroadcasts: 0,
  };
  await page.reload({ waitUntil: "networkidle" });
  await page.locator(".broadcast-success").waitFor();
  check(
    "Reload restores the accepted attempt from safe metadata",
    await page.locator(".broadcast-success").isVisible(),
  );
  check(
    "Reload performs no extra broadcast",
    report.broadcasts.length - beforeRecovery === 1,
  );
  check(
    "Reload restores exact accepted payment details",
    (await page.locator("#send-amount").inputValue()) === "10000" &&
      (await page.locator("#fee-rate").inputValue()) === String(recoveryPreview.feeRate) &&
      (await page.locator("#from-wallet").inputValue()) === recoveryPreview.from &&
      (await page.locator("#to-wallet").inputValue()) === recoveryPreview.to,
  );
  for (const viewport of [
    ...(hosted ? [{ width: 1024, height: 900 }] : []),
    { width: 390, height: 844 },
    { width: 360, height: 800 },
  ]) {
    await page.setViewportSize(viewport);
    for (const [name, route] of [
      ["lab", "Laboratory"],
      ["builder", "Build"],
      ["explorer", "Explorer"],
      ["experiments", "Experiments"],
    ]) {
      await nav(route);
      await capture(`${viewport.width}-${name}`);
    }
    await page
      .getByRole("button", { name: "Open lab settings", exact: true })
      .click();
    await capture(`${viewport.width}-settings`);
  }
  await nav("Build");
  await page.locator("#send-amount").fill("11000");
  check(
    "Editing a new payment clears the previous review",
    (await page.locator(".broadcast-success").count()) === 0 &&
      (await page.locator(".anatomy").count()) === 0,
  );
  check(
    "Editing payment details does not broadcast",
    report.broadcasts.length - beforeRecovery === 1,
  );
  report.complete = true;
  check("No unhandled page errors", report.pageErrors.length === 0);
} catch (error) {
  report.error = error.message;
  await page
    .screenshot({ path: resolve(output, "failure.png"), fullPage: true })
    .catch(() => {});
  process.exitCode = 1;
} finally {
  if (hosted) {
    try { await page.request.post(origin + "/api/session/logout", { data: {} }); }
    catch { report.sessionCleanup = "A disposable builder session may need cleanup."; }
  }
  report.finishedAt = new Date().toISOString();
  writeFileSync(
    resolve(output, "ui-verification.json"),
    JSON.stringify(report, null, 2),
  );
  await browser.close();
  console.log(
    JSON.stringify(
      {
        complete: report.complete,
        checks: report.checks.length,
        failures: report.checks.filter((check) => !check.pass),
        captures: report.captures.length,
        pageErrors: report.pageErrors,
        error: report.error,
        report: resolve(output, "ui-verification.json"),
      },
      null,
      2,
    ),
  );
}
