// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Immutable on-chain record of employment relationships.
contract EmployeeRegistry is Ownable {
    enum EmploymentType { FULL_TIME, CONTRACT, PART_TIME }

    struct EmploymentRecord {
        address employer;
        uint256 monthlyRate;   // in token base units
        uint256 startDate;     // unix timestamp
        uint256 endDate;       // 0 if still active
        address token;         // USDC or cUSD address
        EmploymentType employmentType;
        bool active;
    }

    mapping(address => EmploymentRecord) public records;

    event EmploymentRegistered(
        address indexed employee,
        address indexed employer,
        uint256 monthlyRate,
        uint256 startDate
    );
    event EmploymentDeactivated(address indexed employee, uint256 endDate);

    error AlreadyRegistered();
    error NotRegistered();
    error NotAuthorized();

    constructor() Ownable(msg.sender) {}

    /// @notice Register a new employment relationship. Only callable by owner (backend relayer).
    function register(
        address employee,
        address employer,
        uint256 monthlyRate,
        uint256 startDate,
        address token,
        EmploymentType employmentType
    ) external onlyOwner {
        if (records[employee].active) revert AlreadyRegistered();

        records[employee] = EmploymentRecord({
            employer: employer,
            monthlyRate: monthlyRate,
            startDate: startDate,
            endDate: 0,
            token: token,
            employmentType: employmentType,
            active: true
        });

        emit EmploymentRegistered(employee, employer, monthlyRate, startDate);
    }

    /// @notice Deactivate an employment record on termination.
    function deactivate(address employee, uint256 endDate) external onlyOwner {
        EmploymentRecord storage rec = records[employee];
        if (!rec.active) revert NotRegistered();

        rec.active = false;
        rec.endDate = endDate;

        emit EmploymentDeactivated(employee, endDate);
    }

    function employerOf(address employee) external view returns (address) {
        return records[employee].employer;
    }

    function employmentActive(address employee) external view returns (bool) {
        return records[employee].active;
    }

    function salaryRecord(address employee)
        external
        view
        returns (uint256 monthlyRate, uint256 startDate, address token)
    {
        EmploymentRecord storage rec = records[employee];
        return (rec.monthlyRate, rec.startDate, rec.token);
    }
}
