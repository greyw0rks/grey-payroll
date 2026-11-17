import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

// This renderer only reads accepted screenshots and renders static composition.
// It never visits the running application, opens a port or performs wallet work.
const root = fileURLToPath(new URL("../../../", import.meta.url));
const submission = resolve(root, "docs/sandbox/submission");
const media = resolve(submission, "media");
const raw = resolve(media, "sources");
const manifestPath = resolve(submission, "MEDIA-MANIFEST.json");
const sourceQa = resolve(root, "apps/sandbox/.qa");
const validationMode =
  process.argv.includes("--validate") ||
  process.argv.includes("--record-review");
const width = 1500;
const height = 1000;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const repoPath = (path) => relative(root, path).replaceAll("\\", "/");
const escape = (text) =>
  String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
const px = (value) => `${Number(value.toFixed(3))}px`;
function pngInfo(bytes) {
  assert.equal(
    bytes.subarray(0, 8).toString("hex"),
    "89504e470d0a1a0a",
    "PNG signature",
  );
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    bytes: bytes.length,
    sha256: sha256(bytes),
  };
}
if (!validationMode) mkdirSync(raw, { recursive: true });
const reportCopy = resolve(raw, "ui-verification.json");
if (!existsSync(reportCopy) && !validationMode)
  copyFileSync(resolve(sourceQa, "ui-verification.json"), reportCopy);
const verification = JSON.parse(readFileSync(reportCopy, "utf8"));
assert.ok(
  verification.complete && verification.checks.every((check) => check.pass),
  "Use a completed passing builder verification",
);
assert.equal(verification.firstTransaction.amountSats, 20000);
assert.equal(verification.firstTransaction.feeSats, 282);
assert.equal(verification.recoveryTransaction.amountSats, 10000);
assert.equal(verification.recoveryTransaction.extraBroadcasts, 0);
assert.equal(verification.firstTransaction.network, "regtest");
assert.equal(verification.recoveryTransaction.network, "regtest");

const sourceNames = [
  "desktop-landing.png",
  "desktop-live-lab.png",
  "desktop-live-preview.png",
  "desktop-broadcast-review.png",
  "desktop-confirmed-transaction.png",
  "desktop-lost-response.png",
  "360-builder.png",
];
const sources = Object.fromEntries(
  sourceNames.map((name) => {
    const saved = resolve(raw, name);
    if (!existsSync(saved) && !validationMode)
      copyFileSync(resolve(sourceQa, name), saved);
    const bytes = readFileSync(saved);
    return [
      name,
      {
        file: repoPath(saved),
        originalFile: `apps/sandbox/.qa/${name}`,
        ...pngInfo(bytes),
        data: `data:image/png;base64,${bytes.toString("base64")}`,
        provenance:
          name === "desktop-landing.png"
            ? "Actual anonymous Chromium UI capture; the landing transaction diagram is explicitly illustrative."
            : "Actual UI capture from the recorded builder-controlled Bitcoin Core regtest verification; no monetary value or independent user trial.",
      },
    ];
  }),
);

const fontFiles = [
  [
    "Plex",
    400,
    "@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-400-normal.woff2",
  ],
  [
    "Plex",
    500,
    "@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-500-normal.woff2",
  ],
  [
    "Plex",
    600,
    "@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-600-normal.woff2",
  ],
  [
    "Plex",
    700,
    "@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-700-normal.woff2",
  ],
  [
    "Plex Mono",
    400,
    "@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2",
  ],
  [
    "Plex Mono",
    500,
    "@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2",
  ],
];
const fonts = fontFiles.map(([family, weight, file]) => {
  const bytes = readFileSync(resolve(root, "node_modules", file));
  const packageName = file.split("/").slice(0, 2).join("/");
  const fontPackage = JSON.parse(
    readFileSync(
      resolve(root, "node_modules", packageName, "package.json"),
      "utf8",
    ),
  );
  return {
    family,
    weight,
    file: `node_modules/${file}`,
    packageName,
    packageVersion: fontPackage.version,
    license: fontPackage.license,
    sha256: sha256(bytes),
    bytes: bytes.length,
    css: `@font-face{font-family:'${family}';font-style:normal;font-weight:${weight};font-display:block;src:url(data:font/woff2;base64,${bytes.toString("base64")}) format('woff2');}`,
  };
});
const mark = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 42 42"><rect x="1" y="1" width="40" height="40" rx="9" fill="#f7b748"/><path d="m12 17 9-5 9 5v10l-9 5-9-5V17Zm0 0 9 5 9-5m-9 5v10" fill="none" stroke="#171a1e" stroke-width="2" stroke-linejoin="round"/><path d="M26 9h7m-3.5-3.5v7" stroke="#171a1e" stroke-width="2"/></svg>`;
if (!validationMode)
  writeFileSync(resolve(raw, "bitcoin-sandbox-mark.svg"), mark + "\n");

