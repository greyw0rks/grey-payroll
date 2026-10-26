// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {CommonBase}   from "forge-std/Base.sol";
import {StdCheats}    from "forge-std/StdCheats.sol";
import {StdUtils}     from "forge-std/StdUtils.sol";
import {GreyPayroll}  from "../GreyPayroll.sol";

/**
 * @notice Invariant handler — drives random deposit / withdraw / executePayroll
 *         calls so the invariant suite can verify:
 *
 *   totalDeposited == ∑ balances[actor] for every tracked actor.
 *
 * Design notes
 * ─────────────
 * • Three employers (employer0-2) are tracked.
 * • Each actor is pre-funded with 1 000 000 e18 native tokens via vm.deal.
 * • Ghost variable `ghost_totalDeposited` accumulates credits and debits in
 *   parallel with the contract — the invariant can compare both.
 * • runId nonces are per-actor to avoid RunAlreadyExecuted on every call.
 */
contract PayrollHandler is CommonBase, StdCheats, StdUtils {
    GreyPayroll public immutable payroll;

    address[3] public actors;
    uint256[3] public ghost_balances;

    uint256 public ghost_totalDeposited;

    // Per-actor nonce so each run gets a fresh runId.
    uint256[3] private _nonces;

    // Fixed set of payees (different from actors to avoid self-payment issues).
    address[3] public payees;

    constructor(GreyPayroll _payroll) {
        payroll = _payroll;

        actors[0] = makeAddr("h_actor0");
        actors[1] = makeAddr("h_actor1");
        actors[2] = makeAddr("h_actor2");

        payees[0] = makeAddr("h_payee0");
        payees[1] = makeAddr("h_payee1");
        payees[2] = makeAddr("h_payee2");

        // Give each actor plenty of native funds
        for (uint256 i; i < 3; ++i) {
            vm.deal(actors[i], 1_000_000e18);
        }
    }

    // ── deposit ───────────────────────────────────────────────────────────

    function deposit(uint256 actorSeed, uint256 rawAmount) external {
        uint256 idx   = actorSeed % 3;
        address actor = actors[idx];
        uint256 amount = bound(rawAmount, 1, 1_000e18);

        // Ensure actor has enough native funds
        if (actor.balance < amount) vm.deal(actor, amount * 2);

        vm.prank(actor);
        payroll.deposit{value: amount}();

        ghost_balances[idx]  += amount;
        ghost_totalDeposited += amount;
    }

    // ── withdraw ──────────────────────────────────────────────────────────

    function withdraw(uint256 actorSeed, uint256 rawAmount) external {
        uint256 idx   = actorSeed % 3;
        address actor = actors[idx];

        uint256 bal = payroll.balances(actor);
        if (bal == 0) return; // nothing to withdraw

        uint256 amount = bound(rawAmount, 1, bal);

        vm.prank(actor);
        payroll.withdraw(amount);

        ghost_balances[idx]  -= amount;
        ghost_totalDeposited -= amount;
    }

    // ── executePayroll ────────────────────────────────────────────────────

    function executePayroll(
        uint256 actorSeed,
        uint256 payeeSeed,
        uint256 rawAmount
    ) external {
        uint256 idx   = actorSeed % 3;
        address actor = actors[idx];

        uint256 bal = payroll.balances(actor);
        if (bal == 0) return;

        uint256 amount = bound(rawAmount, 1, bal);

        // Pick a payee that is NOT the actor itself (avoids DuplicateRecipient /
        // self-payment edge case in this simple 1-recipient payroll).
        address payee = payees[payeeSeed % 3];

        bytes32 runId = keccak256(abi.encode("inv", idx, _nonces[idx]++));

        address[] memory recips = new address[](1);
        uint256[] memory amts   = new uint256[](1);
        recips[0] = payee;
        amts[0]   = amount;

        vm.prank(actor);
        payroll.executePayroll(runId, recips, amts);

        ghost_balances[idx]  -= amount;
        ghost_totalDeposited -= amount;
    }

    // ── helpers for invariant assertions ──────────────────────────────────

    function sumBalances() external view returns (uint256 s) {
        for (uint256 i; i < 3; ++i) {
            s += payroll.balances(actors[i]);
        }
    }
}
