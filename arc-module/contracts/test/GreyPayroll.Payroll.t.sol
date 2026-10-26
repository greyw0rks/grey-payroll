// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {GreyPayrollBase} from "./GreyPayroll.Base.t.sol";
import {GreyPayroll}     from "../GreyPayroll.sol";

contract GreyPayrollPayrollTest is GreyPayrollBase {
    function setUp() public override {
        super.setUp();
        // Each employer pre-funds the contract
        _deposit(employerA, BIG);
        _deposit(employerB, BIG);
    }

    // ── 1 recipient: state + events ────────────────────────────────────────

    function test_Payroll_SingleRecipient_DebitsEmployerBalance() public {
        uint256 payment = ONE;
        (address[] memory r, uint256[] memory a) = _single(alice, payment);

        uint256 before = payroll.balances(employerA);
        vm.prank(employerA);
        payroll.executePayroll(RUN1, r, a);

        assertEq(payroll.balances(employerA), before - payment);
    }

    function test_Payroll_SingleRecipient_RecipientReceivesExactAmount() public {
        uint256 payment = ONE;
        (address[] memory r, uint256[] memory a) = _single(alice, payment);

        uint256 aliceBefore = alice.balance;
        vm.prank(employerA);
        payroll.executePayroll(RUN1, r, a);

        assertEq(alice.balance, aliceBefore + payment);
    }

    function test_Payroll_SingleRecipient_DecrementsTotalDeposited() public {
        uint256 payment = ONE;
        (address[] memory r, uint256[] memory a) = _single(alice, payment);

        uint256 totalBefore = payroll.totalDeposited();
        vm.prank(employerA);
        payroll.executePayroll(RUN1, r, a);

        assertEq(payroll.totalDeposited(), totalBefore - payment);
    }

    function test_Payroll_SingleRecipient_EmitsPayrollExecuted() public {
        uint256 payment = ONE;
        (address[] memory r, uint256[] memory a) = _single(alice, payment);

        vm.prank(employerA);
        vm.expectEmit(true, true, false, true, address(payroll));
        emit GreyPayroll.PayrollExecuted(employerA, RUN1, payment, 1);
        payroll.executePayroll(RUN1, r, a);
    }

    function test_Payroll_SingleRecipient_EmitsPaymentSent() public {
        uint256 payment = ONE;
        (address[] memory r, uint256[] memory a) = _single(alice, payment);

        vm.prank(employerA);
        vm.expectEmit(true, true, true, true, address(payroll));
        emit GreyPayroll.PaymentSent(employerA, RUN1, alice, payment);
        payroll.executePayroll(RUN1, r, a);
    }

    function test_Payroll_SingleRecipient_MarksRunExecuted() public {
        (address[] memory r, uint256[] memory a) = _single(alice, ONE);
        vm.prank(employerA);
        payroll.executePayroll(RUN1, r, a);
        assertTrue(payroll.runExecuted(employerA, RUN1));
        assertTrue(payroll.hasExecuted(employerA, RUN1));
    }

    // ── 3 recipients: all balances + all events ────────────────────────────

    function test_Payroll_ThreeRecipients_CorrectDebits() public {
        address[] memory recips = new address[](3);
        uint256[] memory amts   = new uint256[](3);
        recips[0] = alice; amts[0] = 10e18;
        recips[1] = bob;   amts[1] = 20e18;
        recips[2] = carol; amts[2] = 30e18;
        uint256 total = 60e18;

        uint256 before = payroll.balances(employerA);
        vm.prank(employerA);
        payroll.executePayroll(RUN1, recips, amts);

        assertEq(payroll.balances(employerA), before - total);
        assertEq(payroll.totalDeposited(),    2 * BIG - total); // B untouched
    }

    function test_Payroll_ThreeRecipients_EachReceivesCorrectAmount() public {
        address[] memory recips = new address[](3);
        uint256[] memory amts   = new uint256[](3);
        recips[0] = alice; amts[0] = 11e18;
        recips[1] = bob;   amts[1] = 22e18;
        recips[2] = carol; amts[2] = 33e18;

        uint256 aBefore = alice.balance;
        uint256 bBefore = bob.balance;
        uint256 cBefore = carol.balance;

        vm.prank(employerA);
        payroll.executePayroll(RUN1, recips, amts);

        assertEq(alice.balance, aBefore + 11e18);
        assertEq(bob.balance,   bBefore + 22e18);
        assertEq(carol.balance, cBefore + 33e18);
    }

    function test_Payroll_ThreeRecipients_EmitsAllPaymentSentEvents() public {
        address[] memory recips = new address[](3);
        uint256[] memory amts   = new uint256[](3);
        recips[0] = alice; amts[0] = 5e18;
        recips[1] = bob;   amts[1] = 6e18;
        recips[2] = carol; amts[2] = 7e18;

        // Expect all three PaymentSent events in order
        vm.prank(employerA);
        vm.expectEmit(true, true, true, true, address(payroll));
        emit GreyPayroll.PaymentSent(employerA, RUN1, alice, 5e18);
        vm.expectEmit(true, true, true, true, address(payroll));
        emit GreyPayroll.PaymentSent(employerA, RUN1, bob,   6e18);
        vm.expectEmit(true, true, true, true, address(payroll));
        emit GreyPayroll.PaymentSent(employerA, RUN1, carol, 7e18);
        payroll.executePayroll(RUN1, recips, amts);
    }

    function test_Payroll_ThreeRecipients_EmitsPayrollExecuted() public {
        address[] memory recips = new address[](3);
        uint256[] memory amts   = new uint256[](3);
        recips[0] = alice; amts[0] = 5e18;
        recips[1] = bob;   amts[1] = 6e18;
        recips[2] = carol; amts[2] = 7e18;
        uint256 total = 18e18;

        vm.prank(employerA);
        vm.expectEmit(true, true, false, true, address(payroll));
        emit GreyPayroll.PayrollExecuted(employerA, RUN1, total, 3);
        payroll.executePayroll(RUN1, recips, amts);
    }

    // ── 50 recipients (MAX): all succeed ──────────────────────────────────

    function test_Payroll_MaxRecipients_AllSucceed() public {
        // Build 50 unique recipients
        address[] memory recips = new address[](50);
        uint256[] memory amts   = new uint256[](50);
        uint256 perHead = 1e18;
        for (uint256 i; i < 50; ++i) {
            recips[i] = makeAddr(string(abi.encode("r", i)));
            amts[i]   = perHead;
        }
        uint256 total = 50 * perHead;

        // Employer has BIG (10_000e18), total is 50e18 — well within budget
        uint256 before = payroll.balances(employerA);
        vm.prank(employerA);
        payroll.executePayroll(RUN1, recips, amts);

        assertEq(payroll.balances(employerA), before - total);
        assertEq(payroll.runExecuted(employerA, RUN1), true);

        // Spot-check a few recipients received their funds
        assertEq(recips[0].balance,  perHead);
        assertEq(recips[49].balance, perHead);
    }

    // ── Two employers independent ──────────────────────────────────────────

    function test_Payroll_TwoEmployers_IndependentBalances() public {
        address[] memory rA = new address[](1);
        uint256[] memory aA = new uint256[](1);
        rA[0] = alice; aA[0] = ONE;

        address[] memory rB = new address[](1);
        uint256[] memory aB = new uint256[](1);
        rB[0] = bob;   aB[0] = 2 * ONE;

        uint256 aBefore = payroll.balances(employerA);
        uint256 bBefore = payroll.balances(employerB);

        vm.prank(employerA);
        payroll.executePayroll(RUN1, rA, aA);

        vm.prank(employerB);
        payroll.executePayroll(RUN1, rB, aB); // same runId — allowed

        assertEq(payroll.balances(employerA), aBefore - ONE);
        assertEq(payroll.balances(employerB), bBefore - 2 * ONE);
    }

    function test_Payroll_EmployerA_DoesNotAffectEmployerB_Balance() public {
        uint256 bBalance = payroll.balances(employerB);

        (address[] memory r, uint256[] memory a) = _single(alice, ONE);
        vm.prank(employerA);
        payroll.executePayroll(RUN1, r, a);

        assertEq(payroll.balances(employerB), bBalance);
    }

    function test_Payroll_EmployerA_DoesNotMarkEmployerB_RunId() public {
        (address[] memory r, uint256[] memory a) = _single(alice, ONE);
        vm.prank(employerA);
        payroll.executePayroll(RUN1, r, a);

        assertFalse(payroll.runExecuted(employerB, RUN1));
    }

    // ── Contract balance decrements by total paid ──────────────────────────

    function test_Payroll_ContractBalanceDecrements() public {
        uint256 cBefore = address(payroll).balance;
        (address[] memory r, uint256[] memory a) = _single(alice, ONE);
        vm.prank(employerA);
        payroll.executePayroll(RUN1, r, a);
        assertEq(address(payroll).balance, cBefore - ONE);
    }
}
