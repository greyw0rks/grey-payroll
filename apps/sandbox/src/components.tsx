import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  CircleNotch,
  Copy,
  Cube,
  Info,
  X,
} from "@phosphor-icons/react";
import { formatSats, shortHash, type TransactionPreview } from "./api";

export function Spinner({ size = 18 }: { size?: number }) {
  return <CircleNotch size={size} className="spinner" aria-hidden="true" />;
}
export function Brand({ onClick }: { onClick: () => void }) {
  return (
    <button
      className="brand"
      onClick={onClick}
      aria-label="Bitcoin Sandbox home"
    >
      <svg viewBox="0 0 42 42" aria-hidden="true">
        <rect x="1" y="1" width="40" height="40" rx="9" fill="currentColor" />
        <path
          d="m12 17 9-5 9 5v10l-9 5-9-5V17Zm0 0 9 5 9-5m-9 5v10"
          fill="none"
          stroke="#171a1e"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path d="M26 9h7m-3.5-3.5v7" stroke="#171a1e" strokeWidth="2" />
      </svg>
      <span>
        Bitcoin<span>Sandbox</span>
      </span>
    </button>
  );
}
export function Chip({
  tone = "",
  children,
}: {
  tone?: string;
  children: ReactNode;
}) {
  return <span className={`chip ${tone}`}>{children}</span>;
}
export function EmptyState({
  title,
  children,
  action,
  icon = <Cube size={34} />,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-state-icon">{icon}</span>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}
export function Modal({
  children,
  onClose,
  wide = false,
}: {
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const element = useRef<HTMLDivElement>(null);
  const returnFocus = useRef(document.activeElement as HTMLElement | null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const first =
      element.current?.querySelector<HTMLElement>("[data-first-focus]") ??
      element.current?.querySelector<HTMLElement>(
        "button:not(:disabled),a[href],input:not(:disabled)",
      );
    first?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close.current();
      }
      if (event.key !== "Tab") return;
      const nodes = Array.from(
        element.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
        ) ?? [],
      ).filter((node) => node.getClientRects().length > 0);
      if (!nodes.length) {
        event.preventDefault();
        element.current?.focus();
      } else if (event.shiftKey && document.activeElement === nodes[0]) {
        event.preventDefault();
        nodes.at(-1)?.focus();
      } else if (!event.shiftKey && document.activeElement === nodes.at(-1)) {
        event.preventDefault();
        nodes[0].focus();
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", key);
      if (returnFocus.current?.isConnected)
        returnFocus.current.focus({ preventScroll: true });
    };
  }, []);
  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close.current();
      }}
    >
      <div
        ref={element}
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        tabIndex={-1}
      >
        <button
          className="icon-button modal-close"
          onClick={onClose}
          aria-label="Close dialog"
        >
          <X size={21} />
        </button>
        {children}
      </div>
    </div>
  );
}
export function HashValue({
  value,
  onCopy,
  label = "Copy reference",
}: {
  value: string;
  onCopy: (value: string, label: string) => void;
  label?: string;
}) {
  return (
    <span className="hash-value">
      <code title={value}>{shortHash(value)}</code>
      <button
        className="icon-button"
        onClick={() => onCopy(value, label)}
        aria-label={label}
      >
        <Copy size={16} />
      </button>
    </span>
  );
}

const explanations = {
  input: [
    "An input spends an existing output.",
    "Bitcoin spends whole outputs. The amount you want to send and the transaction fee are deducted; the rest returns as change.",
  ],
  payment: [
    "The payment becomes a new output.",
    "The receiving wallet can spend this output later. Its address specifies the conditions needed to unlock these sats.",
  ],
  change: [
    "The remaining sats come back to you.",
    "Change goes to an address controlled by the sending wallet. It is a new output, with its own transaction reference.",
  ],
  fee: [
    "The fee pays for block space.",
    "The fee is the difference between total inputs and total outputs. Fee rate is measured in sats per virtual byte.",
  ],
} as const;
export function TransactionAnatomy({
  preview,
  illustrative = false,
}: {
  preview?: TransactionPreview | null;
  illustrative?: boolean;
}) {
  const [selected, setSelected] = useState<keyof typeof explanations>("input");
  const inputs = preview?.inputs ?? [{ txid: "", vout: 0, amountSats: 100000 }];
  const outputs = preview?.outputs ?? [
    { index: 0, address: "", amountSats: 20000, type: "payment" as const },
    { index: 1, address: "", amountSats: 79718, type: "change" as const },
  ];
  const fee = preview?.feeSats ?? 282;
  return (
    <figure className={`anatomy ${illustrative ? "illustrative" : ""}`}>
      <div className="anatomy-title">
        <strong>Transaction anatomy</strong>
        <Chip>
          {illustrative ? "Illustrative example" : "Bitcoin Core preview"}
        </Chip>
      </div>
      <div className="anatomy-flow">
        <div className="anatomy-inputs">
          {inputs.map((input, i) => (
            <button
              key={`${input.txid}-${input.vout}`}
              className={`anatomy-node input-node ${selected === "input" ? "selected" : ""}`}
              onClick={() => setSelected("input")}
              aria-pressed={selected === "input"}
            >
              <span>Input {inputs.length > 1 ? i + 1 : ""}</span>
              <strong>
                {formatSats(input.amountSats)}
                <small> sats</small>
              </strong>
              <span>
                {input.txid
                  ? shortHash(input.txid, 5)
                  : "Existing unspent output"}
              </span>
            </button>
          ))}
        </div>
        <div className="anatomy-middle">
          <ArrowRight size={25} aria-hidden="true" />
          <span>Spend</span>
        </div>
        <div className="anatomy-outputs">
          {outputs.map((output) => (
            <button
              key={output.index}
              className={`anatomy-node ${output.type}-node ${selected === output.type ? "selected" : ""}`}
              onClick={() => setSelected(output.type)}
              aria-pressed={selected === output.type}
            >
              <span>
                {output.type === "payment" ? "Payment output" : "Change output"}
              </span>
              <strong>
                {formatSats(output.amountSats)}
                <small> sats</small>
              </strong>
              <span>
                {output.address
                  ? shortHash(output.address, 5)
                  : output.type === "payment"
                    ? "To the receiving wallet"
                    : "Back to the sending wallet"}
              </span>
            </button>
          ))}
        </div>
      </div>
      <button
        className={`anatomy-fee ${selected === "fee" ? "selected" : ""}`}
        onClick={() => setSelected("fee")}
        aria-pressed={selected === "fee"}
      >
        <span>Inputs − outputs = fee</span>
        <strong>{formatSats(fee)} sats</strong>
      </button>
      <figcaption className="anatomy-explanation">
        <Info size={19} />
        <div>
          <strong>{explanations[selected][0]}</strong>
          <p>{explanations[selected][1]}</p>
        </div>
      </figcaption>
    </figure>
  );
}
