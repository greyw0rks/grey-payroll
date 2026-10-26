// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title GreyPayroll
 * @author Grey Payroll — Arc Studio build (2026-10-24)
 * @notice Multi-employer payroll contract for Arc chain.
 *
 * On Arc, the native gas token IS USDC (18 decimals). There is no separate
 * ERC-20 involved in this contract. All deposits, balances, and payouts use
 * plain native value (msg.value / address.call{value:}(…)).
 *
 * Architecture:
 * - Each employer wallet has an isolated funded ledger (balances[employer]).
 * - No administrator, owner, or relayer can access another employer's funds.
 * - executePayroll is atomic: if any recipient transfer fails the entire run
 *   reverts, including the ledger debit and the replay marker.
 * - Uncommitted funds are fully withdrawable by the employer; this is NOT
 *   a promised locked salary buffer.
 *
 * Invariant (not enforced at runtime, verifiable by inspection):
 *   totalDeposited == ∑ balances[e] for all e
 */
contract GreyPayroll {
    // ─────────────────────────────────────────────────────────────────────────
    // Reentrancy guard (inline — no OZ dependency)
    // ─────────────────────────────────────────────────────────────────────────

    uint8 private _status = 1;

    modifier nonReentrant() {
        if (_status == 2) revert Reentrancy();
        _status = 2;
        _;
        _status = 1;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Maximum recipients per payroll run (prevents unbounded gas use).
    uint256 public constant MAX_RECIPIENTS = 50;

    /// @notice Funded balance held for each employer. Withdrawable at any time.
    mapping(address employer => uint256 balance) public balances;

    /**
     * @notice Per-employer replay protection.
     * @dev    runExecuted[employer][runId] is true once executePayroll has
     *         completed successfully for that (employer, runId) pair.
     *         Scoped per employer so two employers may independently use the
     *         same run-ID bytes without collision.
     */
    mapping(address employer => mapping(bytes32 runId => bool executed)) public runExecuted;

    /**
     * @notice Sum of all employer balances.
     * @dev    Invariant: totalDeposited == ∑ balances[e] for all e.
     *         Updated atomically with every credit and debit so it can be
     *         used to verify the contract's aggregate custody.
     */
    uint256 public totalDeposited;

    // ─────────────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Emitted when an employer deposits native USDC into their ledger.
    event Deposited(address indexed employer, uint256 amount);

    /// @notice Emitted when an employer withdraws uncommitted funds.
    event Withdrawn(address indexed employer, uint256 amount);

    /**
     * @notice Emitted once per successfully executed payroll run.
     * @param employer       The wallet that authorised and paid the run.
     * @param runId          The caller-supplied unique run identifier.
     * @param totalPaid      Sum of all recipient amounts in this run.
     * @param recipientCount Number of recipients paid.
     */
    event PayrollExecuted(
        address indexed employer,
        bytes32 indexed runId,
        uint256 totalPaid,
        uint256 recipientCount
    );

    /**
     * @notice Emitted once per recipient inside a successful run.
     * @param employer   The employer that funded the payment.
     * @param runId      The run this payment belongs to.
     * @param recipient  The address that received native USDC.
     * @param amount     Native USDC amount sent (18 decimals).
     */
    event PaymentSent(
        address indexed employer,
        bytes32 indexed runId,
        address indexed recipient,
        uint256 amount
    );

    // ─────────────────────────────────────────────────────────────────────────
    // Custom errors
    // ─────────────────────────────────────────────────────────────────────────

    error ZeroDeposit();
    error ZeroWithdrawal();
    /// @param available  Employer's current ledger balance.
    /// @param required   Amount requested.
    error InsufficientBalance(uint256 available, uint256 required);
    error EmptyRecipients();
    /// @param recipientsLen  Length of the recipients array.
    /// @param amountsLen     Length of the amounts array.
    error ArrayLengthMismatch(uint256 recipientsLen, uint256 amountsLen);
    error TooManyRecipients();
    /// @param index  Position in the amounts array where the zero was found.
    error ZeroAmount(uint256 index);
    /// @param index  Position in the recipients array where the zero address was found.
    error ZeroRecipient(uint256 index);
    /// @notice Recipient address equals this contract's address.
    /// @param index  Position in the recipients array.
    error SelfPayment(uint256 index);
    /// @param index  Position of the duplicate in the recipients array.
    error DuplicateRecipient(uint256 index);
    error ZeroRunId();
    error RunAlreadyExecuted();
    /**
     * @notice A native transfer to a recipient (or to msg.sender on withdraw) failed.
     * @dev    On Arc, native transfers can fail for Arc-restricted addresses (e.g.
     *         blocklisted, precompile, non-payable contract). Per spec, any failed
     *         transfer reverts the ENTIRE run atomically. Employers should remove
     *         the failing recipient before re-submitting the run under a new runId.
     * @param recipient  Address the transfer was attempted to (address(0) on withdraw).
     * @param amount     Amount that was attempted.
     * @param index      Index in the recipients array (type(uint256).max on withdraw).
     */
    error PaymentFailed(address recipient, uint256 amount, uint256 index);
    error Reentrancy();

    // ─────────────────────────────────────────────────────────────────────────
    // External functions
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Deposit native USDC into msg.sender's payroll ledger.
     * @dev    Only credits the caller. No other party's balance is affected.
     *         Rejects zero-value deposits.
     */
    function deposit() external payable nonReentrant {
        if (msg.value == 0) revert ZeroDeposit();
        balances[msg.sender] += msg.value;
        totalDeposited += msg.value;
        emit Deposited(msg.sender, msg.value);
    }

    /**
     * @notice Withdraw uncommitted funds from msg.sender's ledger.
     * @param  amount  Native USDC amount to withdraw (18 decimals).
     * @dev    Uses checks-effects-interactions: ledger is debited before the
     *         native transfer, preventing reentrancy from re-entering with a
     *         stale (too-high) balance.
     */
    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroWithdrawal();
        if (balances[msg.sender] < amount) revert InsufficientBalance(balances[msg.sender], amount);

        // Effects before external call (CEI pattern)
        balances[msg.sender] -= amount;
        totalDeposited -= amount;

        // Interaction
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert PaymentFailed(msg.sender, amount, type(uint256).max);

        emit Withdrawn(msg.sender, amount);
    }

    /**
     * @notice Execute a payroll run: debit msg.sender's ledger and transfer
     *         native USDC to each recipient atomically.
     * @param  runId       A caller-generated, employer-scoped unique identifier.
     *                     Use keccak256(abi.encode(employerAddress, timestamp,
     *                     nonce)) or a UUID-derived bytes32. Must be non-zero.
     * @param  recipients  Ordered list of recipient addresses (max 50).
     * @param  amounts     Matching list of amounts in native USDC (18 decimals).
     * @dev    The run is either fully paid or fully reverted — no partial state.
     *         Replay protection is scoped per employer: two employers may reuse
     *         the same runId bytes independently without collision.
     */
    function executePayroll(
        bytes32 runId,
        address[] calldata recipients,
        uint256[] calldata amounts
    ) external nonReentrant {
        // ── Validate run ID ──────────────────────────────────────────────────
        if (runId == bytes32(0)) revert ZeroRunId();
        if (runExecuted[msg.sender][runId]) revert RunAlreadyExecuted();

        // ── Validate arrays ──────────────────────────────────────────────────
        if (recipients.length == 0) revert EmptyRecipients();
        if (recipients.length != amounts.length) revert ArrayLengthMismatch(recipients.length, amounts.length);
        if (recipients.length > MAX_RECIPIENTS) revert TooManyRecipients();

        // ── Validate individual entries and accumulate total ──────────────────
        // Duplicate detection: for ≤50 entries an O(n²) scan avoids a storage
        // mapping and keeps gas predictable. No storage slot is written here.
        uint256 totalAmount;
        for (uint256 i = 0; i < recipients.length; ++i) {
            if (amounts[i] == 0) revert ZeroAmount(i);
            if (recipients[i] == address(0)) revert ZeroRecipient(i);
            if (recipients[i] == address(this)) revert SelfPayment(i);

            // O(n²) duplicate check — safe for MAX_RECIPIENTS = 50
            for (uint256 j = 0; j < i; ++j) {
                if (recipients[j] == recipients[i]) revert DuplicateRecipient(i);
            }

            // Overflow guard: Solidity 0.8 reverts automatically on overflow
            totalAmount += amounts[i];
        }

        // ── Check funding ────────────────────────────────────────────────────
        if (balances[msg.sender] < totalAmount) revert InsufficientBalance(balances[msg.sender], totalAmount);

        // ── Effects (before external calls — CEI) ───────────────────────────
        runExecuted[msg.sender][runId] = true;
        balances[msg.sender] -= totalAmount;
        totalDeposited -= totalAmount;

        emit PayrollExecuted(msg.sender, runId, totalAmount, recipients.length);

        // ── Interactions ──────────────────────────────────────────────────────
        // Any failed transfer reverts the entire transaction, including all
        // storage changes and the PayrollExecuted event above.
        for (uint256 i = 0; i < recipients.length; ++i) {
            (bool ok,) = recipients[i].call{value: amounts[i]}("");
            if (!ok) revert PaymentFailed(recipients[i], amounts[i], i);
            emit PaymentSent(msg.sender, runId, recipients[i], amounts[i]);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // View helpers
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Returns the funded ledger balance for a given employer.
     * @param  employer  The employer wallet address.
     * @return           Native USDC balance (18 decimals).
     */
    function balanceOf(address employer) external view returns (uint256) {
        return balances[employer];
    }

    /**
     * @notice Returns whether an employer has already executed a given run.
     * @param  employer  The employer wallet address.
     * @param  runId     The run identifier.
     * @return           True if the run was completed successfully.
     */
    function hasExecuted(address employer, bytes32 runId) external view returns (bool) {
        return runExecuted[employer][runId];
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Fallback — reject plain transfers to keep accounting clean
    // ─────────────────────────────────────────────────────────────────────────

    /// @dev Reject unexpected value transfers; use deposit() instead.
    receive() external payable {
        revert ZeroDeposit();
    }

    /// @dev Reject unknown calldata.
    fallback() external payable {
        revert ZeroDeposit();
    }
}