function text(
  content,
  x,
  y,
  {
    size = 24,
    color = "#f2f3f4",
    weight = 400,
    mono = false,
    wide = 1352,
    line = 1.3,
    cls = "",
  } = {},
) {
  return `<div data-text-check class="text ${cls}" style="left:${px(x)};top:${px(y)};width:${px(wide)};font-size:${px(size)};font-weight:${weight};line-height:${line};color:${color};font-family:${mono ? "'Plex Mono'" : "'Plex'"}">${content}</div>`;
}
function crop(source, region, x, y, scale = 1) {
  const [sx, sy, sw, sh] = region;
  const item = sources[source];
  assert.ok(
    item &&
      sx >= 0 &&
      sy >= 0 &&
      sx + sw <= item.width &&
      sy + sh <= item.height,
    `Valid crop: ${source}`,
  );
  const dw = sw * scale;
  const dh = sh * scale;
  assert.ok(
    x >= 0 && y >= 0 && x + dw <= width && y + dh <= height,
    `Crop on canvas: ${source}`,
  );
  return {
    source,
    region: { x: sx, y: sy, width: sw, height: sh },
    placement: { x, y, width: dw, height: dh },
    scale,
    operation:
      "Unmodified screenshot, rectangular crop and uniform scale; no data, controls, colors or state redrawn.",
    html: `<div class="capture" style="left:${px(x)};top:${px(y)};width:${px(dw)};height:${px(dh)}"><img alt="Actual Bitcoin Sandbox UI capture" src="${item.data}" style="left:${px(-sx * scale)};top:${px(-sy * scale)};width:${px(item.width * scale)};height:${px(item.height * scale)}"/></div>`,
  };
}
const rule = (y) => `<div class="rule" style="top:${px(y)}"></div>`;
function header(number, section, title, subtitle) {
  return (
    `<div class="brand">${mark}<div>Bitcoin Sandbox</div></div>` +
    text(`${number} / ${escape(section)}`, 1050, 82, {
      size: 18,
      color: "#f7b748",
      mono: true,
      wide: 378,
      cls: "align-right",
    }) +
    text(escape(title), 74, 145, { size: 53, weight: 500, line: 1.12 }) +
    text(escape(subtitle), 76, 212, { size: 22, color: "#acb6c1" })
  );
}
function footer(extra = "Actual UI captures") {
  return (
    rule(920) +
    text(
      "Builder-controlled Bitcoin Core regtest · No monetary value",
      74,
      946,
      { size: 20, color: "#acb6c1", wide: 990 },
    ) +
    text(escape(extra), 1060, 949, {
      size: 16,
      color: "#acb6c1",
      mono: true,
      wide: 368,
      cls: "align-right",
    })
  );
}
const css = `${fonts.map((font) => font.css).join("\n")}
*{box-sizing:border-box}html,body{margin:0;width:1500px;height:1000px;overflow:hidden;background:#15191e;color:#f2f3f4;font-family:'Plex';font-synthesis:none;-webkit-font-smoothing:antialiased} .canvas{width:1500px;height:1000px;position:relative;background:#15191e;overflow:hidden} .text{position:absolute;letter-spacing:-.01em} .align-right{text-align:right} .brand{position:absolute;left:74px;top:65px;display:flex;align-items:center;gap:17px;font-size:27px;font-weight:500;letter-spacing:-.025em}.brand svg{width:48px;height:48px}.capture{position:absolute;overflow:hidden;background:#1c2127;border-radius:9px}.capture img{position:absolute;max-width:none;display:block}.rule{position:absolute;left:74px;width:1352px;height:1px;background:#37414b}.large-amount{letter-spacing:-.05em}.eyebrow{letter-spacing:.09em}.amber{color:#f7b748}.thumb-mark{position:absolute;left:74px;top:68px;width:58px;height:58px}.thumb-mark svg{display:block;width:100%;height:100%}.thumb-line{position:absolute;left:74px;top:823px;width:1352px;height:1px;background:#37414b}
`;
function canvas(body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Bitcoin Sandbox submission image</title><style>${css}</style></head><body><main class="canvas">${body}</main></body></html>`;
}

const happy = {
  name: "happy-path-20000",
  amountSats: 20000,
  feeSats: 282,
  inputSats: 1000000,
  changeSats: 979718,
  txid: verification.firstTransaction.txid,
  verificationFile: repoPath(reportCopy),
};
const recovery = {
  name: "separate-recovery-10000-after-reset",
  amountSats: 10000,
  feeSats: 282,
  txid: verification.recoveryTransaction.txid,
  extraBroadcasts: 0,
  verificationFile: repoPath(reportCopy),
};
const cards = [];
function card(filename, title, body, crops, claims, context) {
  cards.push({
    filename,
    title,
    html: canvas(body + crops.map((item) => item.html).join("")),
    crops,
    claims,
    context,
  });
}
card(
  "00-thumbnail.png",
  "Bitcoin Sandbox",
  `<div class="thumb-mark">${mark}</div>` +
    text("BITCOIN CORE / HANDS-ON LAB", 151, 88, {
      size: 22,
      color: "#acb6c1",
      mono: true,
      wide: 1000,
    }) +
    text("Bitcoin<br><span class='amber'>Sandbox.</span>", 69, 244, {
      size: 105,
      weight: 600,
      line: 1.03,
      wide: 610,
    }) +
    text("Make Bitcoin<br>make sense.", 75, 510, {
      size: 42,
      weight: 400,
      line: 1.23,
      wide: 565,
    }) +
    text(
      "Inspect inputs. Follow the change.<br>See what a transaction creates.",
      78,
      659,
      { size: 25, color: "#acb6c1", line: 1.5, wide: 565 },
    ) +
    text("Actual Core-prepared preview", 703, 276, {
      size: 21,
      color: "#acb6c1",
      wide: 690,
    }) +
    text("20,000 regtest sats · 282-sat fee", 700, 748, {
      size: 22,
      color: "#acb6c1",
      mono: true,
      wide: 690,
    }) +
    rule(847) +
    text("Build a transaction", 78, 880, { size: 25, wide: 470 }) +
    text("Review the exact total", 567, 880, { size: 25, wide: 470 }) +
    text("Mine a test block", 1090, 880, { size: 25, wide: 338 }) +
    text(
      "Builder-controlled Bitcoin Core regtest · No monetary value",
      78,
      947,
      { size: 20, color: "#acb6c1" },
    ),
  [crop("desktop-live-preview.png", [555, 380, 760, 338], 682, 350, 0.97)],
  [
    "The artwork uses the real 20,000-sat Core-prepared preview, not a settled mainnet payment.",
    "Input 1,000,000 = payment 20,000 + change 979,718 + fee 282 regtest sats.",
  ],
  happy,
);

card(
  "01-landing.png",
  "Make Bitcoin make sense",
  header(
    "01",
    "LANDING",
    "A lab you can actually use.",
    "Learn by inspecting transactions, outputs and block inclusion.",
  ) +
    text(
      "The landing diagram is illustrative. The working laboratory uses Bitcoin Core regtest.",
      76,
      873,
      { size: 22, color: "#acb6c1" },
    ) +
    footer("Landing overview"),
  [crop("desktop-landing.png", [100, 177, 1240, 557], 74, 256, 1.09)],
  [
    "Actual anonymous product landing capture.",
    "The landing's 100,000-sat input example is illustrative and distinct from the 20,000-sat real-Core happy path.",
  ],
  {
    name: "anonymous-landing",
    exampleInputSats: 100000,
    examplePaymentSats: 20000,
    exampleChangeSats: 79718,
    exampleFeeSats: 282,
    illustrative: true,
  },
);

card(
  "02-wallets-and-utxo.png",
  "Two wallets and a real output",
  header(
    "02",
    "CREATE + INSPECT",
    "Two wallets. Real unspent outputs.",
    "Initial lab state: each wallet receives 1,000,000 valueless regtest sats.",
  ) + footer("Initial wallet run"),
  [
    crop("desktop-live-lab.png", [100, 290, 1240, 189], 74, 266, 1.09),
    crop("desktop-live-lab.png", [100, 504, 1240, 370], 74, 497, 1.09),
  ],
  [
    "Actual initial Alpha and Beta wallet balances, both 1,000,000 regtest sats.",
    "The selected Alpha output is shown with its real output index and confirmation count.",
  ],
  { ...happy, stage: "initial-wallet-run-before-preview" },
);

card(
  "03-transaction-anatomy.png",
  "Know where every sat goes",
  header(
    "03",
    "PREPARE",
    "Know where every sat goes.",
    "Happy path: a Core-prepared 20,000-sat payment, with a 282-sat fee.",
  ) +
    text("20,000", 1070, 362, {
      size: 57,
      mono: true,
      weight: 500,
      wide: 356,
      cls: "large-amount",
    }) +
    text("regtest sats to Beta", 1075, 438, {
      size: 22,
      color: "#acb6c1",
      wide: 350,
    }) +
    text("282", 1070, 529, {
      size: 57,
      mono: true,
      weight: 500,
      wide: 356,
      cls: "large-amount",
    }) +
    text("regtest sats in fees", 1075, 605, {
      size: 22,
      color: "#acb6c1",
      wide: 350,
    }) +
    text("Input − outputs = fee", 1074, 739, { size: 24, wide: 354 }) +
    text("Preview before signing.", 1074, 784, {
      size: 22,
      color: "#acb6c1",
      wide: 354,
    }) +
    footer("20,000-sat happy path"),
  [crop("desktop-live-preview.png", [530, 290, 810, 554], 74, 277, 1.1)],
  [
    "Actual Core-prepared preview: payment 20,000, change 979,718 and fee 282 from one 1,000,000-sat input.",
    "Authored numeric captions repeat the source preview values; they do not replace or repaint the captured UI.",
  ],
  { ...happy, stage: "prepared-not-yet-broadcast" },
);

card(
  "04-explicit-review.png",
  "Review before broadcasting",
  header(
    "04",
    "REVIEW",
    "See the total. Make the choice.",
    "Happy path: the exact payment and fee are reviewed before Core signs.",
  ) +
    text("20,282", 74, 338, {
      size: 84,
      mono: true,
      weight: 500,
      wide: 620,
      cls: "large-amount",
    }) +
    text("regtest sats in total", 78, 444, {
      size: 30,
      color: "#acb6c1",
      wide: 630,
    }) +
    text("20,000 payment + 282 fee", 78, 510, {
      size: 25,
      mono: true,
      color: "#acb6c1",
      wide: 640,
    }) +
    text(
      "Review the amount and fee.<br>Check the confirmation box.<br>Broadcast the exact transaction.",
      79,
      628,
      { size: 28, line: 1.55, wide: 638 },
    ) +
    text(
      "Captured before the checkbox is ticked:<br>the broadcast action is still disabled.",
      79,
      806,
      { size: 21, color: "#acb6c1", line: 1.45, wide: 648 },
    ) +
    footer("20,000-sat happy path"),
  [crop("desktop-broadcast-review.png", [418, 201, 605, 646], 797, 253, 1)],
  [
    "Actual review dialog from the 20,000-sat happy path.",
    "The unchecked confirmation and disabled broadcast control are preserved.",
    "Displayed total 20,282 = payment 20,000 + fee 282 regtest sats.",
  ],
  { ...happy, stage: "explicit-review-before-signing" },
);

card(
  "05-core-confirmation-proof.png",
  "A real confirmation",
  header(
    "05",
    "VERIFY",
    "Watch a real confirmation arrive.",
    "The same 20,000-sat transaction is read from Core after one regtest block.",
  ) + footer("20,000-sat happy path"),
  [
    crop(
      "desktop-confirmed-transaction.png",
      [100, 776, 1240, 618],
      112,
      253,
      1.03,
    ),
  ],
  [
    "Actual transaction details for the happy-path transaction; one confirmation and a Core-supplied block hash.",
    "The source shows one input and two outputs: payment 20,000 and change 979,718 regtest sats.",
    "This is proof on the controlled regtest node, not a mainnet transaction or an independent user result.",
  ],
  {
    ...happy,
    stage: "confirmed-on-shared-regtest-chain",
    confirmationsAtCapture: 1,
  },
);

card(
  "06-recovery-and-mobile.png",
  "Recover without a second broadcast",
  header(
    "06",
    "RECOVER",
    "Check the result before sending again.",
    "Separate wallet run after reset: 10,000 regtest sats, with a deliberately lost response.",
  ) +
    text("Original attempt · fields held fixed", 76, 427, {
      size: 21,
      color: "#acb6c1",
      wide: 540,
    }) +
    text("0", 666, 504, {
      size: 98,
      mono: true,
      color: "#a6dabd",
      wide: 270,
      cls: "large-amount",
    }) +
    text("extra broadcasts", 672, 622, { size: 27, wide: 330 }) +
    text("Read-only status check.<br>Same transaction recovered.", 672, 694, {
      size: 23,
      color: "#acb6c1",
      line: 1.5,
      wide: 324,
    }) +
    text("Actual 360px browser view<br>after recovery + reload", 1029, 449, {
      size: 21,
      color: "#acb6c1",
      line: 1.4,
      wide: 398,
    }) +
    text("Builder test record verifies zero extra sends.", 672, 853, {
      size: 21,
      color: "#acb6c1",
      wide: 758,
    }) +
    footer("Separate 10,000-sat test"),
  [
    crop("desktop-lost-response.png", [100, 375, 1240, 144], 74, 259, 1.09),
    crop("desktop-lost-response.png", [100, 543, 405, 323], 74, 467, 1.26),
    crop("360-builder.png", [14, 269, 332, 169], 1028, 553, 1.19),
  ],
  [
    "An actual dropped broadcast response is shown as unresolved in the source capture.",
    "The original locked payment fields show 10,000 sats.",
    "The actual 360px screenshot after reconciliation and reload shows the original broadcast restored.",
    "The builder's request count verifies no additional broadcast was sent during reconciliation or reload.",
  ],
  { ...recovery, stage: "lost-response-read-only-reconciliation-and-reload" },
);

function manifestEntry(card, bytes, validation) {
  return {
    file: `docs/sandbox/submission/media/${card.filename}`,
    title: card.title,
    role:
      card.filename === "00-thumbnail.png"
        ? "Devpost thumbnail"
        : "Devpost gallery image",
    format: "image/png",
    ...pngInfo(bytes),
    under5MB: bytes.length < 5_000_000,
    contentClaims: card.claims,
    context: card.context,
    sourceCrops: card.crops.map(({ html, ...item }) => item),
    validation,
    visualReview: {
      status: "pending",
      required:
        "Directly inspect the exported raster before running --record-review.",
    },
  };
}
function baseManifest() {
  return {
    version: 1,
    project: "Bitcoin Sandbox",
    createdAt: new Date().toISOString(),
    dimensions: { width, height, ratio: "3:2" },
    scope:
      "Original authored submission compositions using unmodified actual UI crops; builder-controlled Bitcoin Core regtest, no monetary value, no mainnet or independent user claims.",
    renderer: {
      file: "docs/sandbox/submission/render-media.mjs",
      sha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
      method:
        "Static HTML/CSS to Chromium PNG. Only data URI images/fonts are loaded; all network requests are blocked. No application navigation, wallets, ports or videos.",
    },
    brand: {
      palette: {
        ink: "#15191e",
        panel: "#1c2127",
        amber: "#f7b748",
        text: "#f2f3f4",
        muted: "#acb6c1",
        verified: "#a6dabd",
      },
      typography: fonts.map(({ css, ...font }) => font),
      originalMark: {
        file: "docs/sandbox/submission/media/sources/bitcoin-sandbox-mark.svg",
        sha256: sha256(Buffer.from(mark + "\n")),
        source:
          "Original SVG authored for apps/sandbox/src/components.tsx; reused without third-party imagery.",
      },
      designNotes: "docs/sandbox/submission/media/DESIGN-NOTES.md",
    },
    sourceCaptures: Object.fromEntries(
      Object.entries(sources).map(([name, { data, ...source }]) => [
        name,
        source,
      ]),
    ),
    verification: {
      file: repoPath(reportCopy),
      originalFile: "apps/sandbox/.qa/ui-verification.json",
      sha256: sha256(readFileSync(reportCopy)),
      checks: verification.checks.length,
      complete: verification.complete,
      firstTransaction: verification.firstTransaction,
      recoveryTransaction: verification.recoveryTransaction,
      frontendSourceHashesAtCapture: verification.sourceHashes,
    },
    assets: [],
  };
}
function validateFiles(manifest) {
  assert.equal(manifest.assets.length, 7);
  for (const entry of manifest.assets) {
    const info = pngInfo(readFileSync(resolve(root, entry.file)));
    assert.equal(info.width, width, entry.file);
    assert.equal(info.height, height, entry.file);
    assert.equal(info.bytes, entry.bytes, entry.file);
    assert.ok(info.bytes < 5_000_000, entry.file);
    assert.equal(info.sha256, entry.sha256, entry.file);
    assert.ok(
      entry.validation.noTextOverflow &&
        entry.validation.noNetworkRequests &&
        entry.validation.noPageErrors,
      entry.file,
    );
  }
  for (const entry of Object.values(manifest.sourceCaptures))
    assert.equal(
      sha256(readFileSync(resolve(root, entry.file))),
      entry.sha256,
      entry.file,
    );
  assert.equal(
    sha256(readFileSync(resolve(root, manifest.renderer.file))),
    manifest.renderer.sha256,
    "Renderer hash",
  );
  assert.equal(
    sha256(readFileSync(resolve(root, manifest.brand.originalMark.file))),
    manifest.brand.originalMark.sha256,
    "Original mark hash",
  );
  for (const font of manifest.brand.typography)
    assert.equal(
      sha256(readFileSync(resolve(root, font.file))),
      font.sha256,
      font.file,
    );
  assert.equal(sha256(readFileSync(reportCopy)), manifest.verification.sha256);
  return {
    assets: 7,
    thumbnails: 1,
    galleryImages: 6,
    dimensions: `${width}x${height}`,
    ratio: "3:2",
    allUnder5MB: true,
    sourceAndOutputHashesMatch: true,
    visualReviewsAccepted: manifest.assets.every(
      (entry) => entry.visualReview.status === "accepted",
    ),
    totalOutputBytes: manifest.assets.reduce(
      (sum, entry) => sum + entry.bytes,
      0,
    ),
  };
}
if (
  process.argv.includes("--validate") ||
  process.argv.includes("--record-review")
) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  validateFiles(manifest);
  if (process.argv.includes("--record-review")) {
    const reviewedAt = new Date().toISOString();
    for (const entry of manifest.assets)
      entry.visualReview = {
        status: "accepted",
        reviewedAt,
        method:
          "Direct inspection of each exported PNG with view_image after rendering; readable main values/actions, intact source states, contained composition and explicit regtest/run labels.",
        reviewedSha256: entry.sha256,
      };
    manifest.finalValidation = validateFiles(manifest);
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  }
  console.log(JSON.stringify(validateFiles(manifest), null, 2));
  process.exit(0);
}

const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
    : {}),
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const context = await browser.newContext({
  viewport: { width, height },
  deviceScaleFactor: 1,
});
let networkRequests = 0;
const pageErrors = [];
await context.route("**/*", async (route) => {
  networkRequests++;
  await route.abort();
});
const page = await context.newPage();
page.on("pageerror", (error) => pageErrors.push(error.message));
const manifest = baseManifest();
try {
  for (const card of cards) {
    await page.setContent(card.html, { waitUntil: "load" });
    await page.evaluate(async () => {
      await Promise.all([
        document.fonts.load("600 30px 'Plex'"),
        document.fonts.load("500 30px 'Plex Mono'"),
      ]);
      await document.fonts.ready;
      await Promise.all(
        Array.from(document.images).map((image) => image.decode()),
      );
    });
    const metrics = await page.evaluate(() => ({
      loadedFonts:
        document.fonts.check("600 30px 'Plex'") &&
        document.fonts.check("500 30px 'Plex Mono'"),
      noTextOverflow: Array.from(
        document.querySelectorAll("[data-text-check]"),
      ).every((element) => {
        const r = element.getBoundingClientRect();
        return (
          r.left >= 0 &&
          r.top >= 0 &&
          r.right <= 1500.01 &&
          r.bottom <= 1000.01 &&
          element.scrollWidth <= element.clientWidth + 1
        );
      }),
      noDocumentOverflow:
        document.documentElement.scrollWidth === 1500 &&
        document.documentElement.scrollHeight === 1000,
    }));
    assert.ok(
      metrics.loadedFonts &&
        metrics.noTextOverflow &&
        metrics.noDocumentOverflow,
      card.filename + ": " + JSON.stringify(metrics),
    );
    const bytes = await page.screenshot({
      path: resolve(media, card.filename),
      type: "png",
      fullPage: false,
    });
    manifest.assets.push(
      manifestEntry(card, bytes, {
        ...metrics,
        noNetworkRequests: networkRequests === 0,
        noPageErrors: pageErrors.length === 0,
      }),
    );
  }
  manifest.finalValidation = validateFiles(manifest);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(JSON.stringify(manifest.finalValidation, null, 2));
} finally {
  await browser.close();
}
