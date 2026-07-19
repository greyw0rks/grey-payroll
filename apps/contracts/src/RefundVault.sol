// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Expense reimbursement vault. Employees submit requests; employers approve/reject.
contract RefundVault is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status { PENDING, APPROVED, REJECTED }

    struct RefundRequest {
        address employee;
        address employer;
        uint256 amount;
        string ipfsDocHash;
        Status status;
        string rejectionReason;
        uint256 createdAt;
    }

    address public immutable token;
    uint256 public nextRequestId;
    mapping(uint256 => RefundRequest) public requests;

    event RefundRequested(
        uint256 indexed requestId,
        address indexed employee,
        uint256 amount,
        string ipfsDocHash
    );
    event RefundApproved(uint256 indexed requestId, address indexed approver);
    event RefundPaid(uint256 indexed requestId, address indexed employee, uint256 amount);
    event RefundRejected(uint256 indexed requestId, string reason);

    error RequestNotPending();
    error NotAuthorized();
    error InsufficientFunds();

    constructor(address _token) Ownable(msg.sender) {
        token = _token;
    }

    /// @notice Employee submits a refund request. Receipt stored on IPFS — only hash here.
    function submitRequest(
        address employee,
        address employer,
        uint256 amount,
        string calldata ipfsDocHash
    ) external onlyOwner returns (uint256 requestId) {
        requestId = nextRequestId++;
        requests[requestId] = RefundRequest({
            employee: employee,
            employer: employer,
            amount: amount,
            ipfsDocHash: ipfsDocHash,
            status: Status.PENDING,
            rejectionReason: "",
            createdAt: block.timestamp
        });

        emit RefundRequested(requestId, employee, amount, ipfsDocHash);
    }

    /// @notice Employer/HR approves — funds released from vault to employee.
    function approveRequest(uint256 requestId) external onlyOwner nonReentrant {
        RefundRequest storage req = requests[requestId];
        if (req.status != Status.PENDING) revert RequestNotPending();
        if (IERC20(token).balanceOf(address(this)) < req.amount) revert InsufficientFunds();

        req.status = Status.APPROVED;
        IERC20(token).safeTransfer(req.employee, req.amount);

        emit RefundApproved(requestId, msg.sender);
        emit RefundPaid(requestId, req.employee, req.amount);
    }

    /// @notice Employer/HR rejects with a reason.
    function rejectRequest(uint256 requestId, string calldata reason) external onlyOwner {
        RefundRequest storage req = requests[requestId];
        if (req.status != Status.PENDING) revert RequestNotPending();

        req.status = Status.REJECTED;
        req.rejectionReason = reason;

        emit RefundRejected(requestId, reason);
    }

    function getRequest(uint256 requestId) external view returns (RefundRequest memory) {
        return requests[requestId];
    }

    /// @notice Employer deposits funds for expense reimbursements
    function deposit(uint256 amount) external onlyOwner {
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
    }
}
