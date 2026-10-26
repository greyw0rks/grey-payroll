// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {GreyPayrollBase}   from "./GreyPayroll.Base.t.sol";
import {GreyPayroll}       from "../GreyPayroll.sol";
import {MaliciousReceiver} from "../test-helpers/MaliciousReceiver.sol";
import {ReentrantReceiver} from "../test-helpers/ReentrantReceiver.sol";

contract GreyPayrollReentrancyTest is GreyPayrollBase {
    MaliciousReceiver internal malicious;
    ReentrantReceiver internal reentrant;

    function setUp() public override {
        super.setUp();
        malicious = new MaliciousReceiver();
        reentrant = new ReentrantReceiver(payroll);

        // Fund employers
        _deposit(employerA, BIG);

        // Fund the reentrant receiver as its own employer so it can call
        // executePayroll directly and trigger reentrancy on receipt.
        vm.deal(address(reentrant), BIG);
    }

    // ══════════════════════════════════════════════════════════════════════
    // Malicious (reverting) receiver — full rollback
    // ══════════════════════════════════════════════════════════════════════

    function test_Malicious_EntireTransactionReverts() public {
        address[] memory r = new address[](2);
        uint256[] memory a = new uint256[](2);
        r[0] = alice;                   a[0] = ONE; // good recipient first
        r[1] = address(malicious);      a[1] = ONE; // bad recipient second

        uint256 empBefore  = payroll.balances(employerA);
        uint256 totalBefore = payroll.totalDeposited();

        vm.prank(employerA);
        vm.expectRevert(abi.encodeWithSelector(GreyPayroll.PaymentFailed.selector, address(malicious), ONE, uint256(1)));
        payroll.executePayroll(RUN1, r, a);

        // All state rolled back — CEI + atomic revert
        assertEq(payroll.balances(employerA), empBefore,   "balance not rolled back");
        assertEq(payroll.totalDeposited(),    totalBefore,  "totalDeposited not rolled back");
    }

    function test_Malicious_RunIdNotMarkedAfterFailure() public {
        (address[] memory r, uint256[] memory a) = _single(address(malicious), ONE);

        vm.prank(employerA);
        vm.expectRevert(abi.encodeWithSelector(GreyPayroll.PaymentFailed.selector, address(malicious), ONE, uint256(0)));
        payroll.executePayroll(RUN1, r, a);

        assertFalse(payroll.runExecuted(employerA, RUN1), "runId must NOT be marked");
    }

    function test_Malicious_EmployerBalanceUnchanged() public {
        uint256 balBefore = payroll.balances(employerA);
        (address[] memory r, uint256[] memory a) = _single(address(malicious), ONE);

        vm.prank(employerA);
        try payroll.executePayroll(RUN1, r, a) {} catch {}

        assertEq(payroll.balances(employerA), balBefore, "employer ledger debited on failure");
    }

    function test_Malicious_RerunSucceedsWithGoodRecipient() public {
        // First call fails (malicious recipient)
        (address[] memory rBad, uint256[] memory aBad) = _single(address(malicious), ONE);
        vm.prank(employerA);
        vm.expectRevert(abi.encodeWithSelector(GreyPayroll.PaymentFailed.selector, address(malicious), ONE, uint256(0)));
        payroll.executePayroll(RUN1, rBad, aBad);

        // Same runId but different (good) recipient → must succeed
        uint256 aliceBefore = alice.balance;
        (address[] memory r, uint256[] memory a) = _single(alice, ONE);
        vm.prank(employerA);
        payroll.executePayroll(RUN1, r, a);

        assertEq(alice.balance, aliceBefore + ONE);
        assertTrue(payroll.runExecuted(employerA, RUN1));
    }

    // ══════════════════════════════════════════════════════════════════════
    // Reentrancy guard test
    // ══════════════════════════════════════════════════════════════════════

    function test_Reentrancy_RevertsWithReentrancyError() public {
        // The ReentrantReceiver will call executePayroll from its receive()
        // hook with the same runId. The nonReentrant guard must fire first
        // (status == 2 during the payment loop) with Reentrancy().

        // 1. Fund the receiver contract as its own employer
        vm.prank(address(reentrant));
        payroll.deposit{value: BIG}();

        // 2. Arm the reentrant call: the re-entry attempt uses the same runId
        //    and tries to send to alice
        (address[] memory rInner, uint256[] memory aInner) = _single(alice, ONE);
        reentrant.arm(RUN1, rInner, aInner);

        // 3. Outer call: reentrant receiver is the recipient
        //    When payroll sends ETH to reentrant.receive(), it re-enters.
        address[] memory rOuter = new address[](1);
        uint256[] memory aOuter = new uint256[](1);
        rOuter[0] = address(reentrant);
        aOuter[0] = ONE;

        // The whole outer transaction should revert because the inner
        // re-entry hits Reentrancy() → which propagates as PaymentFailed().
        vm.prank(address(reentrant));
        vm.expectRevert(abi.encodeWithSelector(GreyPayroll.PaymentFailed.selector, address(reentrant), ONE, uint256(0)));
        payroll.executePayroll(RUN1, rOuter, aOuter);
    }

    function test_Reentrancy_BalanceUnchangedAfterAttempt() public {
        vm.prank(address(reentrant));
        payroll.deposit{value: BIG}();

        (address[] memory rInner, uint256[] memory aInner) = _single(alice, ONE);
        reentrant.arm(RUN1, rInner, aInner);

        uint256 balBefore = payroll.balances(address(reentrant));

        address[] memory rOuter = new address[](1);
        uint256[] memory aOuter = new uint256[](1);
        rOuter[0] = address(reentrant);
        aOuter[0] = ONE;

        vm.prank(address(reentrant));
        try payroll.executePayroll(RUN1, rOuter, aOuter) {} catch {}

        assertEq(payroll.balances(address(reentrant)), balBefore,
            "balance should not change on reentrancy failure");
    }

    function test_Reentrancy_RunIdNotMarkedAfterAttempt() public {
        vm.prank(address(reentrant));
        payroll.deposit{value: BIG}();

        (address[] memory rInner, uint256[] memory aInner) = _single(alice, ONE);
        reentrant.arm(RUN1, rInner, aInner);

        address[] memory rOuter = new address[](1);
        uint256[] memory aOuter = new uint256[](1);
        rOuter[0] = address(reentrant);
        aOuter[0] = ONE;

        vm.prank(address(reentrant));
        try payroll.executePayroll(RUN1, rOuter, aOuter) {} catch {}

        assertFalse(payroll.runExecuted(address(reentrant), RUN1),
            "runId must not be marked after failed reentrant attempt");
    }
}
