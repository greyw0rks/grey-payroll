// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {GreyPayrollBase} from "./GreyPayroll.Base.t.sol";

contract GreyPayrollDeployTest is GreyPayrollBase {
    // ── Deployment & initialisation ───────────────────────────────────────

    function test_Deploy_MaxRecipientsConstant() public view {
        assertEq(payroll.MAX_RECIPIENTS(), 50);
    }

    function test_Deploy_TotalDepositedStartsAtZero() public view {
        assertEq(payroll.totalDeposited(), 0);
    }

    function test_Deploy_BalancesStartAtZero() public view {
        assertEq(payroll.balances(employerA), 0);
        assertEq(payroll.balances(employerB), 0);
    }

    function test_Deploy_BalanceOfMatchesMapping() public view {
        assertEq(payroll.balanceOf(employerA), payroll.balances(employerA));
    }

    function test_Deploy_RunExecutedStartsFalse() public view {
        assertFalse(payroll.runExecuted(employerA, RUN1));
        assertFalse(payroll.hasExecuted(employerA, RUN1));
    }

    function test_Deploy_HasExecutedMatchesMapping() public view {
        assertEq(
            payroll.hasExecuted(employerA, RUN1),
            payroll.runExecuted(employerA, RUN1)
        );
    }

    function test_Deploy_ContractHoldsZeroEther() public view {
        assertEq(address(payroll).balance, 0);
    }
}
