// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Salary advances and company loans. Repaid by deducting from future daily releases.
contract SalaryAdvance is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status { PENDING, APPROVED, REJECTED, REPAID }

    struct AdvanceRequest {
        address employee;
        uint256 amount;
        uint256 outstanding;
        string reason;
        Status status;
        bool isLoan;       // false = salary advance, true = company loan
        uint256 createdAt;
    }

    address public immutable token;
    uint256 public nextRequestId;
    mapping(uint256 => AdvanceRequest) public requests;
    mapping(address => uint256) public totalOutstanding;

    event AdvanceRequested(uint256 indexed requestId, address indexed employee, uint256 amount, bool isLoan);
    event AdvanceApproved(uint256 indexed requestId, address indexed employee, uint256 amount);
    event AdvanceRejected(uint256 indexed requestId);
    event AdvanceRepaid(uint256 indexed requestId, uint256 amountRepaid, uint256 outstanding);

    error RequestNotPending();
    error NotActive();
    error InsufficientFunds();
    error RepayExceedsOutstanding();

    constructor(address _token) Ownable(msg.sender) {
        token = _token;
    }

    function requestAdvance(
        address employee,
        uint256 amount,
        string calldata reason,
        bool isLoan
    ) external onlyOwner returns (uint256 requestId) {
        requestId = nextRequestId++;
        requests[requestId] = AdvanceRequest({
            employee: employee,
            amount: amount,
            outstanding: amount,
            reason: reason,
            status: Status.PENDING,
            isLoan: isLoan,
            createdAt: block.timestamp
        });

        emit AdvanceRequested(requestId, employee, amount, isLoan);
    }

    function approveAdvance(uint256 requestId) external onlyOwner nonReentrant {
        AdvanceRequest storage req = requests[requestId];
        if (req.status != Status.PENDING) revert RequestNotPending();
        if (IERC20(token).balanceOf(address(this)) < req.amount) revert InsufficientFunds();

        req.status = Status.APPROVED;
        totalOutstanding[req.employee] += req.amount;
        IERC20(token).safeTransfer(req.employee, req.amount);

        emit AdvanceApproved(requestId, req.employee, req.amount);
    }

    function rejectAdvance(uint256 requestId) external onlyOwner {
        AdvanceRequest storage req = requests[requestId];
        if (req.status != Status.PENDING) revert RequestNotPending();
        req.status = Status.REJECTED;
        emit AdvanceRejected(requestId);
    }

    /// @notice Called by backend when deducting from a daily release to repay advance.
    function repayAdvance(uint256 requestId, uint256 amount) external onlyOwner {
        AdvanceRequest storage req = requests[requestId];
        if (req.outstanding < amount) revert RepayExceedsOutstanding();

        req.outstanding -= amount;
        totalOutstanding[req.employee] -= amount;

        if (req.outstanding == 0) {
            req.status = Status.REPAID;
        }

        emit AdvanceRepaid(requestId, amount, req.outstanding);
    }

    function getLoanBalance(address employee) external view returns (uint256) {
        return totalOutstanding[employee];
    }

    function getRequest(uint256 requestId) external view returns (AdvanceRequest memory) {
        return requests[requestId];
    }

    function deposit(uint256 amount) external onlyOwner {
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
    }
}
