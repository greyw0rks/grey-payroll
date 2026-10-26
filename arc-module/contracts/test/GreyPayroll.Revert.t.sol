// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {GreyPayrollBase} from "./GreyPayroll.Base.t.sol";
import {GreyPayroll}     from "../GreyPayroll.sol";

contract GreyPayrollRevertTest is GreyPayrollBase {
    function setUp() public override {
        super.setUp();
        _deposit(employerA, BIG);
    }

    // ── ZeroRunId ─────────────────────────────────────────────────────────

    function test_Revert_ZeroRunId() public {
        (address[] memory r, uint256[] memory a) = _single(alice, ONE);
        vm.prank(employerA);
        vm.expectRevert(GreyPayroll.ZeroRunId.selector);
        payroll.executePayroll(bytes32(0), r, a);
    }

    // ── EmptyRecipients ───────────────────────────────────────────────────

    function test_Revert_EmptyRecipients() public {
        address[] memory r = new address[](0);
        uint256[] memory a = new uint256[](0);
        vm.prank(employerA);
        vm.expectRevert(GreyPayroll.EmptyRecipients.selector);
        payroll.executePayroll(RUN1, r, a);
    }

    // ── ArrayLengthMismatch ───────────────────────────────────────────────

    function test_Revert_ArrayLengthMismatch_MoreRecipients() public {
        address[] memory r = new address[](2);
        r[0] = alice; r[1] = bob;
        uint256[] memory a = new uint256[](1);
        a[0] = ONE;
        vm.prank(employerA);
        vm.expectRevert(abi.encodeWithSelector(GreyPayroll.ArrayLengthMismatch.selector, uint256(2), uint256(1)));
        payroll.executePayroll(RUN1, r, a);
    }

    function test_Revert_ArrayLengthMismatch_MoreAmounts() public {
        address[] memory r = new address[](1);
        r[0] = alice;
        uint256[] memory a = new uint256[](2);
        a[0] = ONE; a[1] = ONE;
        vm.prank(employerA);
        vm.expectRevert(abi.encodeWithSelector(GreyPayroll.ArrayLengthMismatch.selector, uint256(1), uint256(2)));
        payroll.executePayroll(RUN1, r, a);
    }

    // ── TooManyRecipients (51) ────────────────────────────────────────────

    function test_Revert_TooManyRecipients() public {
        uint256 n = 51;
        address[] memory r = new address[](n);
        uint256[] memory a = new uint256[](n);
        for (uint256 i; i < n; ++i) {
            r[i] = makeAddr(string(abi.encode("over", i)));
            a[i] = ONE;
        }
        // Ensure employer has enough funds
        _deposit(employerA, n * ONE);
        vm.prank(employerA);
        vm.expectRevert(GreyPayroll.TooManyRecipients.selector);
        payroll.executePayroll(RUN1, r, a);
    }

    // ── ZeroAmount ────────────────────────────────────────────────────────

    function test_Revert_ZeroAmount_FirstRecipient() public {
        (address[] memory r, uint256[] memory a) = _single(alice, 0);
        vm.prank(employerA);
        vm.expectRevert(abi.encodeWithSelector(GreyPayroll.ZeroAmount.selector, uint256(0)));
        payroll.executePayroll(RUN1, r, a);
    }

    function test_Revert_ZeroAmount_SecondRecipient() public {
        address[] memory r = new address[](2);
        uint256[] memory a = new uint256[](2);
        r[0] = alice; a[0] = ONE;
        r[1] = bob;   a[1] = 0;
        vm.prank(employerA);
        vm.expectRevert(abi.encodeWithSelector(GreyPayroll.ZeroAmount.selector, uint256(1)));
        payroll.executePayroll(RUN1, r, a);
    }

    // ── ZeroRecipient ─────────────────────────────────────────────────────

    function test_Revert_ZeroRecipient() public {
        address[] memory r = new address[](1);
        uint256[] memory a = new uint256[](1);
        r[0] = address(0); a[0] = ONE;
        vm.prank(employerA);
        vm.expectRevert(abi.encodeWithSelector(GreyPayroll.ZeroRecipient.selector, uint256(0)));
        payroll.executePayroll(RUN1, r, a);
    }

    // ── SelfPayment ───────────────────────────────────────────────────────

    function test_Revert_SelfPayment() public {
        address[] memory r = new address[](1);
        uint256[] memory a = new uint256[](1);
        r[0] = address(payroll); a[0] = ONE;
        vm.prank(employerA);
        vm.expectRevert(abi.encodeWithSelector(GreyPayroll.SelfPayment.selector, uint256(0)));
        payroll.executePayroll(RUN1, r, a);
    }

    // ── DuplicateRecipient ────────────────────────────────────────────────

    function test_Revert_DuplicateRecipient_AdjacentEntries() public {
        address[] memory r = new address[](2);
        uint256[] memory a = new uint256[](2);
        r[0] = alice; a[0] = ONE;
        r[1] = alice; a[1] = ONE; // duplicate
        vm.prank(employerA);
        vm.expectRevert(abi.encodeWithSelector(GreyPayroll.DuplicateRecipient.selector, uint256(1)));
        payroll.executePayroll(RUN1, r, a);
    }

    function test_Revert_DuplicateRecipient_NonAdjacentEntries() public {
        address[] memory r = new address[](3);
        uint256[] memory a = new uint256[](3);
        r[0] = alice; a[0] = ONE;
        r[1] = bob;   a[1] = ONE;
        r[2] = alice; a[2] = ONE; // duplicate at i=2, j=0
        vm.prank(employerA);
        vm.expectRevert(abi.encodeWithSelector(GreyPayroll.DuplicateRecipient.selector, uint256(2)));
        payroll.executePayroll(RUN1, r, a);
    }

    // ── InsufficientBalance (executePayroll) ──────────────────────────────

    function test_Revert_InsufficientBalance_ExceedsEmployerFunds() public {
        uint256 available = payroll.balances(employerA);
        uint256 excess = available + 1;
        (address[] memory r, uint256[] memory a) = _single(alice, excess);
        vm.prank(employerA);
        vm.expectRevert(abi.encodeWithSelector(GreyPayroll.InsufficientBalance.selector, available, excess));
        payroll.executePayroll(RUN1, r, a);
    }

    function test_Revert_InsufficientBalance_EmployerWithNoFunds() public {
        (address[] memory r, uint256[] memory a) = _single(alice, ONE);
        address poor = makeAddr("poor");
        vm.deal(poor, ONE);
        vm.prank(poor);
        vm.expectRevert(abi.encodeWithSelector(GreyPayroll.InsufficientBalance.selector, uint256(0), ONE));
        payroll.executePayroll(RUN1, r, a);
    }

    function test_Revert_InsufficientBalance_MultipleRecipientsSumExceeds() public {
        // employerA has BIG = 10_000e18; try to pay 3×5_000e18 + 1 = 15_000e18+1
        address[] memory r = new address[](3);
        uint256[] memory a = new uint256[](3);
        r[0] = alice; a[0] = 5_000e18;
        r[1] = bob;   a[1] = 5_000e18;
        r[2] = carol; a[2] = 5_000e18 + 1;
        vm.prank(employerA);
        vm.expectRevert(abi.encodeWithSelector(GreyPayroll.InsufficientBalance.selector, BIG, 15_000e18 + 1));
        payroll.executePayroll(RUN1, r, a);
    }

    // ── RunAlreadyExecuted ────────────────────────────────────────────────

    function test_Revert_RunAlreadyExecuted() public {
        (address[] memory r, uint256[] memory a) = _single(alice, ONE);
        vm.prank(employerA);
        payroll.executePayroll(RUN1, r, a);

        // Second call with same employer + same runId
        (address[] memory r2, uint256[] memory a2) = _single(bob, ONE);
        vm.prank(employerA);
        vm.expectRevert(GreyPayroll.RunAlreadyExecuted.selector);
        payroll.executePayroll(RUN1, r2, a2);
    }
}
