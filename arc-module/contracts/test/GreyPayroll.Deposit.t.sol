// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {GreyPayrollBase} from "./GreyPayroll.Base.t.sol";
import {GreyPayroll}     from "../GreyPayroll.sol";

contract GreyPayrollDepositTest is GreyPayrollBase {
    // ── Happy-path: credits only msg.sender ───────────────────────────────

    function test_Deposit_CreditsSenderBalance() public {
        _deposit(employerA, SMALL);
        assertEq(payroll.balances(employerA), SMALL);
    }

    function test_Deposit_DoesNotCreditOtherEmployer() public {
        _deposit(employerA, SMALL);
        assertEq(payroll.balances(employerB), 0);
    }

    function test_Deposit_IncrementsTotalDeposited() public {
        _deposit(employerA, SMALL);
        assertEq(payroll.totalDeposited(), SMALL);
    }

    function test_Deposit_AccumulatesMultipleDeposits() public {
        _deposit(employerA, SMALL);
        _deposit(employerA, SMALL);
        assertEq(payroll.balances(employerA), 2 * SMALL);
        assertEq(payroll.totalDeposited(),    2 * SMALL);
    }

    function test_Deposit_TwoEmployersIndependent() public {
        _deposit(employerA, SMALL);
        _deposit(employerB, BIG);
        assertEq(payroll.balances(employerA), SMALL);
        assertEq(payroll.balances(employerB), BIG);
        assertEq(payroll.totalDeposited(),    SMALL + BIG);
    }

    function test_Deposit_ContractBalanceIncrements() public {
        _deposit(employerA, SMALL);
        assertEq(address(payroll).balance, SMALL);
    }

    // ── Event emission ────────────────────────────────────────────────────

    function test_Deposit_EmitsDepositedEvent() public {
        vm.prank(employerA);
        vm.expectEmit(true, false, false, true, address(payroll));
        emit GreyPayroll.Deposited(employerA, SMALL);
        payroll.deposit{value: SMALL}();
    }

    function test_Deposit_EmitsDepositedWithCorrectArgs() public {
        uint256 amount = 42e18;
        vm.prank(employerB);
        vm.expectEmit(true, false, false, true, address(payroll));
        emit GreyPayroll.Deposited(employerB, amount);
        payroll.deposit{value: amount}();
    }

    // ── Revert: zero deposit ──────────────────────────────────────────────

    function test_Deposit_RevertsOnZeroValue() public {
        vm.prank(employerA);
        vm.expectRevert(GreyPayroll.ZeroDeposit.selector);
        payroll.deposit{value: 0}();
    }

    function test_Deposit_ZeroDoesNotMutateState() public {
        vm.prank(employerA);
        try payroll.deposit{value: 0}() {} catch {}
        assertEq(payroll.balances(employerA), 0);
        assertEq(payroll.totalDeposited(),    0);
    }

    // ── Revert: receive() / fallback() reject plain transfers ─────────────

    function test_Receive_RevertsOnPlainTransfer() public {
        // vm.expectRevert captures the revert from the low-level call.
        // The call itself is the "next call" forge intercepts, so we do NOT
        // check `ok` — forge validates the revert selector automatically.
        vm.prank(employerA);
        vm.expectRevert(GreyPayroll.ZeroDeposit.selector);
        address(payroll).call{value: ONE}("");
    }

    function test_Fallback_RevertsOnUnknownCalldata() public {
        vm.prank(employerA);
        vm.expectRevert(GreyPayroll.ZeroDeposit.selector);
        address(payroll).call{value: ONE}(hex"deadbeef");
    }
}
