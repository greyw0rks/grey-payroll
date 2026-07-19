// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/PayrollTreasury.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {
        _mint(msg.sender, 1_000_000 * 1e6);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}

contract PayrollTreasuryTest is Test {
    PayrollTreasury public treasury;
    MockUSDC public usdc;

    address owner = address(this);
    address relayer = makeAddr("relayer");
    address employer = makeAddr("employer");
    address employee1 = makeAddr("employee1");
    address employee2 = makeAddr("employee2");

    uint256 constant DAILY_RATE = 22_727 * 1e6;       // ~$22.73 USDC (22 days/month)
    uint256 constant WORKING_DAYS = 22;
    uint256 constant BUFFER = DAILY_RATE * WORKING_DAYS * 2; // 2-month buffer

    function setUp() public {
        usdc = new MockUSDC();
        treasury = new PayrollTreasury(relayer, address(usdc));

        // Fund employer and approve treasury
        usdc.transfer(employer, 500_000 * 1e6);
        vm.startPrank(employer);
        usdc.approve(address(treasury), type(uint256).max);
        vm.stopPrank();
    }

    function _deposit(uint256 amount) internal {
        // Owner deposits on behalf of employer (in prod, employer calls directly)
        usdc.approve(address(treasury), amount);
        treasury.deposit(amount);
    }

    function test_deposit() public {
        _deposit(100_000 * 1e6);
        assertEq(treasury.getBalance(), 100_000 * 1e6);
    }

    function test_setEmployee() public {
        _deposit(BUFFER * 2);
        treasury.setEmployee(employee1, DAILY_RATE, WORKING_DAYS);

        (uint256 dailyRate, uint256 bufferAmount, bool active) = treasury.employees(employee1);
        assertEq(dailyRate, DAILY_RATE);
        assertEq(bufferAmount, BUFFER);
        assertTrue(active);
        assertEq(treasury.totalBuffer(), BUFFER);
    }

    function test_setEmployee_revertIfInsufficientBalance() public {
        vm.expectRevert(PayrollTreasury.InsufficientBalance.selector);
        treasury.setEmployee(employee1, DAILY_RATE, WORKING_DAYS);
    }

    function test_setEmployee_revertIfAlreadyActive() public {
        _deposit(BUFFER * 4);
        treasury.setEmployee(employee1, DAILY_RATE, WORKING_DAYS);
        vm.expectRevert(PayrollTreasury.EmployeeAlreadyActive.selector);
        treasury.setEmployee(employee1, DAILY_RATE, WORKING_DAYS);
    }

    function test_releaseDaily() public {
        _deposit(BUFFER * 2 + DAILY_RATE);
        treasury.setEmployee(employee1, DAILY_RATE, WORKING_DAYS);

        uint256 date = 20240115;
        vm.prank(relayer);
        treasury.releaseDaily(employee1, date);

        assertEq(usdc.balanceOf(employee1), DAILY_RATE);
        assertTrue(treasury.released(employee1, date));
    }

    function test_releaseDaily_idempotentGuard() public {
        _deposit(BUFFER * 2 + DAILY_RATE * 2);
        treasury.setEmployee(employee1, DAILY_RATE, WORKING_DAYS);

        uint256 date = 20240115;
        vm.startPrank(relayer);
        treasury.releaseDaily(employee1, date);

        vm.expectRevert(PayrollTreasury.AlreadyReleased.selector);
        treasury.releaseDaily(employee1, date);
        vm.stopPrank();
    }

    function test_releaseDaily_revertIfNotRelayer() public {
        _deposit(BUFFER * 2 + DAILY_RATE);
        treasury.setEmployee(employee1, DAILY_RATE, WORKING_DAYS);

        vm.prank(makeAddr("random"));
        vm.expectRevert(PayrollTreasury.NotRelayer.selector);
        treasury.releaseDaily(employee1, 20240115);
    }

    function test_removeEmployee() public {
        _deposit(BUFFER * 2);
        treasury.setEmployee(employee1, DAILY_RATE, WORKING_DAYS);

        treasury.removeEmployee(employee1);

        (, , bool active) = treasury.employees(employee1);
        assertFalse(active);
        assertEq(treasury.totalBuffer(), 0);
    }

    function test_availableBalance() public {
        _deposit(BUFFER * 3);
        treasury.setEmployee(employee1, DAILY_RATE, WORKING_DAYS);

        assertEq(treasury.availableBalance(), BUFFER * 3 - BUFFER);
    }

    function test_withdraw_aboveBuffer() public {
        _deposit(BUFFER * 3);
        treasury.setEmployee(employee1, DAILY_RATE, WORKING_DAYS);

        uint256 withdrawable = treasury.availableBalance();
        treasury.withdraw(withdrawable);
        assertEq(treasury.availableBalance(), 0);
    }

    function test_withdraw_revertBelowBuffer() public {
        _deposit(BUFFER * 2);
        treasury.setEmployee(employee1, DAILY_RATE, WORKING_DAYS);

        vm.expectRevert(PayrollTreasury.WithdrawExceedsAvailable.selector);
        treasury.withdraw(BUFFER + 1);
    }
}
