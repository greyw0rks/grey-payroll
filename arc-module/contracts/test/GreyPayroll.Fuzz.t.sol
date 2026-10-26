// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {GreyPayrollBase} from "./GreyPayroll.Base.t.sol";
import {GreyPayroll}     from "../GreyPayroll.sol";

contract GreyPayrollFuzzTest is GreyPayrollBase {
    // ── fuzz: deposit → withdraw round-trip ───────────────────────────────

    /// @dev uint96 keeps amounts under 2^96 — well within Arc native USDC supply.
    function testFuzz_DepositWithdrawRoundTrip(uint96 rawAmount) public {
        // Bound: min 1 wei, max 1e30 (well within uint256; actor has 1_000_000e18)
        uint256 amount = bound(rawAmount, 1, 1_000_000e18);

        // Ensure employerA has enough native funds
        vm.deal(employerA, amount + 1 ether);

        uint256 totalBefore = payroll.totalDeposited();
        uint256 callerBefore = employerA.balance;

        _deposit(employerA, amount);

        assertEq(payroll.balances(employerA), amount,              "balance after deposit");
        assertEq(payroll.totalDeposited(),    totalBefore + amount, "totalDeposited after deposit");

        vm.prank(employerA);
        payroll.withdraw(amount);

        assertEq(payroll.balances(employerA), 0,           "balance after withdraw");
        assertEq(payroll.totalDeposited(),    totalBefore,  "totalDeposited after withdraw");

        // Caller is whole again (no fee)
        assertEq(employerA.balance, callerBefore, "caller ETH not restored");
    }

    // ── fuzz: deposit sum → executePayroll to 3 recipients ───────────────

    function testFuzz_ThreeRecipientConservation(
        uint96 raw0,
        uint96 raw1,
        uint96 raw2
    ) public {
        // Each payment must be at least 1 wei
        uint256 a0 = bound(raw0, 1, 333_333e18);
        uint256 a1 = bound(raw1, 1, 333_333e18);
        uint256 a2 = bound(raw2, 1, 333_333e18);
        uint256 total = a0 + a1 + a2;

        // Fund employer with exactly the total needed
        vm.deal(employerA, total + 1 ether); // extra for gas

        _deposit(employerA, total);

        address[] memory recips = new address[](3);
        uint256[] memory amts   = new uint256[](3);
        recips[0] = alice; amts[0] = a0;
        recips[1] = bob;   amts[1] = a1;
        recips[2] = carol; amts[2] = a2;

        // Record balances before
        uint256 aliceBefore = alice.balance;
        uint256 bobBefore   = bob.balance;
        uint256 carolBefore = carol.balance;
        uint256 contractBefore = address(payroll).balance;

        vm.prank(employerA);
        payroll.executePayroll(RUN1, recips, amts);

        // Each recipient received exactly their amount
        assertEq(alice.balance, aliceBefore + a0, "alice wrong amount");
        assertEq(bob.balance,   bobBefore   + a1, "bob wrong amount");
        assertEq(carol.balance, carolBefore + a2, "carol wrong amount");

        // Employer balance is zero (they deposited exactly total)
        assertEq(payroll.balances(employerA), 0, "employer ledger not fully debited");

        // Contract balance shrank by exactly total
        assertEq(address(payroll).balance, contractBefore - total, "contract balance wrong");

        // totalDeposited reflects the emptied employer ledger
        assertEq(payroll.totalDeposited(), 0, "totalDeposited not zero");
    }

    // ── fuzz: replay protection holds for random runIds ──────────────────

    function testFuzz_ReplayProtection(bytes32 runId) public {
        vm.assume(runId != bytes32(0));
        vm.deal(employerA, 3 * ONE);
        _deposit(employerA, 2 * ONE);

        (address[] memory r, uint256[] memory a) = _single(alice, ONE);
        vm.prank(employerA);
        payroll.executePayroll(runId, r, a);

        vm.prank(employerA);
        vm.expectRevert(GreyPayroll.RunAlreadyExecuted.selector);
        payroll.executePayroll(runId, r, a);
    }

    // ── fuzz: employer isolation for arbitrary amounts ─────────────────────

    function testFuzz_EmployerIsolation(uint96 rawA, uint96 rawB) public {
        uint256 depA = bound(rawA, ONE, 500_000e18);
        uint256 depB = bound(rawB, ONE, 500_000e18);

        vm.deal(employerA, depA + 1 ether);
        vm.deal(employerB, depB + 1 ether);

        _deposit(employerA, depA);
        _deposit(employerB, depB);

        // A executes payroll paying alice 1 wei
        (address[] memory r, uint256[] memory a) = _single(alice, 1);
        vm.prank(employerA);
        payroll.executePayroll(RUN1, r, a);

        // B's balance completely untouched
        assertEq(payroll.balances(employerB), depB, "B balance changed by A's payroll");
    }
}
