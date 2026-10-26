// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {GreyPayroll} from "../GreyPayroll.sol";

/// @dev On receiving native value it immediately re-enters executePayroll with
///      the same runId that triggered the original call. The nonReentrant guard
///      must fire with Reentrancy() before RunAlreadyExecuted().
contract ReentrantReceiver {
    GreyPayroll public immutable target;
    bytes32     public           runId;
    address[]   internal         _recipients;
    uint256[]   internal         _amounts;

    constructor(GreyPayroll _target) {
        target = _target;
    }

    /// @notice Arm the reentrant call before the payroll run.
    function arm(
        bytes32          _runId,
        address[] memory recipients,
        uint256[] memory amounts
    ) external {
        runId       = _runId;
        _recipients = recipients;
        _amounts    = amounts;
    }

    /// @dev Called by the payroll contract when sending this address its share.
    ///      Immediately re-enters executePayroll with the same runId.
    receive() external payable {
        // This will hit the nonReentrant guard → Reentrancy()
        target.executePayroll(runId, _recipients, _amounts);
    }

    /// @dev Allow the test to pre-fund this contract as an employer.
    function depositInto(GreyPayroll _payroll) external payable {
        _payroll.deposit{value: msg.value}();
    }
}
