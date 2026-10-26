// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @dev Reverts on any native-value receive. Used to force executePayroll to
///      roll back when a recipient cannot accept funds.
contract MaliciousReceiver {
    error AlwaysReverts();
    receive() external payable { revert AlwaysReverts(); }
    fallback() external payable { revert AlwaysReverts(); }
}
