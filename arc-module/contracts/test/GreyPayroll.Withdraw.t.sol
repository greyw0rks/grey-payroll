// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {GreyPayrollBase} from "./GreyPayroll.Base.t.sol";
import {GreyPayroll}     from "../GreyPayroll.sol";

contract GreyPayrollWithdrawTest is GreyPayrollBase {
    function setUp() public override {
        super.setUp();
        // Pre-fund both employers
        _deposit(employerA, BIG);
        _deposit(employerB, SMALL);
    }

    // ── Happy-path ─────────────────────────────────────────────────────────

    function test_Withdraw_DecreasesEmployerBalance() public {
        uint256 before = payroll.balances(employerA);
        vm.prank(employerA);
        payroll.withdraw(SMALL);
        assertEq(payroll.balances(employerA), before - SMALL);
    }

    function test_Withdraw_DecreasesTotalDeposited() public {
        uint256 totalBefore = payroll.totalDeposited();
        vm.prank(employerA);
        payroll.withdraw(SMALL);
        assertEq(payroll.totalDeposited(), totalBefore - SMALL);
    }

    function test_Withdraw_TransfersExactAmountToCaller() public {
        uint256 callerBefore = employerA.balance;
        vm.prank(employerA);
        payroll.withdraw(SMALL);
        assertEq(employerA.balance, callerBefore + SMALL);
    }

    function test_Withdraw_FullBalance() public {
        vm.prank(employerA);
        payroll.withdraw(BIG);
        assertEq(payroll.balances(employerA), 0);
        assertEq(address(payroll).balance,    SMALL); // B's balance remains
    }

    function test_Withdraw_DoesNotAffectOtherEmployer() public {
        uint256 bBefore = payroll.balances(employerB);
        vm.prank(employerA);
        payroll.withdraw(SMALL);
        assertEq(payroll.balances(employerB), bBefore);
    }

    function test_Withdraw_ContractBalanceDecreases() public {
        uint256 contractBefore = address(payroll).balance;
        vm.prank(employerA);
        payroll.withdraw(SMALL);
        assertEq(address(payroll).balance, contractBefore - SMALL);
    }

    // ── Event emission ─────────────────────────────────────────────────────

    function test_Withdraw_EmitsWithdrawnEvent() public {
        vm.prank(employerA);
        vm.expectEmit(true, false, false, true, address(payroll));
        emit GreyPayroll.Withdrawn(employerA, SMALL);
        payroll.withdraw(SMALL);
    }

    // ── Revert: zero withdrawal ────────────────────────────────────────────

    function test_Withdraw_RevertsOnZero() public {
        vm.prank(employerA);
        vm.expectRevert(GreyPayroll.ZeroWithdrawal.selector);
        payroll.withdraw(0);
    }

    // ── Revert: overdraft ─────────────────────────────────────────────────

    function test_Withdraw_RevertsWhenOverBalance() public {
        vm.prank(employerA);
        vm.expectRevert(abi.encodeWithSelector(GreyPayroll.InsufficientBalance.selector, BIG, BIG + 1));
        payroll.withdraw(BIG + 1);
    }

    function test_Withdraw_RevertsFromZeroBalance() public {
        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(GreyPayroll.InsufficientBalance.selector, uint256(0), ONE));
        payroll.withdraw(ONE);
    }

    // ── Employer A cannot withdraw Employer B's balance ────────────────────
    // (This is the "isolation" withdrawal revert test.)

    function test_Withdraw_EmployerACannotOverdrawToReachB() public {
        // employerB deposited SMALL; employerA deposited BIG.
        // If employerA tries to withdraw more than their OWN balance they revert —
        // there's no way to reach B's funds.
        vm.prank(employerA);
        vm.expectRevert(abi.encodeWithSelector(GreyPayroll.InsufficientBalance.selector, BIG, BIG + 1));
        payroll.withdraw(BIG + 1);
        // B's balance is intact
        assertEq(payroll.balances(employerB), SMALL);
    }
}
