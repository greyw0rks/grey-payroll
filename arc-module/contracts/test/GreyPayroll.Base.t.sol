// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @notice Shared base for GreyPayroll test suite.
 *
 * Arc-chain limitation note
 * ─────────────────────────
 * Standard EVM unit tests cannot prove Arc-specific behaviours such as native
 * USDC blocklist enforcement, system-contract interactions, or chain-level
 * transfer restrictions. Those paths require a live Arc fork (integration test
 * lane). All tests here operate on forge's in-process EVM.
 */

import {Test} from "forge-std/Test.sol";
import {GreyPayroll} from "../GreyPayroll.sol";

abstract contract GreyPayrollBase is Test {
    // ── Contract under test ────────────────────────────────────────────────
    GreyPayroll internal payroll;

    // ── Named actors ──────────────────────────────────────────────────────
    address internal employerA = makeAddr("employerA");
    address internal employerB = makeAddr("employerB");
    address internal alice     = makeAddr("alice");
    address internal bob       = makeAddr("bob");
    address internal carol     = makeAddr("carol");

    // ── Convenient run IDs ────────────────────────────────────────────────
    bytes32 internal constant RUN1 = keccak256("run1");
    bytes32 internal constant RUN2 = keccak256("run2");

    // ── Native USDC (18 dec) amounts ─────────────────────────────────────
    uint256 internal constant ONE   = 1e18;
    uint256 internal constant SMALL = 100e18;
    uint256 internal constant BIG   = 10_000e18;

    function setUp() public virtual {
        payroll = new GreyPayroll();
        // Fund actors with plenty of native currency so tests never hit
        // "insufficient funds" at the EVM level.
        vm.deal(employerA, 1_000_000e18);
        vm.deal(employerB, 1_000_000e18);
        vm.deal(alice,     1_000_000e18);
        vm.deal(bob,       1_000_000e18);
        vm.deal(carol,     1_000_000e18);
    }

    // ── Helper: deposit on behalf of an employer ──────────────────────────
    function _deposit(address employer, uint256 amount) internal {
        vm.prank(employer);
        payroll.deposit{value: amount}();
    }

    // ── Helper: build single-recipient arrays ─────────────────────────────
    function _single(address r, uint256 a)
        internal
        pure
        returns (address[] memory recipients, uint256[] memory amounts)
    {
        recipients = new address[](1);
        amounts    = new uint256[](1);
        recipients[0] = r;
        amounts[0]    = a;
    }

    // ── Helper: build n-recipient arrays of equal amounts ─────────────────
    function _equal(address[] memory recips, uint256 perHead)
        internal
        pure
        returns (address[] memory, uint256[] memory)
    {
        uint256[] memory amts = new uint256[](recips.length);
        for (uint256 i; i < recips.length; ++i) amts[i] = perHead;
        return (recips, amts);
    }
}
