// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/PayrollTreasury.sol";
import "../src/EmployeeRegistry.sol";
import "../src/RefundVault.sol";
import "../src/SalaryAdvance.sol";

contract Deploy is Script {
    // Celo Alfajores USDC: 0x2F25deB3848C207fc8E0c34035B3Ba7fC157602B
    // Celo Mainnet  USDC: 0xcebA9300f2b948710d2653dD7B07f33A8B32118C
    // cUSD Alfajores:     0x874069Fa1Eb16D44d622F2e0Ca25eeA172369bC1
    // cUSD Mainnet:       0x765DE816845861e75A25fCA122bb6898B8B1282a

    function run() external {
        address relayer = vm.envAddress("SIGNER_ADDRESS");
        address token = vm.envAddress("TOKEN_ADDRESS");

        vm.startBroadcast();

        PayrollTreasury treasury = new PayrollTreasury(relayer, token);
        EmployeeRegistry registry = new EmployeeRegistry();
        RefundVault refundVault = new RefundVault(token);
        SalaryAdvance salaryAdvance = new SalaryAdvance(token);

        vm.stopBroadcast();

        console.log("PayrollTreasury:  ", address(treasury));
        console.log("EmployeeRegistry: ", address(registry));
        console.log("RefundVault:      ", address(refundVault));
        console.log("SalaryAdvance:    ", address(salaryAdvance));
    }
}
