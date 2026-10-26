// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {GreyPayrollBase} from "./GreyPayroll.Base.t.sol";
import {GreyPayroll}     from "../GreyPayroll.sol";

contract GreyPayrollIsolationTest is GreyPayrollBase {
    function setUp() public override {
        super.setUp();
        _deposit(employerA, BIG);
        _deposit(employerB, BIG);
    }

    // ── Employer A cannot reach Employer B's funds via withdraw ───────────

    function test_Isolation_WithdrawCannotAccessOtherEmployerFunds() public {
        // A tries to withdraw more than their own balance; B's SMALL amount
        // sitting in the contract does NOT top up A's allowance.
        vm.prank(employerA);
        vm.expectRevert(abi.encodeWithSelector(GreyPayroll.InsufficientBalance.selector, BIG, BIG + 1));
        payroll.withdraw(BIG + 1);

        assertEq(payroll.balances(employerB), BIG);
    }

    // ── executePayroll only debits the calling employer ───────────────────

    function test_Isolation_ExecutePayroll_OnlyDebitsCallerA() public {
        uint256 bBefore = payroll.balances(employerB);

        (address[] memory r, uint256[] memory a) = _single(alice, ONE);
        vm.prank(employerA);
        payroll.executePayroll(RUN1, r, a);

        assertEq(payroll.balances(employerB), bBefore, "B balance changed");
    }

    function test_Isolation_ExecutePayroll_OnlyDebitsCallerB() public {
        uint256 aBefore = payroll.balances(employerA);

        (address[] memory r, uint256[] memory a) = _single(alice, ONE);
        vm.prank(employerB);
        payroll.executePayroll(RUN1, r, a);

        assertEq(payroll.balances(employerA), aBefore, "A balance changed");
    }

    // ── Same runId is scoped per employer ────────────────────────────────

    function test_Isolation_SameRunId_TwoEmployers_BothSucceed() public {
        // RUN1 for employer A
        (address[] memory r, uint256[] memory a) = _single(alice, ONE);
        vm.prank(employerA);
        payroll.executePayroll(RUN1, r, a);

        // Same RUN1 for employer B — must NOT revert
        (address[] memory r2, uint256[] memory a2) = _single(bob, ONE);
        vm.prank(employerB);
        payroll.executePayroll(RUN1, r2, a2); // should succeed

        assertTrue(payroll.runExecuted(employerA, RUN1));
        assertTrue(payroll.runExecuted(employerB, RUN1));
    }

    // ── Replay protection: same employer, same runId → revert ─────────────

    function test_Replay_SameEmployerSameRunId_Reverts() public {
        (address[] memory r, uint256[] memory a) = _single(alice, ONE);
        vm.prank(employerA);
        payroll.executePayroll(RUN1, r, a);

        vm.prank(employerA);
        vm.expectRevert(GreyPayroll.RunAlreadyExecuted.selector);
        payroll.executePayroll(RUN1, r, a);
    }

    // ── Replay protection: different runId → succeeds ─────────────────────

    function test_Replay_DifferentRunId_Succeeds() public {
        (address[] memory r, uint256[] memory a) = _single(alice, ONE);
        vm.prank(employerA);
        payroll.executePayroll(RUN1, r, a);

        (address[] memory r2, uint256[] memory a2) = _single(bob, ONE);
        vm.prank(employerA);
        payroll.executePayroll(RUN2, r2, a2); // different runId
        assertTrue(payroll.runExecuted(employerA, RUN2));
    }

    // ── Failed run does NOT mark runId as executed ─────────────────────────

    function test_Replay_FailedRun_RunIdNotMarked() public {
        // Use a zero-amount to force revert inside executePayroll
        address[] memory r = new address[](1);
        uint256[] memory a = new uint256[](1);
        r[0] = alice; a[0] = 0; // will revert ZeroAmount

        vm.prank(employerA);
        try payroll.executePayroll(RUN1, r, a) {} catch {}

        assertFalse(payroll.runExecuted(employerA, RUN1), "runId should not be set");
    }

    function test_Replay_FailedRun_ThenSuccessfulRun_Succeeds() public {
        // First call fails (ZeroAmount)
        address[] memory rBad = new address[](1);
        uint256[] memory aBad = new uint256[](1);
        rBad[0] = alice; aBad[0] = 0;

        vm.prank(employerA);
        vm.expectRevert(abi.encodeWithSelector(GreyPayroll.ZeroAmount.selector, uint256(0)));
        payroll.executePayroll(RUN1, rBad, aBad);

        // Same runId, valid call → must succeed
        (address[] memory r, uint256[] memory a) = _single(alice, ONE);
        vm.prank(employerA);
        payroll.executePayroll(RUN1, r, a);
        assertTrue(payroll.runExecuted(employerA, RUN1));
    }

    // ── Employer A balance unchanged after Employer B's payroll run ────────

    function test_Isolation_EmployerBPayroll_DoesNotDebitA() public {
        uint256 aBefore = payroll.balances(employerA);
        uint256 bBefore = payroll.balances(employerB);

        (address[] memory r, uint256[] memory a) = _single(carol, 200e18);
        vm.prank(employerB);
        payroll.executePayroll(RUN2, r, a);

        assertEq(payroll.balances(employerA), aBefore);
        assertEq(payroll.balances(employerB), bBefore - 200e18);
    }
}
