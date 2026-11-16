import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowClockwise,
  ArrowDown,
  ArrowDownLeft,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  ArrowsLeftRight,
  BookOpen,
  Check,
  CheckCircle,
  Copy,
  Cube,
  DownloadSimple,
  Flask,
  Gear,
  GitBranch,
  Info,
  MagnifyingGlass,
  Play,
  ShieldCheck,
  SignOut,
  SquaresFour,
  UserCircle,
  Wallet,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import {
  CONNECT_INSTALL_URL,
  nostrProviderStatus,
  watchNostrProviders,
} from "../../../packages/academy/src/signers";
import {
  api,
  ApiError,
  amount,
  clearTemporaryIdentity,
  dateTime,
  defaultPreferences,
  emptyProgress,
  formatSats,
  hasTemporaryKey,
  isTemporaryIdentity,
  patch,
  post,
  shortHash,
  signInTemporarily,
  signInWithNostr,
  unitLabel,
  type DecodedTransaction,
  type ExperimentId,
  type LabSnapshot,
  type LabWallet,
  type Preferences,
  type PreviewStatus,
  type Progress,
  type TransactionPreview,
  type User,
  type Utxo,
  type WalletId,
  type WalletTransaction,
} from "./api";
import {
  Brand,
  Chip,
  EmptyState,
  HashValue,
  Modal,
  Spinner,
  TransactionAnatomy,
} from "./components";
import { experiments, glossary } from "./content";

type Route =
  | "home"
  | "lab"
  | "builder"
  | "explorer"
  | "experiments"
  | "settings"
  | "help"
  | "not-found";
