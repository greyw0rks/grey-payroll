// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Core payroll contract. Employer deposits stablecoins; backend relayer releases daily pay.
contract PayrollTreasury is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct EmployeeConfig {
        uint256 dailyRate;     // in token's base units (wei for cUSD, 6-dec units for USDC)
        uint256 bufferAmount;  // 2-month buffer locked per employee
        bool active;
    }

    address public immutable relayer;
    address public immutable token;

    mapping(address => EmployeeConfig) public employees;
    // Idempotency guard: (employee, date) => already released
    mapping(address => mapping(uint256 => bool)) public released;

    uint256 public totalBuffer;

    event TreasuryDeposit(address indexed employer, uint256 amount);
    event EmployeeAdded(address indexed employee, uint256 dailyRate, uint256 bufferAmount);
    event EmployeeRemoved(address indexed employee, uint256 bufferReleased);
    event DailyRelease(address indexed employee, uint256 amount, uint256 date);
    event EmergencyWithdraw(address indexed owner, uint256 amount);

    error NotRelayer();
    error EmployeeNotActive();
    error AlreadyReleased();
    error InsufficientBalance();
    error EmployeeAlreadyActive();
    error WithdrawExceedsAvailable();

    modifier onlyRelayer() {
        if (msg.sender != relayer) revert NotRelayer();
        _;
    }

    constructor(address _relayer, address _token) Ownable(msg.sender) {
        relayer = _relayer;
        token = _token;
    }

    /// @notice Employer deposits stablecoins into the treasury
    function deposit(uint256 amount) external nonReentrant {
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        emit TreasuryDeposit(msg.sender, amount);
    }

    /// @notice Register an employee with their daily rate. Locks a 2-month buffer.
    /// @param employee Employee wallet address
    /// @param dailyRate Amount released per verified check-in day
    /// @param workingDaysPerMonth Used to calculate 2-month buffer (dailyRate * workingDays * 2)
    function setEmployee(
        address employee,
        uint256 dailyRate,
        uint256 workingDaysPerMonth
    ) external onlyOwner {
        if (employees[employee].active) revert EmployeeAlreadyActive();

        uint256 buffer = dailyRate * workingDaysPerMonth * 2;
        if (availableBalance() < buffer) revert InsufficientBalance();

        employees[employee] = EmployeeConfig({
            dailyRate: dailyRate,
            bufferAmount: buffer,
            active: true
        });
        totalBuffer += buffer;

        emit EmployeeAdded(employee, dailyRate, buffer);
    }

    /// @notice Terminate an employee — releases their buffer back to available treasury
    function removeEmployee(address employee) external onlyOwner {
        EmployeeConfig storage cfg = employees[employee];
        if (!cfg.active) revert EmployeeNotActive();

        uint256 bufferReleased = cfg.bufferAmount;
        totalBuffer -= bufferReleased;
        cfg.active = false;
        cfg.bufferAmount = 0;

        emit EmployeeRemoved(employee, bufferReleased);
    }

    /// @notice Called by backend relayer once per employee per day after a verified check-in.
    ///         Idempotent: will revert if already released for this (employee, date) pair.
    /// @param employee Employee wallet address
    /// @param date UTC date as YYYYMMDD uint (e.g. 20240115)
    function releaseDaily(address employee, uint256 date) external onlyRelayer nonReentrant {
        EmployeeConfig storage cfg = employees[employee];
        if (!cfg.active) revert EmployeeNotActive();
        if (released[employee][date]) revert AlreadyReleased();
        if (IERC20(token).balanceOf(address(this)) < cfg.dailyRate) revert InsufficientBalance();

        released[employee][date] = true;
        IERC20(token).safeTransfer(employee, cfg.dailyRate);

        emit DailyRelease(employee, cfg.dailyRate, date);
    }

    /// @notice Owner withdraws surplus above the locked buffer floor
    function withdraw(uint256 amount) external onlyOwner nonReentrant {
        if (amount > availableBalance()) revert WithdrawExceedsAvailable();
        IERC20(token).safeTransfer(msg.sender, amount);
    }

    /// @notice Emergency: owner can withdraw all after a 30-day notice is handled off-chain
    function emergencyWithdraw() external onlyOwner nonReentrant {
        uint256 balance = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransfer(msg.sender, balance);
        emit EmergencyWithdraw(msg.sender, balance);
    }

    /// @notice Total token balance held by contract
    function getBalance() external view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    /// @notice Balance available above the locked buffer floor
    function availableBalance() public view returns (uint256) {
        uint256 balance = IERC20(token).balanceOf(address(this));
        return balance > totalBuffer ? balance - totalBuffer : 0;
    }

    /// @notice Buffer locked for a specific employee
    function getEmployeeBuffer(address employee) external view returns (uint256) {
        return employees[employee].bufferAmount;
    }
}
