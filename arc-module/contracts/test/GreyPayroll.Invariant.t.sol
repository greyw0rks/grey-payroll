// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test}           from "forge-std/Test.sol";
import {GreyPayroll}    from "../GreyPayroll.sol";
import {PayrollHandler} from "../test-helpers/PayrollHandler.sol";

/**
 * @notice Stateful invariant suite for GreyPayroll.
 *
 * Invariant under test
 * ─────────────────────
 *   totalDeposited == ∑ balances[actor]  for all tracked actors
 *
 * The handler drives random sequences of deposit / withdraw / executePayroll
 * across three employers. After every call forge checks that:
 *   1. payroll.totalDeposited() == handler.sumBalances()  (on-chain)
 *   2. payroll.totalDeposited() == handler.ghost_totalDeposited()  (ghost)
 *   3. contract native balance  == payroll.totalDeposited()  (ETH custody)
 */
contract GreyPayrollInvariantTest is Test {
    GreyPayroll    internal payroll;
    PayrollHandler internal handler;

    function setUp() public {
        payroll = new GreyPayroll();
        handler = new PayrollHandler(payroll);

        // Only let the handler interact with the payroll contract
        targetContract(address(handler));
    }

    // ── Core conservation law ─────────────────────────────────────────────

    function invariant_TotalDepositedEqualsSumOfBalances() public view {
        assertEq(
            payroll.totalDeposited(),
            handler.sumBalances(),
            "totalDeposited != sum of balances"
        );
    }

    // ── Ghost tracking matches on-chain state ─────────────────────────────

    function invariant_GhostMatchesTotalDeposited() public view {
        assertEq(
            payroll.totalDeposited(),
            handler.ghost_totalDeposited(),
            "totalDeposited != ghost_totalDeposited"
        );
    }

    // ── Contract ETH holdings match totalDeposited ────────────────────────

    function invariant_ContractBalanceMatchesTotalDeposited() public view {
        assertEq(
            address(payroll).balance,
            payroll.totalDeposited(),
            "contract ETH balance != totalDeposited"
        );
    }

    // ── Individual balances never exceed totalDeposited ───────────────────

    function invariant_IndividualBalancesNeverExceedTotal() public view {
        uint256 total = payroll.totalDeposited();
        for (uint256 i; i < 3; ++i) {
            address actor = handler.actors(i);
            assertLe(
                payroll.balances(actor),
                total,
                "individual balance exceeds total"
            );
        }
    }
}