type Dialog = "account" | "broadcast" | "reset" | null;
type LedgerEntry = WalletTransaction & {
  walletId: WalletId;
  walletName: string;
  relatedWalletIds: WalletId[];
};
const routes: Route[] = [
  "home",
  "lab",
  "builder",
  "explorer",
  "experiments",
  "settings",
  "help",
];
const navigation = [
  { id: "lab" as const, label: "Laboratory", icon: Flask },
  { id: "builder" as const, label: "Build", icon: GitBranch },
  { id: "explorer" as const, label: "Explorer", icon: MagnifyingGlass },
  { id: "experiments" as const, label: "Experiments", icon: BookOpen },
];
function routeFromHash(): Route {
  const value =
    window.location.hash.replace(/^#\/?/, "").split("/")[0] || "home";
  return routes.includes(value as Route) ? (value as Route) : "not-found";
}
function experimentFromHash(): ExperimentId | null {
  const value = window.location.hash.split("/")[1];
  return experiments.some((experiment) => experiment.id === value)
    ? (value as ExperimentId)
    : null;
}
function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "The lab could not complete that action. Please try again.";
}
function saveJson(value: unknown, filename: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const previewStorage = (user: User, runId: string) =>
  `sandbox-preview:${user.id}:${runId}`;

export default function App() {
  const [route, setRoute] = useState<Route>(routeFromHash);
  const [experimentId, setExperimentId] = useState<ExperimentId | null>(
    experimentFromHash,
  );
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [serviceReady, setServiceReady] = useState(false);
  const [nodeReady, setNodeReady] = useState(false);
  const [demoEnabled, setDemoEnabled] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [lab, setLab] = useState<LabSnapshot | null>(null);
  const [preferences, setPreferences] =
    useState<Preferences>(defaultPreferences);
  const [draftPreferences, setDraftPreferences] =
    useState<Preferences>(defaultPreferences);
  const [progress, setProgress] = useState<Progress>(emptyProgress);
  const [activeWallet, setActiveWallet] = useState<WalletId>("alpha");
  const [selectedUtxo, setSelectedUtxo] = useState<Utxo | null>(null);
  const [showAllUtxos, setShowAllUtxos] = useState(false);
  const [fromWallet, setFromWallet] = useState<WalletId>("alpha");
  const [toWallet, setToWallet] = useState<WalletId>("beta");
  const [sendAmount, setSendAmount] = useState("20000");
  const [feeRate, setFeeRate] = useState("2");
  const [preview, setPreview] = useState<TransactionPreview | null>(null);
  const [previewStatus, setPreviewStatus] = useState<
    PreviewStatus["state"] | null
  >(null);
  const [recentTxid, setRecentTxid] = useState("");
  const [reviewConfirmed, setReviewConfirmed] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [transactionFilter, setTransactionFilter] = useState<
    "all" | "pending" | "confirmed"
  >("all");
  const [walletFilter, setWalletFilter] = useState<"all" | WalletId>("all");
  const [lookupId, setLookupId] = useState("");
  const [selectedTransaction, setSelectedTransaction] =
    useState<DecodedTransaction | null>(null);
  const [transactionReadAt, setTransactionReadAt] = useState<number | null>(
    null,
  );
  const [experimentTxid, setExperimentTxid] = useState("");
  const [changeOutputIndex, setChangeOutputIndex] = useState("");
  const [resetText, setResetText] = useState("");
  const [providers, setProviders] = useState(nostrProviderStatus);
  const [tick, setTick] = useState(Date.now());
  const busyRef = useRef("");
  const refreshRef = useRef(false);
  const epoch = useRef(0);
  const mounted = useRef(true);
  const pageHeading = useRef<HTMLHeadingElement>(null);
  const routeChanged = useRef(false);
  const loginController = useRef<AbortController | null>(null);
  const noticeTimer = useRef<number | null>(null);

  const go = useCallback((next: Route, experiment?: ExperimentId) => {
    routeChanged.current = true;
    window.location.hash =
      next === "home" ? "" : next + (experiment ? `/${experiment}` : "");
    setRoute(next);
    setExperimentId(experiment ?? null);
    setError("");
    window.scrollTo({ top: 0, behavior: "instant" });
  }, []);

  function flash(message: string) {
    setNotice(message);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(""), 5500);
  }
  async function copy(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      flash(`${label} copied.`);
    } catch {
      setError(
        "Clipboard access was unavailable. Select and copy the reference manually.",
      );
    }
  }
  function rememberPreview(
    value: TransactionPreview,
    profile = user,
    run = lab?.runId,
  ) {
    if (!profile || !run) return;
    try {
      sessionStorage.setItem(previewStorage(profile, run), value.id);
    } catch {
      /* Recovery metadata is optional; never store wallet secrets or PSBTs. */
    }
  }
  function applyPreviewStatus(value: PreviewStatus) {
    setPreview(value);
    setPreviewStatus(value.state);
    setFromWallet(value.from);
    setToWallet(value.to);
    setSendAmount(String(value.amountSats));
    setFeeRate(String(value.feeRate));
    if (value.snapshot) {
      setLab(value.snapshot);
      setNodeReady(true);
    }
    if (value.state === "broadcast" && value.txid) {
      setRecentTxid(value.txid);
      setExperimentTxid(value.txid);
      setLookupId(value.txid);
    }
  }
  function discardPreviewForEdit() {
    if (previewStatus === "unknown" || previewStatus === "signing") return;
    setPreview(null);
    setPreviewStatus(null);
    setRecentTxid("");
    if (!user || !lab) return;
    try {
      sessionStorage.removeItem(previewStorage(user, lab.runId));
    } catch {
      /* The previous transaction remains in the node's ledger. */
    }
  }

  async function refreshProgress() {
    const value = await api<Progress>("/api/sandbox/progress");
    if (mounted.current) setProgress(value);
    return value;
  }
  async function syncProgressAfterOperation() {
    try {
      await refreshProgress();
    } catch {
      if (mounted.current)
        setError(
          "The node operation completed, but your experiment record could not be refreshed. Reload the page when the connection returns.",
        );
    }
  }
  async function loadAccount(profile: User, signal?: AbortSignal) {
    const currentEpoch = epoch.current;
    const results = await Promise.allSettled([
      api<LabSnapshot>("/api/sandbox/state", { signal }),
      api<Preferences>("/api/sandbox/preferences", { signal }),
      api<Progress>("/api/sandbox/progress", { signal }),
    ]);
    if (!mounted.current || currentEpoch !== epoch.current || signal?.aborted)
      return;
    const [stateResult, preferenceResult, progressResult] = results;
    if (preferenceResult.status === "fulfilled") {
      setPreferences(preferenceResult.value);
      setDraftPreferences(preferenceResult.value);
      setFeeRate(String(preferenceResult.value.defaultFeeRate));
    }
    if (progressResult.status === "fulfilled")
      setProgress(progressResult.value);
    if (stateResult.status === "fulfilled") {
      setLab(stateResult.value);
      setNodeReady(true);
      let stored: string | null = null;
      try {
        stored = sessionStorage.getItem(
          previewStorage(profile, stateResult.value.runId),
        );
      } catch {
        /* No recovery metadata is available. */
      }
      if (stored && /^[a-zA-Z0-9-]{16,80}$/.test(stored)) {
        try {
          const retained = await api<PreviewStatus>(
            `/api/sandbox/previews/${encodeURIComponent(stored)}`,
            { signal },
          );
          if (currentEpoch === epoch.current && !signal?.aborted)
            applyPreviewStatus(retained);
        } catch {
          /* The saved preview may belong to an archived run; the node's ledger remains available. */
        }
      }
    } else if (!(
      stateResult.reason instanceof ApiError &&
      ["LAB_REQUIRED", "BITCOIN_UNAVAILABLE"].includes(stateResult.reason.code)
    )) {
      if (
        stateResult.reason instanceof ApiError &&
        stateResult.reason.status === 401
      ) {
        setUser(null);
        setLab(null);
      } else setError(errorMessage(stateResult.reason));
    }
  }

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    const currentEpoch = epoch.current;
    async function initialize() {
      const [session, status] = await Promise.allSettled([
        api<{ user: User | null; demoEnabled: boolean }>("/api/session", {
          signal: controller.signal,
        }),
        api<{ ready: boolean; network: string; blockHeight: number | null }>(
          "/api/sandbox/status",
          { signal: controller.signal },
        ),
      ]);
      if (
        !mounted.current ||
        controller.signal.aborted ||
        currentEpoch !== epoch.current
      )
        return;
      if (session.status === "fulfilled") {
        setUser(session.value.user);
        setDemoEnabled(session.value.demoEnabled);
        setServiceReady(true);
      }
      if (status.status === "fulfilled") {
        setNodeReady(status.value.ready);
        setServiceReady(true);
      }
      if (session.status === "fulfilled" && session.value.user)
        await loadAccount(session.value.user, controller.signal);
      if (!controller.signal.aborted && mounted.current) setLoading(false);
    }
    void initialize();
    const hashChanged = () => {
      routeChanged.current = true;
      setRoute(routeFromHash());
      setExperimentId(experimentFromHash());
      setError("");
    };
    const connectivityChanged = () => setOnline(navigator.onLine);
    const updateProviders = () => setProviders(nostrProviderStatus());
    window.addEventListener("hashchange", hashChanged);
    window.addEventListener("online", connectivityChanged);
    window.addEventListener("offline", connectivityChanged);
    const unwatch = watchNostrProviders(updateProviders);
    return () => {
      mounted.current = false;
      controller.abort();
      loginController.current?.abort();
      unwatch();
      window.removeEventListener("hashchange", hashChanged);
      window.removeEventListener("online", connectivityChanged);
      window.removeEventListener("offline", connectivityChanged);
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!routeChanged.current || dialog) return;
    routeChanged.current = false;
    pageHeading.current?.focus({ preventScroll: true });
  }, [route, experimentId, dialog]);
  useEffect(() => {
    if (!preview) return;
    const timer = window.setInterval(() => setTick(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [preview]);
  useEffect(() => {
    if (!selectedUtxo || !lab) return;
    const fresh = lab.wallets
      .find((wallet) => wallet.id === activeWallet)
      ?.utxos.find(
        (output) =>
          output.txid === selectedUtxo.txid &&
          output.vout === selectedUtxo.vout,
      );
    setSelectedUtxo(fresh ?? null);
  }, [lab, activeWallet]);
  useEffect(() => {
    if (!preferences.autoRefresh || !user || !lab) return;
    const timer = window.setInterval(() => {
      if (
        !busyRef.current &&
        !refreshRef.current &&
        document.visibilityState === "visible" &&
        navigator.onLine
      )
        void refreshLab(true);
    }, 15000);
    return () => window.clearInterval(timer);
  }, [preferences.autoRefresh, user?.id, lab?.runId]);

  async function perform(label: string, action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = label;
    setBusy(label);
    setError("");
    try {
      await action();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        epoch.current++;
        setUser(null);
        setLab(null);
        setPreview(null);
        setPreviewStatus(null);
        setDialog(null);
      }
      if (mounted.current) setError(errorMessage(caught));
    } finally {
      busyRef.current = "";
      if (mounted.current) setBusy("");
    }
  }
  async function checkNode() {
    await perform("status", async () => {
      const state = await api<{ ready: boolean }>("/api/sandbox/status");
      setNodeReady(state.ready);
      setServiceReady(true);
      if (state.ready) flash("Bitcoin Core is ready.");
      else
        flash(
          "The regtest node is offline. Start the local lab and check again.",
        );
    });
  }
  async function refreshLab(silent = false) {
    if (!user || refreshRef.current) return;
    refreshRef.current = true;
    const currentEpoch = epoch.current;
    try {
      const value = await api<LabSnapshot>("/api/sandbox/state");
      if (currentEpoch !== epoch.current || !mounted.current) return;
      setLab(value);
      setNodeReady(true);
      setServiceReady(true);
      if (!silent) {
        setError("");
        flash("Lab refreshed from Bitcoin Core.");
      }
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        epoch.current++;
        setUser(null);
        setLab(null);
      }
      if (caught instanceof ApiError && caught.code === "BITCOIN_UNAVAILABLE")
        setNodeReady(false);
      if (!silent && mounted.current) setError(errorMessage(caught));
    } finally {
      refreshRef.current = false;
    }
  }
  async function login(kind: "nostr" | "temporary" | "local") {
    const controller = new AbortController();
    loginController.current = controller;
    await perform("login", async () => {
      const response =
        kind === "local"
          ? await post<{ user: User }>("/api/demo/session", {
              persona: "learner",
            })
          : kind === "temporary"
            ? await signInTemporarily()
            : await signInWithNostr(controller.signal);
      if (controller.signal.aborted) return;
      epoch.current++;
      setUser(response.user);
      setDialog(null);
      setServiceReady(true);
      setLab(null);
      setPreview(null);
      setPreviewStatus(null);
      setSelectedTransaction(null);
      setProgress(emptyProgress);
      setPreferences(defaultPreferences);
      setDraftPreferences(defaultPreferences);
      await loadAccount(response.user);
      go("lab");
      flash(
        kind === "local"
          ? "Local practice session opened."
          : "Your lab identity is connected.",
      );
    });
    loginController.current = null;
  }
  async function startLab() {
    if (!user) {
      setError("");
      setDialog("account");
      return;
    }
    go("lab");
    if (!nodeReady) return;
    await perform("start", async () => {
      const value = await post<LabSnapshot>("/api/sandbox/start");
      setLab(value);
      setNodeReady(true);
      setPreview(null);
      setPreviewStatus(null);
      setSelectedUtxo(null);
      await syncProgressAfterOperation();
      flash("Your two Bitcoin Core wallets are ready.");
    });
  }
  async function logout() {
    const wasTemporary = isTemporaryIdentity(user?.pubkey);
    await perform("logout", async () => {
      await post("/api/session/logout");
      epoch.current++;
      clearTemporaryIdentity();
      setUser(null);
      setLab(null);
      setProgress(emptyProgress);
      setPreferences(defaultPreferences);
      setDraftPreferences(defaultPreferences);
      setPreview(null);
      setPreviewStatus(null);
      setRecentTxid("");
      setSelectedTransaction(null);
      go("home");
      flash(
        wasTemporary
          ? "Signed out. The temporary signing key was cleared and this identity cannot be restored."
          : "Signed out. Your saved lab remains linked to your Nostr identity.",
      );
    });
  }
  async function createPreview(event: FormEvent) {
    event.preventDefault();
    await perform("preview", async () => {
      const value = await post<TransactionPreview>("/api/sandbox/preview", {
        from: fromWallet,
        to: toWallet,
        amountSats: Number(sendAmount),
        feeRate: Number(feeRate),
      });
      setPreview(value);
      setPreviewStatus("prepared");
      setTick(Date.now());
      rememberPreview(value);
      flash("Preview prepared. Review it before signing.");
    });
  }
  async function broadcast() {
    if (!preview || !reviewConfirmed || previewStatus !== "prepared") return;
    await perform("broadcast", async () => {
      try {
        const result = await post<{
          txid: string;
          state: string;
          snapshot: LabSnapshot;
        }>("/api/sandbox/broadcast", {
          previewId: preview.id,
          confirmed: true,
        });
        setPreviewStatus("broadcast");
        setRecentTxid(result.txid);
        setExperimentTxid(result.txid);
        setLookupId(result.txid);
        setLab(result.snapshot);
        setDialog(null);
        flash("Transaction broadcast. Inspect it before mining a block.");
      } catch (caught) {
        setDialog(null);
        if (!(
          caught instanceof ApiError &&
          ["PREVIEW_EXPIRED", "PREVIEW_NOT_FOUND", "INVALID_INPUT"].includes(
            caught.code,
          )
        ))
          setPreviewStatus("unknown");
        throw caught;
      }
      await syncProgressAfterOperation();
    });
  }
  async function reconcile() {
    if (!preview) return;
    await perform("reconcile", async () => {
      const result = await post<PreviewStatus>(
        `/api/sandbox/previews/${encodeURIComponent(preview.id)}/reconcile`,
      );
      applyPreviewStatus(result);
      flash(
        result.state === "broadcast"
          ? "The node verified this transaction. No second broadcast was sent."
          : result.state === "failed"
            ? "The node did not accept this transaction. You may build a fresh preview."
            : "The transaction is still unresolved. Check again; this action never resends it.",
      );
    });
  }
  async function mine() {
    await perform("mine", async () => {
      const result = await post<{ blockHash: string; snapshot: LabSnapshot }>(
        "/api/sandbox/mine",
      );
      setLab(result.snapshot);
      setNodeReady(true);
      await syncProgressAfterOperation();
      if (selectedTransaction) {
        try {
          setSelectedTransaction(
            await api<DecodedTransaction>(
              `/api/sandbox/transactions/${selectedTransaction.txid}`,
            ),
          );
          setTransactionReadAt(Date.now());
        } catch {
          setError(
            "The block was mined, but this transaction could not be refreshed. Inspect it again to read its current confirmation count.",
          );
        }
      }
      flash(
        "One regtest block mined. Lab balances and confirmation counts were refreshed.",
      );
    });
  }
  async function inspect(txid: string, navigate = true) {
    if (!/^[a-fA-F0-9]{64}$/.test(txid)) {
      setError("Enter a complete 64-character transaction ID from your lab.");
      return;
    }
    if (navigate) go("explorer");
    setLookupId(txid.toLowerCase());
    await perform("inspect", async () => {
      const transaction = await api<DecodedTransaction>(
        `/api/sandbox/transactions/${txid.toLowerCase()}`,
      );
      setSelectedTransaction(transaction);
      setTransactionReadAt(Date.now());
    });
  }
  async function savePreferences(event: FormEvent) {
    event.preventDefault();
    await perform("preferences", async () => {
      const value = await patch<Preferences>(
        "/api/sandbox/preferences",
        draftPreferences,
      );
      setPreferences(value);
      setDraftPreferences(value);
      if (!preview) setFeeRate(String(value.defaultFeeRate));
      flash("Lab preferences saved.");
    });
  }
  async function exportLab() {
    await perform("export", async () => {
      const value = await api("/api/sandbox/export");
      saveJson(value, "bitcoin-sandbox-record.json");
      flash("Lab record downloaded.");
    });
  }
  async function resetLab(event: FormEvent) {
    event.preventDefault();
    if (resetText !== "RESET") return;
    await perform("reset", async () => {
      const value = await post<LabSnapshot>("/api/sandbox/reset", {
        confirmed: true,
      });
      setLab(value);
      setPreview(null);
      setPreviewStatus(null);
      setSelectedTransaction(null);
      setSelectedUtxo(null);
      setRecentTxid("");
      setExperimentTxid("");
      setDialog(null);
      await syncProgressAfterOperation();
      go("lab");
      flash(
        "A fresh wallet run is ready. Your experiment completions and receipts are retained.",
      );
    });
  }
  async function completeExperiment(event: FormEvent) {
    event.preventDefault();
    if (!experimentId || !experimentTxid) return;
    await perform("experiment", async () => {
      const checked = await post<Progress & { verified: boolean }>(
        `/api/sandbox/experiments/${experimentId}/complete`,
        {
          txid: experimentTxid,
          ...(experimentId === "utxos"
            ? { changeOutputIndex: Number(changeOutputIndex) }
            : {}),
        },
      );
      if (
        !checked.verified ||
        !checked.experiments.some(
          (item) => item.id === experimentId && item.completed,
        )
      )
        throw new ApiError(
          "The experiment result could not be verified. Refresh the record and check again.",
          502,
          "INVALID_EXPERIMENT_PROOF",
        );
      setProgress(checked);
      flash("Experiment verified against your Bitcoin Core transaction.");
    });
  }
  function closeDialog() {
    if (busyRef.current && dialog !== "account") return;
    if (dialog === "account") loginController.current?.abort();
    setDialog(null);
    setError("");
  }
  function buildFrom(walletId: WalletId) {
    if (previewStatus === "unknown" || previewStatus === "signing") {
      go("builder");
      return;
    }
    setFromWallet(walletId);
    setToWallet(walletId === "alpha" ? "beta" : "alpha");
    discardPreviewForEdit();
    go("builder");
  }

  const activeLabWallet =
    lab?.wallets.find((wallet) => wallet.id === activeWallet) ?? null;
  const sourceWallet = lab?.wallets.find((wallet) => wallet.id === fromWallet);
  const recipientWallet = lab?.wallets.find((wallet) => wallet.id === toWallet);
  const ledger = useMemo<LedgerEntry[]>(() => {
    const entries = (lab?.wallets ?? []).flatMap((wallet) =>
      wallet.transactions.map((transaction) => ({
        ...transaction,
        walletId: wallet.id,
        walletName: wallet.name,
        relatedWalletIds: [wallet.id],
      })),
    );
    const unique = new Map<string, LedgerEntry>();
    for (const entry of entries) {
      const known = unique.get(entry.txid);
      const relatedWalletIds = Array.from(
        new Set([
          ...(known?.relatedWalletIds ?? []),
          ...entry.relatedWalletIds,
        ]),
      );
      unique.set(entry.txid, {
        ...(known && entry.type !== "send" ? known : entry),
        relatedWalletIds,
      });
    }
    return Array.from(unique.values()).sort((a, b) => b.at - a.at);
  }, [lab]);
  const filteredLedger = ledger.filter(
    (transaction) =>
      (transactionFilter === "all" ||
        (transactionFilter === "pending"
          ? transaction.confirmations === 0
          : transaction.confirmations > 0)) &&
      (walletFilter === "all" ||
        transaction.relatedWalletIds.includes(walletFilter)) &&
      `${transaction.txid} ${transaction.relatedWalletIds.join(" ")} ${transaction.walletName} ${transaction.type} ${transaction.amountSats}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const sentTransactions = ledger.filter(
    (transaction) => transaction.type === "send",
  );
  const completedCount = progress.experiments.filter(
    (experiment) => experiment.completed,
  ).length;
  const currentExperiment = experiments.find(
    (experiment) => experiment.id === experimentId,
  );
  const currentCompletion = progress.experiments.find(
    (experiment) => experiment.id === experimentId && experiment.completed,
  );
  const previewExpired = Boolean(
    preview && tick >= preview.expiresAt && previewStatus === "prepared",
  );
  const uncertain = previewStatus === "unknown" || previewStatus === "signing";
  const temporary = isTemporaryIdentity(user?.pubkey);
  const displayUnit = unitLabel(preferences.unit);
  const formatAmount = (value: number) => amount(value, preferences.unit);

  function pageTitle(title: string, description: string, actions?: ReactNode) {
    return (
      <div className="page-heading">
        <div>
          <h1 ref={pageHeading} tabIndex={-1}>
            {title}
          </h1>
          <p>{description}</p>
        </div>
        {actions && <div className="page-actions">{actions}</div>}
      </div>
    );
  }
  function labRequired() {
    return (
      <section className="setup-workspace">
        <div className="setup-illustration" aria-hidden="true">
          <Cube size={62} weight="duotone" />
          <GitBranch size={34} />
          <Cube size={45} weight="duotone" />
        </div>
        <div className="setup-content">
          <h2>Two wallets. A real Bitcoin node. Room to experiment.</h2>
          <p>
            Sign in, create your lab, and explore Bitcoin transactions with
            coins that have no monetary value.
          </p>
          <ol className="setup-steps">
            <li>
              <span className={user ? "complete" : ""}>
                {user ? <Check size={18} /> : "1"}
              </span>
              <div>
                <strong>
                  {user
                    ? "Identity connected"
                    : "Connect your learning identity"}
                </strong>
                <p>
                  {user
                    ? user.demo
                      ? "Local practice identity. This is a builder test account."
                      : `Your lab is linked to ${shortHash(user.pubkey, 6)}.`
                    : "Use Connect or another Nostr signer to return to your lab later."}
                </p>
              </div>
              {!user && (
                <button
                  className="button secondary"
                  onClick={() => {
                    setError("");
                    setDialog("account");
                  }}
                >
                  Sign in
                  <ArrowRight size={17} />
                </button>
              )}
            </li>
            <li>
              <span className={nodeReady ? "complete" : ""}>
                {nodeReady ? <Check size={18} /> : "2"}
              </span>
              <div>
                <strong>
                  {nodeReady
                    ? "Bitcoin Core is ready"
                    : "Start the regtest node"}
                </strong>
                <p>
                  {nodeReady
                    ? "The service verified a running regtest node."
                    : "Run the complete local lab, then check its status."}
                </p>
                {!nodeReady && (
                  <code className="setup-command">./start.sh sandbox</code>
                )}
              </div>
              <button
                className="icon-button"
                onClick={() => void checkNode()}
                disabled={Boolean(busy)}
                aria-label="Check Bitcoin Core status"
              >
                {busy === "status" ? <Spinner /> : <ArrowClockwise size={19} />}
              </button>
            </li>
            <li>
              <span className={lab ? "complete" : ""}>
                {lab ? <Check size={18} /> : "3"}
              </span>
              <div>
                <strong>Create your wallet pair</strong>
                <p>
                  Alpha and Beta each receive 1,000,000 valueless regtest sats.
                </p>
              </div>
            </li>
          </ol>
          <button
            className="button primary"
            disabled={Boolean(busy) || !user || !nodeReady}
            onClick={() => void startLab()}
          >
            {busy === "start" ? <Spinner /> : <Play size={18} weight="fill" />}
            Create lab
          </button>
          <div className="shared-chain-note">
            <ShieldCheck size={18} />
            <p>
              Your wallets belong to your account. Mining advances the shared
              regtest chain.
            </p>
          </div>
        </div>
      </section>
    );
  }
  function transactionTable(entries: LedgerEntry[], limited = false) {
    return (
      <div className="table-wrap">
        <table className="transaction-table">
          <thead>
            <tr>
              <th>Transaction</th>
              <th>Wallet</th>
              <th>Amount</th>
              <th>Status</th>
              <th>
                <span className="sr-only">Inspect</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {(limited ? entries.slice(0, 6) : entries).map((transaction) => (
              <tr key={transaction.txid}>
                <td>
                  <div className="transaction-name">
                    <span
                      className={`transaction-icon ${transaction.type === "send" ? "sent" : ""}`}
                    >
                      {transaction.type === "send" ? (
                        <ArrowUpRight size={18} />
                      ) : (
                        <ArrowDownLeft size={18} />
                      )}
                    </span>
                    <div>
                      <button
                        className="transaction-link"
                        onClick={() => void inspect(transaction.txid)}
                      >
                        {transaction.type === "send"
                          ? "Sent transaction"
                          : "Received transaction"}
                      </button>
                      <span>
                        {shortHash(transaction.txid, 6)} ·{" "}
                        {dateTime(transaction.at)}
                      </span>
                    </div>
                  </div>
                </td>
                <td>
                  {transaction.relatedWalletIds.length > 1
                    ? transaction.walletId === "alpha"
                      ? "Alpha → Beta"
                      : "Beta → Alpha"
                    : transaction.walletName.replace("Wallet ", "")}
                </td>
                <td className="mono">
                  {transaction.type === "send" ? "−" : "+"}
                  {formatAmount(Math.abs(transaction.amountSats))}
                  <small>{displayUnit}</small>
                </td>
                <td>
                  <Chip
                    tone={transaction.confirmations > 0 ? "success" : "amber"}
                  >
                    {transaction.confirmations > 0
                      ? `${transaction.confirmations} confirmed`
                      : "Pending"}
                  </Chip>
                </td>
                <td>
                  <button
                    className="icon-button"
                    onClick={() => void inspect(transaction.txid)}
                    disabled={Boolean(busy)}
                    aria-label={`Inspect transaction ${transaction.txid}`}
                  >
                    <ArrowRight size={18} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div
      className={`sandbox ${preferences.reduceMotion ? "reduce-motion" : ""}`}
    >
      <a
        href="#main-content"
        className="skip-link"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        Skip to content
      </a>
      <div className="page-shell" inert={Boolean(dialog)}>
        <header className="site-header">
          <div className="header-inner container">
            <Brand onClick={() => go("home")} />
            <nav className="desktop-nav" aria-label="Main navigation">
              {navigation.map((item) => (
                <a
                  key={item.id}
                  href={`#${item.id}`}
                  aria-current={route === item.id ? "page" : undefined}
                  className={route === item.id ? "active" : ""}
                >
                  <item.icon size={17} />
                  {item.label}
                </a>
              ))}
            </nav>
            <div className="header-utilities">
              <Chip tone="amber">
                <span className="status-dot" />
                Regtest
              </Chip>
              <button
                className="icon-button help-button"
                onClick={() => go("help")}
                aria-label="Sandbox help"
              >
                <Info size={21} />
              </button>
              <button
                className={`account-button ${user ? "connected" : ""}`}
                onClick={() => (user ? go("settings") : setDialog("account"))}
                aria-label={
                  user ? "Open account settings" : "Sign in with Nostr"
                }
              >
                <UserCircle size={23} />
                <span>{user ? preferences.displayName : "Sign in"}</span>
              </button>
            </div>
          </div>
          <nav className="mobile-nav" aria-label="Phone navigation">
            {navigation.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                aria-current={route === item.id ? "page" : undefined}
                className={route === item.id ? "active" : ""}
              >
                <item.icon size={19} />
                <span>{item.label}</span>
              </a>
            ))}
          </nav>
        </header>
        {route !== "home" && (
          <div className="workspace-bar container">
            <span>
              <span
                className={`status-dot ${!nodeReady || !online ? "offline" : "success"}`}
              />
              {loading
                ? "Checking your lab…"
                : !online
                  ? "You are offline · no actions are sent"
                  : !serviceReady
                    ? "Lab service unavailable"
                    : !nodeReady
                      ? "Regtest node offline"
                      : user?.demo
                        ? "Local practice · real regtest operations"
                        : user
                          ? "Signed in · Bitcoin Core regtest"
                          : "Explore freely · sign in to create a lab"}
            </span>
            <div>
              {lab && (
                <span className="block-height">
                  <Cube size={16} />
                  <span>Block</span>
                  <code>{formatSats(lab.blockHeight)}</code>
                </span>
              )}
              <button
                className="icon-button"
                onClick={() => go("settings")}
                aria-label="Open lab settings"
              >
                <Gear size={18} />
              </button>
            </div>
          </div>
        )}
        <main
          id="main-content"
          className={route === "home" ? "landing-main" : "container app-main"}
          tabIndex={-1}
        >
          {error && !dialog && (
            <div className="feedback error-feedback" role="alert">
              <WarningCircle size={21} />
              <p>{error}</p>
              <button
                className="icon-button"
                onClick={() => setError("")}
                aria-label="Dismiss error"
              >
                <X size={19} />
              </button>
            </div>
          )}
          {route === "home" && (
            <>
              <section className="hero container">
                <div className="hero-copy">
                  <h1 ref={pageHeading} tabIndex={-1}>
                    Make Bitcoin
                    <br /> <span>make sense.</span>
                  </h1>
                  <p>
                    Build a transaction. Follow the change. Mine a block. See
                    what really happens inside Bitcoin, with test coins that
                    have no monetary value.
                  </p>
                  <div className="hero-actions">
                    <button
                      className="button primary large"
                      onClick={() => (lab ? go("lab") : void startLab())}
                      disabled={Boolean(busy)}
                    >
                      {busy === "start" ? <Spinner /> : <Flask size={21} />}
                      {lab ? "Continue your lab" : "Open your lab"}
                      <ArrowRight size={20} />
                    </button>
                    <button
                      className="text-button"
                      onClick={() => go("experiments")}
                    >
                      Explore the experiments
                      <ArrowUpRight size={18} />
                    </button>
                  </div>
                  <div className="hero-note">
                    <ShieldCheck size={18} />
                    <span>
                      Real Bitcoin Core operations. Valueless regtest coins.
                    </span>
                  </div>
                </div>
                <div className="hero-mechanism">
                  <TransactionAnatomy illustrative />
                  <div className="hero-mechanism-foot">
                    <span>
                      <span className="status-dot" />
                      Inspect every part
                    </span>
                    <span>Click an input, output or fee</span>
                  </div>
                </div>
              </section>
              <div className="technology-strip">
                <div className="container">
                  <span>
                    <Cube size={22} />
                    Bitcoin Core<small>Real wallet operations</small>
                  </span>
                  <span>
                    <GitBranch size={22} />
                    UTXOs, made visible<small>Inputs, outputs and change</small>
                  </span>
                  <span>
                    <ShieldCheck size={22} />A safe place to learn
                    <small>Private wallets · shared test chain</small>
                  </span>
                </div>
              </div>
              <section className="landing-experiments container">
                <div className="section-intro">
                  <h2>
                    From an input
                    <br /> to a block.
                  </h2>
                  <p>
                    Three short experiments turn protocol concepts into
                    something you can do, inspect, and explain yourself.
                  </p>
                  <button
                    className="text-button"
                    onClick={() => go("experiments")}
                  >
                    Open the experiment guide
                    <ArrowRight size={18} />
                  </button>
                </div>
                <div className="experiment-index">
                  {experiments.map((experiment, index) => (
                    <button
                      className="experiment-index-row"
                      key={experiment.id}
                      onClick={() => go("experiments", experiment.id)}
                    >
                      <span className="sequence-number">{index + 1}</span>
                      <div>
                        <h3>{experiment.title}</h3>
                        <p>{experiment.summary}</p>
                        <span>{experiment.minutes}</span>
                      </div>
                      <ArrowUpRight size={23} />
                    </button>
                  ))}
                </div>
              </section>
              <section className="landing-bottom container">
                <div>
                  <h2>
                    Learn the protocol
                    <br /> by using it.
                  </h2>
                  <p>
                    Made for new Bitcoin developers, workshop facilitators, and
                    curious learners in Nigeria, West Africa, and everywhere
                    else.
                  </p>
                </div>
                <button
                  className="button primary large"
                  onClick={() => (lab ? go("lab") : void startLab())}
                  disabled={Boolean(busy)}
                >
                  Start experimenting
                  <ArrowRight size={20} />
                </button>
              </section>
            </>
          )}

          {route === "lab" && (
            <>
              {pageTitle(
                "Your Bitcoin workbench.",
                "Two wallets and a shared regtest chain. Every balance and output comes from Bitcoin Core.",
                lab && (
                  <>
                    <button
                      className="button secondary"
                      onClick={() => void refreshLab()}
                      disabled={Boolean(busy)}
                    >
                      <ArrowClockwise size={18} />
                      Refresh lab
                    </button>
                    <button
                      className="button primary"
                      onClick={() => void mine()}
                      disabled={Boolean(busy) || !nodeReady || !online}
                    >
                      {busy === "mine" ? <Spinner /> : <Cube size={18} />}Mine 1
                      block
                    </button>
                  </>
                ),
              )}
              {loading ? (
                <div className="loading-panel">
                  <Spinner size={30} />
                  <p>Opening your lab…</p>
                </div>
              ) : !lab || !user ? (
                labRequired()
              ) : (
                <>
                  <div className="wallet-strip">
                    {lab.wallets.map((wallet) => (
                      <button
                        key={wallet.id}
                        className={`wallet-card ${activeWallet === wallet.id ? "active" : ""}`}
                        aria-pressed={activeWallet === wallet.id}
                        onClick={() => {
                          setActiveWallet(wallet.id);
                          setSelectedUtxo(null);
                          setShowAllUtxos(false);
                        }}
                      >
                        <div className="wallet-card-title">
                          <span className={`wallet-symbol ${wallet.id}`}>
                            {wallet.id === "alpha" ? "A" : "B"}
                          </span>
                          <strong>{wallet.name}</strong>
                          <span className="wallet-card-selected">
                            {activeWallet === wallet.id ? (
                              <CheckCircle size={18} weight="fill" />
                            ) : (
                              <ArrowUpRight size={18} />
                            )}
                          </span>
                        </div>
                        <div className="wallet-card-balance">
                          <strong>{formatAmount(wallet.balanceSats)}</strong>
                          <span>{displayUnit}</span>
                        </div>
                        <div className="wallet-card-footer">
                          <span>
                            {wallet.utxos.length} available{" "}
                            {wallet.utxos.length === 1 ? "output" : "outputs"}
                          </span>
                          <span>
                            {wallet.pendingSats
                              ? `${formatAmount(wallet.pendingSats)} pending`
                              : "No pending balance"}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                  <section className="lab-workspace">
                    <div className="wallet-graph">
                      <div className="panel-heading">
                        <div>
                          <h2>Available outputs</h2>
                          <p>
                            Choose a UTXO to inspect the coin your wallet can
                            spend.
                          </p>
                        </div>
                        <Chip>{activeLabWallet?.name}</Chip>
                      </div>
                      {activeLabWallet && activeLabWallet.utxos.length > 0 ? (
                        <div className="utxo-graph">
                          <div className="graph-wallet-node">
                            <Wallet size={34} weight="duotone" />
                            <strong>{activeLabWallet.name}</strong>
                            <span>{activeLabWallet.utxos.length} outputs</span>
                          </div>
                          <div className="graph-output-list">
                            {(showAllUtxos
                              ? activeLabWallet.utxos
                              : activeLabWallet.utxos.slice(0, 5)
                            ).map((utxo) => (
                              <button
                                key={`${utxo.txid}:${utxo.vout}`}
                                className={`utxo-node ${selectedUtxo?.txid === utxo.txid && selectedUtxo.vout === utxo.vout ? "selected" : ""}`}
                                onClick={() => setSelectedUtxo(utxo)}
                                aria-pressed={
                                  selectedUtxo?.txid === utxo.txid &&
                                  selectedUtxo.vout === utxo.vout
                                }
                              >
                                <div>
                                  <span className="utxo-index">
                                    Output {utxo.vout}
                                  </span>
                                  <code>{shortHash(utxo.txid, 5)}</code>
                                </div>
                                <div>
                                  <strong>
                                    {formatAmount(utxo.amountSats)}
                                    <small>{displayUnit}</small>
                                  </strong>
                                  <span
                                    className={
                                      utxo.confirmations > 0
                                        ? "confirmed-text"
                                        : "pending-text"
                                    }
                                  >
                                    {utxo.confirmations > 0
                                      ? `${utxo.confirmations} confirmations`
                                      : "Unconfirmed"}
                                  </span>
                                </div>
                                <ArrowRight size={18} />
                              </button>
                            ))}
                            {activeLabWallet.utxos.length > 5 && (
                              <button
                                className="text-button"
                                onClick={() => setShowAllUtxos(!showAllUtxos)}
                              >
                                {showAllUtxos
                                  ? "Show fewer outputs"
                                  : `Show all ${activeLabWallet.utxos.length} outputs`}
                                <ArrowDown size={16} />
                              </button>
                            )}
                          </div>
                        </div>
                      ) : (
                        <EmptyState title="No available outputs">
                          This wallet has no unspent outputs available. Refresh
                          after a transaction or inspect the other wallet.
                        </EmptyState>
                      )}
                      <div className="graph-caption">
                        <span>
                          <span className="legend-dot" />
                          Wallet-controlled output
                        </span>
                        <span>
                          <span className="legend-dot muted" />
                          Select to inspect
                        </span>
                      </div>
                    </div>
                    <div className="output-inspector">
                      <h2>
                        {selectedUtxo
                          ? `Output ${selectedUtxo.vout}`
                          : "A balance is a set of coins."}
                      </h2>
                      {selectedUtxo ? (
                        <>
                          <Chip
                            tone={
                              selectedUtxo.confirmations > 0
                                ? "success"
                                : "amber"
                            }
                          >
                            {selectedUtxo.confirmations > 0
                              ? "Confirmed UTXO"
                              : "Unconfirmed UTXO"}
                          </Chip>
                          <div className="inspector-amount">
                            <strong>
                              {formatAmount(selectedUtxo.amountSats)}
                            </strong>
                            <span>{displayUnit}</span>
                          </div>
                          <dl className="inspector-details">
                            <div>
                              <dt>Transaction ID</dt>
                              <dd>
                                <HashValue
                                  value={selectedUtxo.txid}
                                  onCopy={(value, label) =>
                                    void copy(value, label)
                                  }
                                  label="Transaction ID"
                                />
                              </dd>
                            </div>
                            <div>
                              <dt>Output index</dt>
                              <dd className="mono">{selectedUtxo.vout}</dd>
                            </div>
                            <div>
                              <dt>Confirmations</dt>
                              <dd className="mono">
                                {selectedUtxo.confirmations}
                              </dd>
                            </div>
                            <div>
                              <dt>Spendable</dt>
                              <dd>
                                {selectedUtxo.spendable
                                  ? "Yes · wallet can sign"
                                  : "Not currently spendable"}
                              </dd>
                            </div>
                          </dl>
                          <button
                            className="button secondary full"
                            onClick={() => void inspect(selectedUtxo.txid)}
                            disabled={Boolean(busy)}
                          >
                            Inspect transaction
                            <ArrowUpRight size={18} />
                          </button>
                        </>
                      ) : (
                        <>
                          <div className="inspector-diagram" aria-hidden="true">
                            <Cube size={38} />
                            <span>+</span>
                            <Cube size={30} />
                            <span>+</span>
                            <Cube size={24} />
                          </div>
                          <p>
                            A wallet adds up the outputs it can unlock. Each
                            output has a transaction ID, an index, and an
                            amount.
                          </p>
                          <p>
                            Select an output in the graph to see its actual
                            Bitcoin Core record.
                          </p>
                        </>
                      )}
                      <button
                        className="button primary full"
                        onClick={() => buildFrom(activeWallet)}
                      >
                        Build from {activeWallet === "alpha" ? "Alpha" : "Beta"}
                        <GitBranch size={18} />
                      </button>
                    </div>
                  </section>
                  <section className="recent-transactions">
                    <div className="section-heading">
                      <div>
                        <h2>Recent transactions</h2>
                        <p>Your wallet activity, read from the node.</p>
                      </div>
                      <button
                        className="text-button"
                        onClick={() => go("explorer")}
                      >
                        Open explorer
                        <ArrowRight size={18} />
                      </button>
                    </div>
                    {ledger.length ? (
                      transactionTable(ledger, true)
                    ) : (
                      <EmptyState title="Your transaction history starts here">
                        Create a preview and broadcast a reviewed transaction to
                        see its record.
                      </EmptyState>
                    )}
                  </section>
                  <div className="shared-chain-note bottom-note">
                    <Info size={18} />
                    <p>
                      Regtest coins have no monetary value. Mining advances the
                      shared node’s chain, so another learner’s block can also
                      confirm your transaction.
                    </p>
                  </div>
                </>
              )}
            </>
          )}

          {route === "builder" && (
            <>
              {pageTitle(
                "Build a transaction.",
                "Choose your wallets and amount. Inspect the Core-prepared preview before you sign and broadcast.",
              )}
              {!lab || !user ? (
                labRequired()
              ) : (
                <>
                  {uncertain && (
                    <div className="recovery-panel" role="status">
                      <WarningCircle size={27} />
                      <div>
                        <h2>Check this transaction before sending again.</h2>
                        <p>
                          The broadcast result is unresolved. Checking reads the
                          node and the saved attempt; it never sends another
                          transaction.
                        </p>
                        <code>{preview?.id}</code>
                      </div>
                      <button
                        className="button secondary"
                        onClick={() => void reconcile()}
                        disabled={Boolean(busy)}
                      >
                        {busy === "reconcile" ? (
                          <Spinner />
                        ) : (
                          <ArrowClockwise size={18} />
                        )}
                        Check transaction status
                      </button>
                    </div>
                  )}
                  {previewStatus === "broadcast" && (
                    <div className="broadcast-success">
                      <CheckCircle size={25} />
                      <div>
                        <strong>Your transaction was broadcast.</strong>
                        <p>
                          It can now be inspected in the node’s ledger. Mine a
                          block to check confirmation.
                        </p>
                      </div>
                      <button
                        className="button secondary"
                        onClick={() => void inspect(recentTxid)}
                        disabled={Boolean(busy)}
                      >
                        Inspect transaction
                        <ArrowRight size={17} />
                      </button>
                    </div>
                  )}
                  <div className="builder-layout">
                    <section className="transaction-form-panel">
                      <form onSubmit={(event) => void createPreview(event)}>
                        <div className="panel-heading">
                          <h2>Payment details</h2>
                          <Chip>No monetary value</Chip>
                        </div>
                        <div className="wallet-select-grid">
                          <label htmlFor="from-wallet">
                            From wallet
                            <select
                              id="from-wallet"
                              value={fromWallet}
                              disabled={Boolean(busy) || uncertain}
                              onChange={(event) => {
                                const from = event.target.value as WalletId;
                                setFromWallet(from);
                                setToWallet(
                                  from === "alpha" ? "beta" : "alpha",
                                );
                                discardPreviewForEdit();
                              }}
                            >
                              <option value="alpha">Wallet Alpha</option>
                              <option value="beta">Wallet Beta</option>
                            </select>
                          </label>
                          <button
                            className="swap-button"
                            type="button"
                            onClick={() => {
                              setFromWallet(toWallet);
                              setToWallet(fromWallet);
                              discardPreviewForEdit();
                            }}
                            disabled={Boolean(busy) || uncertain}
                            aria-label="Swap sending and receiving wallets"
                          >
                            <ArrowsLeftRight size={20} />
                          </button>
                          <label htmlFor="to-wallet">
                            To wallet
                            <select
                              id="to-wallet"
                              value={toWallet}
                              disabled={Boolean(busy) || uncertain}
                              onChange={(event) => {
                                const to = event.target.value as WalletId;
                                setToWallet(to);
                                setFromWallet(
                                  to === "alpha" ? "beta" : "alpha",
                                );
                                discardPreviewForEdit();
                              }}
                            >
                              <option value="beta">Wallet Beta</option>
                              <option value="alpha">Wallet Alpha</option>
                            </select>
                          </label>
                        </div>
                        <div className="form-balance">
                          Available in{" "}
                          {fromWallet === "alpha" ? "Alpha" : "Beta"}
                          <strong>
                            {formatAmount(sourceWallet?.balanceSats ?? 0)}{" "}
                            {displayUnit}
                          </strong>
                        </div>
                        <label className="field-label" htmlFor="send-amount">
                          Amount to send
                        </label>
                        <div className="amount-input">
                          <input
                            id="send-amount"
                            type="number"
                            min={600}
                            max={1000000}
                            step={1}
                            inputMode="numeric"
                            value={sendAmount}
                            disabled={Boolean(busy) || uncertain}
                            onChange={(event) => {
                              setSendAmount(event.target.value);
                              discardPreviewForEdit();
                            }}
                            required
                          />
                          <span>sats</span>
                        </div>
                        <p className="field-hint">
                          Send between 600 and 1,000,000 regtest sats. The fee
                          is paid separately.
                        </p>
                        <div className="amount-presets">
                          {[10000, 20000, 50000].map((value) => (
                            <button
                              className={
                                Number(sendAmount) === value ? "active" : ""
                              }
                              type="button"
                              key={value}
                              disabled={Boolean(busy) || uncertain}
                              onClick={() => {
                                setSendAmount(String(value));
                                discardPreviewForEdit();
                              }}
                            >
                              {formatSats(value)} sats
                            </button>
                          ))}
                        </div>
                        <label className="field-label" htmlFor="fee-rate">
                          Fee rate
                        </label>
                        <div className="fee-input">
                          <input
                            id="fee-rate"
                            type="number"
                            min={1}
                            max={50}
                            step={0.1}
                            inputMode="decimal"
                            value={feeRate}
                            disabled={Boolean(busy) || uncertain}
                            onChange={(event) => {
                              setFeeRate(event.target.value);
                              discardPreviewForEdit();
                            }}
                            required
                          />
                          <span>sats / vB</span>
                        </div>
                        <p className="field-hint">
                          Regtest does not predict mainnet fees. Try different
                          rates and compare the resulting fee.
                        </p>
                        <div className="recipient-details">
                          <strong>Receiving address</strong>
                          <code>{recipientWallet?.address}</code>
                          <button
                            type="button"
                            className="text-button"
                            onClick={() =>
                              recipientWallet &&
                              void copy(
                                recipientWallet.address,
                                "Receiving address",
                              )
                            }
                          >
                            <Copy size={16} />
                            Copy address
                          </button>
                        </div>
                        <button
                          className="button primary full"
                          type="submit"
                          disabled={
                            Boolean(busy) || uncertain || !nodeReady || !online
                          }
                        >
                          {busy === "preview" ? (
                            <Spinner />
                          ) : (
                            <GitBranch size={19} />
                          )}
                          {preview && previewStatus === "prepared"
                            ? "Rebuild preview"
                            : "Create preview"}
                          <ArrowRight size={18} />
                        </button>
                        <p className="form-footnote">
                          Preparing a preview does not sign or broadcast a
                          transaction.
                        </p>
                      </form>
                    </section>
                    <div className="preview-area">
                      {preview ? (
                        <>
                          <TransactionAnatomy preview={preview} />
                          <dl className="preview-details">
                            <div>
                              <dt>Estimated size</dt>
                              <dd>{preview.estimatedVbytes} vB</dd>
                            </div>
                            <div>
                              <dt>Fee rate</dt>
                              <dd>{preview.feeRate} sats/vB</dd>
                            </div>
                            <div>
                              <dt>Transaction fee</dt>
                              <dd>{formatSats(preview.feeSats)} sats</dd>
                            </div>
                            <div>
                              <dt>Fee replacement</dt>
                              <dd>
                                {preview.replaceable
                                  ? "Enabled · RBF"
                                  : "Not enabled"}
                              </dd>
                            </div>
                          </dl>
                          {previewStatus === "prepared" ? (
                            <div className="preview-action">
                              <div>
                                <strong>
                                  {previewExpired
                                    ? "This preview has expired."
                                    : "Ready for your review."}
                                </strong>
                                <p>
                                  {previewExpired
                                    ? "Create a fresh preview to use current wallet inputs."
                                    : `Preview expires in ${Math.max(0, Math.ceil((preview.expiresAt - tick) / 1000))} seconds.`}
                                </p>
                              </div>
                              <button
                                className="button primary"
                                onClick={() => {
                                  setReviewConfirmed(false);
                                  setError("");
                                  setDialog("broadcast");
                                }}
                                disabled={
                                  Boolean(busy) || previewExpired || !online
                                }
                              >
                                Review and broadcast
                                <ArrowRight size={18} />
                              </button>
                            </div>
                          ) : (
                            <div className="preview-action">
                              <div>
                                <strong>
                                  {previewStatus === "broadcast"
                                    ? "Broadcast to Bitcoin Core"
                                    : previewStatus === "failed"
                                      ? "Attempt failed"
                                      : previewStatus === "expired"
                                        ? "Preview expired"
                                        : "Result awaiting verification"}
                                </strong>
                                <p>
                                  {previewStatus === "broadcast"
                                    ? shortHash(recentTxid)
                                    : "Use the status check before creating another payment."}
                                </p>
                              </div>
                              {uncertain && (
                                <button
                                  className="button secondary"
                                  onClick={() => void reconcile()}
                                  disabled={Boolean(busy)}
                                >
                                  Check status
                                  <ArrowClockwise size={18} />
                                </button>
                              )}
                            </div>
                          )}
                        </>
                      ) : (
                        <section className="preview-placeholder">
                          <div
                            className="preview-placeholder-diagram"
                            aria-hidden="true"
                          >
                            <Cube size={43} />
                            <ArrowRight size={25} />
                            <div>
                              <Cube size={32} />
                              <Cube size={25} />
                            </div>
                          </div>
                          <h2>See what you are about to send.</h2>
                          <p>
                            Your preview shows the exact inputs, payment, change
                            and fee chosen by Bitcoin Core.
                          </p>
                          <ol>
                            <li>
                              <span>1</span>Select an amount and fee rate.
                            </li>
                            <li>
                              <span>2</span>Inspect the transaction anatomy.
                            </li>
                            <li>
                              <span>3</span>Confirm signing and broadcast.
                            </li>
                          </ol>
                          <div className="preview-placeholder-note">
                            <ShieldCheck size={20} />
                            <span>
                              Wallet keys stay with the isolated Core service.
                            </span>
                          </div>
                        </section>
                      )}
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {route === "explorer" && (
            <>
              {pageTitle(
                "Follow every transaction.",
                "Inspect the inputs, outputs and confirmation state of transactions belonging to your lab.",
                lab && (
                  <button
                    className="button secondary"
                    onClick={() => void refreshLab()}
                    disabled={Boolean(busy)}
                  >
                    <ArrowClockwise size={18} />
                    Refresh ledger
                  </button>
                ),
              )}
              {!lab || !user ? (
                labRequired()
              ) : (
                <>
                  <form
                    className="transaction-lookup"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void inspect(lookupId, false);
                    }}
                  >
                    <label htmlFor="transaction-id">
                      Open a transaction from your lab
                    </label>
                    <div>
                      <input
                        id="transaction-id"
                        type="text"
                        spellCheck={false}
                        autoComplete="off"
                        maxLength={64}
                        placeholder="Paste a transaction ID"
                        value={lookupId}
                        onChange={(event) =>
                          setLookupId(event.target.value.trim())
                        }
                      />
                      <button
                        className="button primary"
                        type="submit"
                        disabled={Boolean(busy) || !lookupId}
                      >
                        {busy === "inspect" ? (
                          <Spinner />
                        ) : (
                          <MagnifyingGlass size={18} />
                        )}
                        Inspect
                      </button>
                    </div>
                  </form>
                  <section className="explorer-ledger">
                    <div className="ledger-toolbar">
                      <div className="search-field">
                        <MagnifyingGlass size={19} />
                        <label htmlFor="ledger-search" className="sr-only">
                          Filter transaction ledger
                        </label>
                        <input
                          id="ledger-search"
                          placeholder="Search transaction or wallet"
                          value={search}
                          onChange={(event) => setSearch(event.target.value)}
                        />
                      </div>
                      <div className="filter-group">
                        <label className="sr-only" htmlFor="ledger-state">
                          Filter by confirmation status
                        </label>
                        <select
                          id="ledger-state"
                          value={transactionFilter}
                          onChange={(event) =>
                            setTransactionFilter(
                              event.target.value as typeof transactionFilter,
                            )
                          }
                        >
                          <option value="all">All states</option>
                          <option value="pending">Pending</option>
                          <option value="confirmed">Confirmed</option>
                        </select>
                        <label className="sr-only" htmlFor="ledger-wallet">
                          Filter by wallet
                        </label>
                        <select
                          id="ledger-wallet"
                          value={walletFilter}
                          onChange={(event) =>
                            setWalletFilter(
                              event.target.value as typeof walletFilter,
                            )
                          }
                        >
                          <option value="all">Both wallets</option>
                          <option value="alpha">Alpha</option>
                          <option value="beta">Beta</option>
                        </select>
                      </div>
                    </div>
                    {filteredLedger.length ? (
                      transactionTable(filteredLedger)
                    ) : (
                      <EmptyState
                        title={
                          search ||
                          transactionFilter !== "all" ||
                          walletFilter !== "all"
                            ? "No matching transactions."
                            : "Nothing in the ledger yet."
                        }
                        action={
                          search ||
                          transactionFilter !== "all" ||
                          walletFilter !== "all" ? (
                            <button
                              className="button secondary"
                              onClick={() => {
                                setSearch("");
                                setWalletFilter("all");
                                setTransactionFilter("all");
                              }}
                            >
                              Clear filters
                            </button>
                          ) : (
                            <button
                              className="button primary"
                              onClick={() => go("builder")}
                            >
                              Build a transaction
                              <ArrowRight size={17} />
                            </button>
                          )
                        }
                      >
                        {search ||
                        transactionFilter !== "all" ||
                        walletFilter !== "all"
                          ? "Try another search or clear the current filters."
                          : "Prepare and broadcast a transaction to inspect it here."}
                      </EmptyState>
                    )}
                  </section>
                  {selectedTransaction && (
                    <section
                      className="transaction-detail"
                      aria-label="Selected transaction details"
                    >
                      <div className="section-heading">
                        <div>
                          <h2>Transaction details</h2>
                          <p>
                            Read from Bitcoin Core
                            {transactionReadAt
                              ? ` · ${dateTime(transactionReadAt)}`
                              : ""}
                            .
                          </p>
                        </div>
                        <div className="detail-actions">
                          <button
                            className="icon-button"
                            onClick={() =>
                              void inspect(selectedTransaction.txid, false)
                            }
                            disabled={Boolean(busy)}
                            aria-label="Refresh transaction confirmation"
                          >
                            <ArrowClockwise size={20} />
                          </button>
                          <button
                            className="button secondary"
                            onClick={() =>
                              saveJson(
                                selectedTransaction,
                                `bitcoin-transaction-${selectedTransaction.txid.slice(0, 10)}.json`,
                              )
                            }
                          >
                            <DownloadSimple size={18} />
                            Download JSON
                          </button>
                        </div>
                      </div>
                      <div className="transaction-identity">
                        <code>{selectedTransaction.txid}</code>
                        <button
                          className="icon-button"
                          onClick={() =>
                            void copy(
                              selectedTransaction.txid,
                              "Transaction ID",
                            )
                          }
                          aria-label="Copy selected transaction ID"
                        >
                          <Copy size={19} />
                        </button>
                      </div>
                      <dl className="transaction-facts">
                        <div>
                          <dt>Confirmations</dt>
                          <dd>
                            {selectedTransaction.confirmations ?? 0}
                            <Chip
                              tone={
                                (selectedTransaction.confirmations ?? 0) > 0
                                  ? "success"
                                  : "amber"
                              }
                            >
                              {(selectedTransaction.confirmations ?? 0) > 0
                                ? "In a block"
                                : "In mempool"}
                            </Chip>
                          </dd>
                        </div>
                        <div>
                          <dt>Virtual size</dt>
                          <dd>
                            {selectedTransaction.vsize}
                            <small>vB</small>
                          </dd>
                        </div>
                        <div>
                          <dt>Inputs</dt>
                          <dd>{selectedTransaction.vin.length}</dd>
                        </div>
                        <div>
                          <dt>Outputs</dt>
                          <dd>{selectedTransaction.vout.length}</dd>
                        </div>
                      </dl>
                      {selectedTransaction.blockhash && (
                        <div className="block-proof">
                          <Cube size={19} />
                          <div>
                            <strong>Included in block</strong>
                            <code>{selectedTransaction.blockhash}</code>
                          </div>
                          <button
                            className="icon-button"
                            onClick={() =>
                              selectedTransaction.blockhash &&
                              void copy(
                                selectedTransaction.blockhash,
                                "Block hash",
                              )
                            }
                            aria-label="Copy block hash"
                          >
                            <Copy size={18} />
                          </button>
                        </div>
                      )}
                      <div className="transaction-io">
                        <div>
                          <h3>Inputs spent</h3>
                          {selectedTransaction.vin.map((input, index) => (
                            <div
                              className="io-row"
                              key={`${input.txid || "coinbase"}:${index}`}
                            >
                              <span className="io-index">{index}</span>
                              <div>
                                <strong>
                                  {input.coinbase
                                    ? "Coinbase input"
                                    : `Previous output ${input.vout ?? 0}`}
                                </strong>
                                <code>
                                  {input.txid
                                    ? shortHash(input.txid, 7)
                                    : "Block reward transaction"}
                                </code>
                              </div>
                              {input.txid && (
                                <button
                                  className="icon-button"
                                  onClick={() =>
                                    input.txid &&
                                    void copy(
                                      input.txid,
                                      "Input transaction ID",
                                    )
                                  }
                                  aria-label={`Copy input ${index} transaction ID`}
                                >
                                  <Copy size={17} />
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                        <div>
                          <h3>Outputs created</h3>
                          {selectedTransaction.vout.map((output) => (
                            <div className="io-row" key={output.n}>
                              <span className="io-index">{output.n}</span>
                              <div>
                                <strong>
                                  {formatAmount(
                                    Math.round(output.value * 100000000),
                                  )}{" "}
                                  {displayUnit}
                                </strong>
                                <code>
                                  {output.scriptPubKey.address
                                    ? shortHash(output.scriptPubKey.address, 7)
                                    : output.scriptPubKey.type}
                                </code>
                              </div>
                              {output.scriptPubKey.address && (
                                <button
                                  className="icon-button"
                                  onClick={() =>
                                    output.scriptPubKey.address &&
                                    void copy(
                                      output.scriptPubKey.address,
                                      `Output ${output.n} address`,
                                    )
                                  }
                                  aria-label={`Copy output ${output.n} address`}
                                >
                                  <Copy size={17} />
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                      {(selectedTransaction.confirmations ?? 0) === 0 && (
                        <div className="pending-transaction-note">
                          <Info size={19} />
                          <p>
                            This transaction has not entered a block. Mine one
                            regtest block, then refresh the confirmation count.
                          </p>
                          <button
                            className="button primary"
                            onClick={() => void mine()}
                            disabled={Boolean(busy) || !nodeReady}
                          >
                            {busy === "mine" ? <Spinner /> : <Cube size={17} />}
                            Mine 1 block
                          </button>
                        </div>
                      )}
                    </section>
                  )}
                </>
              )}
            </>
          )}

          {route === "experiments" && (
            <>
              {currentExperiment ? (
                <>
                  <button
                    className="text-button back-button"
                    onClick={() => go("experiments")}
                  >
                    <ArrowLeft size={17} />
                    All experiments
                  </button>
                  {pageTitle(
                    currentExperiment.title,
                    currentExperiment.summary,
                    <Chip tone={currentCompletion ? "success" : ""}>
                      {currentCompletion ? (
                        <>
                          <CheckCircle size={16} />
                          Verified
                        </>
                      ) : (
                        currentExperiment.minutes
                      )}
                    </Chip>,
                  )}
                  <section className="experiment-reader">
                    <div className="experiment-concept">
                      <BookOpen size={27} />
                      <p>{currentExperiment.concept}</p>
                    </div>
                    <ol className="experiment-steps">
                      {currentExperiment.steps.map((step, index) => (
                        <li key={step.title}>
                          <span className="step-index">{index + 1}</span>
                          <div>
                            <h2>{step.title}</h2>
                            <p>{step.body}</p>
                            {step.action && (
                              <button
                                className="text-button"
                                onClick={() =>
                                  step.action === "mine"
                                    ? void mine()
                                    : go(
                                        step.action === "builder"
                                          ? "builder"
                                          : step.action === "explorer"
                                            ? "explorer"
                                            : "lab",
                                      )
                                }
                                disabled={
                                  Boolean(busy) ||
                                  (step.action === "mine" &&
                                    (!lab || !nodeReady || !online))
                                }
                              >
                                {step.action === "mine" ? (
                                  busy === "mine" ? (
                                    <Spinner />
                                  ) : (
                                    <Cube size={17} />
                                  )
                                ) : null}
                                {step.action === "mine"
                                  ? "Mine 1 block"
                                  : step.action === "builder"
                                    ? "Open transaction builder"
                                    : step.action === "explorer"
                                      ? "Open explorer"
                                      : "Open laboratory"}
                                <ArrowRight size={17} />
                              </button>
                            )}
                          </div>
                        </li>
                      ))}
                    </ol>
                    <div className="experiment-verification">
                      <div>
                        <ShieldCheck size={30} />
                        <h2>
                          {currentCompletion
                            ? "Your transaction proves it."
                            : "Check what you did."}
                        </h2>
                        <p>
                          {currentCompletion
                            ? "This experiment was completed after the service verified your own Bitcoin Core transaction."
                            : "Choose a transaction you broadcast. The service checks the actual transaction before marking this experiment complete."}
                        </p>
                      </div>
                      {currentCompletion ? (
                        <div className="experiment-receipt">
                          <Chip tone="success">
                            <CheckCircle size={17} />
                            Core verified
                          </Chip>
                          {currentCompletion.txid && (
                            <HashValue
                              value={currentCompletion.txid}
                              onCopy={(value, label) => void copy(value, label)}
                              label="Verified transaction ID"
                            />
                          )}
                          {currentCompletion.completedAt && (
                            <span>
                              {dateTime(currentCompletion.completedAt)}
                            </span>
                          )}
                          <button
                            className="button secondary"
                            onClick={() =>
                              currentCompletion.txid &&
                              void inspect(currentCompletion.txid)
                            }
                            disabled={Boolean(busy) || !currentCompletion.txid}
                          >
                            Inspect the proof
                            <ArrowRight size={17} />
                          </button>
                        </div>
                      ) : !user || !lab ? (
                        <button
                          className="button primary"
                          onClick={() => void startLab()}
                          disabled={Boolean(busy)}
                        >
                          Open your lab
                          <ArrowRight size={18} />
                        </button>
                      ) : !sentTransactions.length ? (
                        <button
                          className="button primary"
                          onClick={() => go("builder")}
                        >
                          Build your first transaction
                          <ArrowRight size={18} />
                        </button>
                      ) : (
                        <form
                          onSubmit={(event) => void completeExperiment(event)}
                        >
                          <label htmlFor="experiment-transaction">
                            Your broadcast transaction
                          </label>
                          <select
                            id="experiment-transaction"
                            value={experimentTxid}
                            required
                            onChange={(event) =>
                              setExperimentTxid(event.target.value)
                            }
                          >
                            <option value="">Choose a transaction</option>
                            {sentTransactions.map((transaction) => (
                              <option
                                key={transaction.txid}
                                value={transaction.txid}
                              >
                                {shortHash(transaction.txid, 7)} ·{" "}
                                {formatSats(Math.abs(transaction.amountSats))}{" "}
                                sats
                              </option>
                            ))}
                          </select>
                          {experimentId === "utxos" && (
                            <>
                              <label htmlFor="change-output-index">
                                Which output is change?
                              </label>
                              <input
                                id="change-output-index"
                                type="number"
                                min={0}
                                max={20}
                                step={1}
                                value={changeOutputIndex}
                                onChange={(event) =>
                                  setChangeOutputIndex(event.target.value)
                                }
                                required
                                inputMode="numeric"
                                placeholder="Output index"
                              />
                              <p className="field-hint">
                                Read the preview or Explorer and enter the
                                change output’s index.
                              </p>
                            </>
                          )}
                          <button
                            className="button primary full"
                            type="submit"
                            disabled={
                              Boolean(busy) ||
                              !experimentTxid ||
                              (experimentId === "utxos" &&
                                changeOutputIndex === "")
                            }
                          >
                            {busy === "experiment" ? (
                              <Spinner />
                            ) : (
                              <ShieldCheck size={18} />
                            )}
                            Verify experiment
                          </button>
                        </form>
                      )}
                    </div>
                  </section>
                </>
              ) : (
                <>
                  {pageTitle(
                    "Learn by looking closer.",
                    "Three guided experiments. Every completion is checked against your own Bitcoin Core transaction.",
                    <Chip tone={completedCount === 3 ? "success" : "amber"}>
                      {completedCount}/3 verified
                    </Chip>,
                  )}
                  <div className="experiments-page">
                    {experiments.map((experiment, index) => {
                      const complete = progress.experiments.find(
                        (item) => item.id === experiment.id && item.completed,
                      );
                      return (
                        <section
                          className={`experiment-row ${complete ? "complete" : ""}`}
                          key={experiment.id}
                        >
                          <div className="experiment-visual" aria-hidden="true">
                            {index === 0 ? (
                              <>
                                <Cube size={45} />
                                <ArrowRight size={23} />
                                <Cube size={36} />
                              </>
                            ) : index === 1 ? (
                              <>
                                <Cube size={45} />
                                <GitBranch size={39} />
                                <span>
                                  <Cube size={31} />
                                  <Cube size={23} />
                                </span>
                              </>
                            ) : (
                              <>
                                <SquaresFour size={46} />
                                <ArrowRight size={23} />
                                <Cube size={42} />
                              </>
                            )}
                          </div>
                          <div className="experiment-row-copy">
                            <div>
                              <Chip>{experiment.minutes}</Chip>
                              {complete && (
                                <Chip tone="success">
                                  <CheckCircle size={15} />
                                  Verified
                                </Chip>
                              )}
                            </div>
                            <h2>{experiment.title}</h2>
                            <p>{experiment.summary}</p>
                            <button
                              className="button secondary"
                              onClick={() => go("experiments", experiment.id)}
                            >
                              {complete
                                ? "Revisit experiment"
                                : "Start experiment"}
                              <ArrowRight size={18} />
                            </button>
                          </div>
                        </section>
                      );
                    })}
                    <div className="experiments-info">
                      <Info size={20} />
                      <p>
                        Experiments use valueless regtest coins. The stated
                        times are estimates. Mining advances the shared test
                        chain, so inspect current confirmations rather than
                        assuming them.
                      </p>
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {route === "settings" && (
            <>
              {pageTitle(
                "Make the lab yours.",
                "Save display preferences, inspect your identity, and take your verified records with you.",
              )}
              {!user ? (
                <EmptyState
                  icon={<UserCircle size={36} />}
                  title="An identity you can return to."
                  action={
                    <button
                      className="button primary"
                      onClick={() => setDialog("account")}
                    >
                      Sign in with Nostr
                      <ArrowRight size={18} />
                    </button>
                  }
                >
                  Sign in to save your lab preferences and keep your wallet runs
                  together.
                </EmptyState>
              ) : (
                <div className="settings-layout">
                  <section className="preferences-panel">
                    <h2>Lab preferences</h2>
                    <form onSubmit={(event) => void savePreferences(event)}>
                      <label htmlFor="display-name">
                        What should we call you?
                      </label>
                      <input
                        id="display-name"
                        type="text"
                        maxLength={50}
                        autoComplete="nickname"
                        value={draftPreferences.displayName}
                        onChange={(event) =>
                          setDraftPreferences((value) => ({
                            ...value,
                            displayName: event.target.value,
                          }))
                        }
                        required
                      />
                      <div className="preferences-fields">
                        <label htmlFor="display-unit">
                          Balance display
                          <select
                            id="display-unit"
                            value={draftPreferences.unit}
                            onChange={(event) =>
                              setDraftPreferences((value) => ({
                                ...value,
                                unit: event.target.value as Preferences["unit"],
                              }))
                            }
                          >
                            <option value="sats">Satoshis (sats)</option>
                            <option value="btc">Test BTC</option>
                          </select>
                        </label>
                        <label htmlFor="default-fee-rate">
                          Default fee rate
                          <input
                            id="default-fee-rate"
                            type="number"
                            min={1}
                            max={50}
                            step={0.1}
                            inputMode="decimal"
                            value={draftPreferences.defaultFeeRate}
                            onChange={(event) =>
                              setDraftPreferences((value) => ({
                                ...value,
                                defaultFeeRate: Number(event.target.value),
                              }))
                            }
                            required
                          />
                        </label>
                      </div>
                      <label className="checkbox-field">
                        <input
                          type="checkbox"
                          checked={draftPreferences.autoRefresh}
                          onChange={(event) =>
                            setDraftPreferences((value) => ({
                              ...value,
                              autoRefresh: event.target.checked,
                            }))
                          }
                        />
                        <span>
                          <strong>Refresh the lab automatically</strong>
                          <small>
                            Read updated wallet and block data every 15 seconds
                            while this page is visible.
                          </small>
                        </span>
                      </label>
                      <label className="checkbox-field">
                        <input
                          type="checkbox"
                          checked={draftPreferences.reduceMotion}
                          onChange={(event) =>
                            setDraftPreferences((value) => ({
                              ...value,
                              reduceMotion: event.target.checked,
                            }))
                          }
                        />
                        <span>
                          <strong>Reduce interface motion</strong>
                          <small>
                            Your device’s reduced-motion preference is always
                            respected.
                          </small>
                        </span>
                      </label>
                      <button
                        className="button primary"
                        type="submit"
                        disabled={Boolean(busy)}
                      >
                        {busy === "preferences" ? (
                          <Spinner />
                        ) : (
                          <Check size={18} />
                        )}
                        Save preferences
                      </button>
                    </form>
                    <div className="account-identity">
                      <h2>Your learning identity</h2>
                      <p>
                        {user.demo
                          ? "Local practice identity. This account is for controlled regtest demonstrations."
                          : temporary
                            ? "Temporary Nostr identity. Its key is held only in this browser tab’s memory."
                            : "Your Nostr public key links your private wallet runs and experiment record."}
                      </p>
                      <div className="public-key">
                        <code>{user.pubkey}</code>
                        <button
                          className="icon-button"
                          onClick={() => void copy(user.pubkey, "Public key")}
                          aria-label="Copy Nostr public key"
                        >
                          <Copy size={20} />
                        </button>
                      </div>
                      {temporary && (
                        <div className="identity-warning">
                          <WarningCircle size={20} />
                          <p>
                            {hasTemporaryKey()
                              ? "Use Connect or another signer for an identity you can keep. Closing or reloading this tab loses the temporary signing key."
                              : "Reloading lost this temporary signing key. Your session can still work, but the identity cannot be restored after sign-out or expiry."}
                          </p>
                        </div>
                      )}
                      <button
                        className="button secondary"
                        onClick={() => void logout()}
                        disabled={Boolean(busy)}
                      >
                        {busy === "logout" ? (
                          <Spinner />
                        ) : (
                          <SignOut size={18} />
                        )}
                        Sign out
                      </button>
                    </div>
                  </section>
                  <div className="settings-actions">
                    <section className="record-export">
                      <DownloadSimple size={30} />
                      <h2>Take your proof with you.</h2>
                      <p>
                        Download your wallet-run records, preferences,
                        experiments and transaction receipts as JSON. Wallet
                        private keys and signing material are excluded.
                      </p>
                      <button
                        className="button secondary full"
                        onClick={() => void exportLab()}
                        disabled={Boolean(busy)}
                      >
                        {busy === "export" ? (
                          <Spinner />
                        ) : (
                          <DownloadSimple size={18} />
                        )}
                        Download lab record
                      </button>
                    </section>
                    <section className="fresh-run">
                      <h2>A fresh pair of wallets.</h2>
                      <p>
                        Create a new run with newly funded Alpha and Beta
                        wallets. Review or resolve any pending broadcast before
                        resetting.
                      </p>
                      <button
                        className="text-button danger-text"
                        onClick={() => {
                          setResetText("");
                          setError("");
                          setDialog("reset");
                        }}
                        disabled={Boolean(busy) || !lab}
                      >
                        <ArrowClockwise size={18} />
                        Reset wallet run
                      </button>
                    </section>
                    <section className="lab-facts">
                      <h2>Lab facts</h2>
                      <dl>
                        <div>
                          <dt>Network</dt>
                          <dd>Bitcoin Core regtest</dd>
                        </div>
                        <div>
                          <dt>Coin value</dt>
                          <dd>No monetary value</dd>
                        </div>
                        <div>
                          <dt>Verified experiments</dt>
                          <dd>{completedCount} of 3</dd>
                        </div>
                        <div>
                          <dt>Wallet runs</dt>
                          <dd>{progress.stats?.runs ?? (lab ? 1 : 0)}</dd>
                        </div>
                        <div>
                          <dt>Broadcasts</dt>
                          <dd>{progress.stats?.broadcasts ?? 0}</dd>
                        </div>
                      </dl>
                      <button
                        className="text-button"
                        onClick={() => go("help")}
                      >
                        How the lab works
                        <ArrowRight size={17} />
                      </button>
                    </section>
                  </div>
                </div>
              )}
            </>
          )}

          {route === "help" && (
            <>
              {pageTitle(
                "A clearer view of Bitcoin.",
                "The lab lets you inspect real wallet and transaction operations without risking real coins.",
              )}
              <div className="help-layout">
                <section className="help-guide">
                  <h2>Start with the mechanism.</h2>
                  <p>
                    Bitcoin Sandbox is a hands-on tool for learners and
                    developers. Bitcoin Core creates the wallets, chooses the
                    transaction inputs, signs the reviewed transaction, checks
                    the broadcast, and reports block inclusion.
                  </p>
                  <p>
                    Your two wallets belong to your signed-in account. The
                    regtest node’s chain is shared: a block mined by another
                    learner can confirm your transaction too.
                  </p>
                  <h2>How to get a working lab</h2>
                  <ol className="help-steps">
                    <li>
                      Run the one-command local setup on a Linux x64 machine
                      with Node.js 22.12+ and pnpm.
                      <code>./start.sh sandbox</code>
                    </li>
                    <li>
                      Open the local Sandbox and use a Nostr signer or a labeled
                      local practice session.
                    </li>
                    <li>
                      Create your lab. Alpha and Beta each receive 1,000,000
                      regtest sats.
                    </li>
                    <li>
                      Build a preview, inspect the anatomy, and explicitly
                      confirm broadcast.
                    </li>
                    <li>
                      Mine a regtest block, inspect the transaction, and verify
                      an experiment.
                    </li>
                  </ol>
                  <button
                    className="button primary"
                    onClick={() => (lab ? go("lab") : void startLab())}
                    disabled={Boolean(busy)}
                  >
                    Open your lab
                    <ArrowRight size={18} />
                  </button>
                  <h2>When a response is missing</h2>
                  <p>
                    A missing broadcast response does not prove that the
                    transaction failed. Use “Check transaction status” in Build.
                    The service checks the saved attempt against the node and
                    never resends it during recovery.
                  </p>
                  <h2>Your identity and your wallets</h2>
                  <p>
                    A Nostr signer identifies your learning account. Bitcoin
                    Core manages the private keys for the valueless lab wallets.
                    A Nostr identity is not the same thing as a Bitcoin spending
                    key.
                  </p>
                  <p>
                    Temporary identities are held in memory for quick
                    exploration. Use Connect or another signer if you want an
                    identity you can recover and keep using.
                  </p>
                  <a
                    className="text-button"
                    href={CONNECT_INSTALL_URL}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Install Connect
                    <ArrowUpRight size={17} />
                  </a>
                </section>
                <section className="glossary-panel">
                  <h2>A small field guide.</h2>
                  <p>Protocol terms, explained where you need them.</p>
                  <div className="glossary-list">
                    {glossary.map(([term, definition]) => (
                      <details key={term}>
                        <summary>
                          {term}
                          <span aria-hidden="true">+</span>
                        </summary>
                        <p>{definition}</p>
                      </details>
                    ))}
                  </div>
                  <div className="help-notice">
                    <ShieldCheck size={23} />
                    <p>
                      Every completed experiment is backed by a checked
                      transaction. These are regtest operations, and the coins
                      have no monetary value.
                    </p>
                  </div>
                </section>
              </div>
            </>
          )}
          {route === "not-found" && (
            <>
              {pageTitle(
                "That page is not in the lab.",
                "Choose a workbench view or return to the Sandbox home.",
              )}
              <EmptyState
                title="Let’s get you back to the workbench."
                action={
                  <button className="button primary" onClick={() => go("lab")}>
                    Open laboratory
                    <ArrowRight size={18} />
                  </button>
                }
              >
                Your wallet data is unchanged. This navigation link did not
                match a Sandbox page.
              </EmptyState>
            </>
          )}
        </main>
        <footer className="site-footer container">
          <div>
            <Cube size={19} />
            <span>Bitcoin, made inspectable.</span>
          </div>
          <nav aria-label="Footer">
            <button onClick={() => go("help")}>Help and glossary</button>
            <button onClick={() => go("settings")}>Settings</button>
            <a
              href="https://github.com/greyw0rks/grey-payroll"
              target="_blank"
              rel="noreferrer"
            >
              Open source
              <ArrowUpRight size={15} />
            </a>
          </nav>
          <span className="footer-network">Regtest · no monetary value</span>
        </footer>
      </div>
      {notice && (
        <div className="toast" role="status">
          <CheckCircle size={20} />
          <p>{notice}</p>
          <button
            className="icon-button"
            onClick={() => setNotice("")}
            aria-label="Dismiss notification"
          >
            <X size={18} />
          </button>
        </div>
      )}
      {dialog && (
        <Modal onClose={closeDialog} wide={dialog === "broadcast"}>
          {dialog === "account" && (
            <>
              <UserCircle size={39} className="modal-emblem" />
              <h2 id="modal-title">A lab you can come back to.</h2>
              <p>
                Use a Nostr identity to keep your wallet runs and verified
                experiments together. Your lab wallets are created separately by
                Bitcoin Core.
              </p>
              <button
                className="button primary full"
                data-first-focus
                disabled={Boolean(busy)}
                onClick={() => void login("nostr")}
              >
                {busy === "login" ? <Spinner /> : <ShieldCheck size={19} />}
                {providers.connect
                  ? "Sign in with Connect"
                  : "Sign in with Nostr"}
                <ArrowRight size={18} />
              </button>
              <div className="signer-help">
                <strong>
                  {providers.connect
                    ? "Connect is available in this browser."
                    : providers.nip07
                      ? "A Nostr signer is available."
                      : "Enable a signer for this website."}
                </strong>
                <p>
                  In Connect, unlock your wallet and choose Connections → Enable
                  for current website. Then approve the sign-in request.
                </p>
                <a
                  href={CONNECT_INSTALL_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="text-button"
                >
                  Install Connect
                  <ArrowUpRight size={16} />
                </a>
              </div>
              <details className="temporary-options">
                <summary>
                  Try a temporary identity
                  <ArrowDown size={17} />
                </summary>
                <p>
                  The temporary signing key stays only in this tab’s memory.
                  Closing or reloading the tab loses it. Use a signer for an
                  identity you can keep.
                </p>
                <button
                  className="button secondary full"
                  disabled={Boolean(busy)}
                  onClick={() => void login("temporary")}
                >
                  Create temporary identity
                  <ArrowRight size={17} />
                </button>
              </details>
              {demoEnabled && (
                <button
                  className="local-session-button"
                  disabled={Boolean(busy)}
                  onClick={() => void login("local")}
                >
                  <Flask size={18} />
                  Start local practice session
                  <span>Builder test identity · regtest coins</span>
                </button>
              )}
            </>
          )}
          {dialog === "broadcast" && preview && (
            <>
              <GitBranch size={36} className="modal-emblem" />
              <h2 id="modal-title">Review before you broadcast.</h2>
              <p>
                Bitcoin Core will sign this exact transaction using your
                isolated lab wallet, then submit it to the regtest node.
              </p>
              <div className="broadcast-review">
                <div>
                  <span>From</span>
                  <strong>
                    Wallet {preview.from === "alpha" ? "Alpha" : "Beta"}
                  </strong>
                  <ArrowRight size={19} />
                  <span>To</span>
                  <strong>
                    Wallet {preview.to === "alpha" ? "Alpha" : "Beta"}
                  </strong>
                </div>
                <dl>
                  <div>
                    <dt>Payment amount</dt>
                    <dd>{formatSats(preview.amountSats)} sats</dd>
                  </div>
                  <div>
                    <dt>Transaction fee</dt>
                    <dd>{formatSats(preview.feeSats)} sats</dd>
                  </div>
                  <div className="review-total">
                    <dt>Payment + fee</dt>
                    <dd>
                      {formatSats(preview.amountSats + preview.feeSats)} sats
                    </dd>
                  </div>
                </dl>
              </div>
              <label className="checkbox-field broadcast-checkbox">
                <input
                  type="checkbox"
                  checked={reviewConfirmed}
                  onChange={(event) => setReviewConfirmed(event.target.checked)}
                />
                <span>
                  I have reviewed the payment amount and transaction fee.
                </span>
              </label>
              <div className="modal-value-notice">
                <Info size={18} />
                <p>
                  These are regtest coins with no monetary value. Broadcast
                  creates a real transaction on the test node.
                </p>
              </div>
              <div className="modal-actions">
                <button
                  className="button secondary"
                  onClick={closeDialog}
                  disabled={Boolean(busy)}
                >
                  Keep reviewing
                </button>
                <button
                  className="button primary"
                  disabled={
                    Boolean(busy) ||
                    !reviewConfirmed ||
                    previewExpired ||
                    !online
                  }
                  onClick={() => void broadcast()}
                >
                  {busy === "broadcast" ? (
                    <Spinner />
                  ) : (
                    <ArrowUpRight size={18} />
                  )}
                  Broadcast transaction
                </button>
              </div>
            </>
          )}
          {dialog === "reset" && (
            <>
              <ArrowClockwise size={35} className="modal-emblem" />
              <h2 id="modal-title">Start a fresh wallet run?</h2>
              <p>
                This creates a new pair of funded regtest wallets. Resolve any
                uncertain broadcast before starting again. Your identity stays
                connected.
              </p>
              <form onSubmit={(event) => void resetLab(event)}>
                <label htmlFor="reset-confirmation">
                  Type RESET to confirm
                </label>
                <input
                  id="reset-confirmation"
                  data-first-focus
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={10}
                  value={resetText}
                  onChange={(event) => setResetText(event.target.value)}
                  placeholder="RESET"
                />
                <div className="modal-actions">
                  <button
                    className="button secondary"
                    type="button"
                    onClick={closeDialog}
                    disabled={Boolean(busy)}
                  >
                    Keep my wallets
                  </button>
                  <button
                    className="button danger"
                    type="submit"
                    disabled={Boolean(busy) || resetText !== "RESET"}
                  >
                    {busy === "reset" ? (
                      <Spinner />
                    ) : (
                      <ArrowClockwise size={18} />
                    )}
                    Reset wallet run
                  </button>
                </div>
              </form>
            </>
          )}
          {error && (
            <div className="feedback error-feedback modal-error" role="alert">
              <WarningCircle size={20} />
              <p>{error}</p>
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}
