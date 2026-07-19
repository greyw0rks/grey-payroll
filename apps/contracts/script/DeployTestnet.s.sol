// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/PayrollTreasury.sol";
import "../src/MockERC20.sol";

// Deploys MockUSDC + PayrollTreasury on Celo Sepolia.
// Usage:
//   SIGNER_ADDRESS=<relayer> forge script script/DeployTestnet.s.sol \
//     --rpc-url https://celo-sepolia.drpc.org \
//     --broadcast \
//     --private-key <key>
//
// After deploy:
//   1. Set NEXT_PUBLIC_USDC_ADDRESS=<MockUSDC address> in apps/web/.env.local
//   2. Set employer treasuryContractAddress in the app
//   3. Mint test USDC: cast send <MockUSDC> "mint(address,uint256)" <your-addr> 1000000000 \
//        --rpc-url https://celo-sepolia.drpc.org --private-key <key>
contract DeployTestnet is Script {
    function run() external {
        address relayer = vm.envOr("SIGNER_ADDRESS", msg.sender);

        vm.startBroadcast();

        // Deploy mock USDC with 6 decimals (same as real USDC)
        MockERC20 mockUsdc = new MockERC20("USD Coin (Test)", "USDC", 6);

        // Mint 1,000,000 USDC to the deployer for testing
        mockUsdc.mint(msg.sender, 1_000_000 * 1e6);

        // Deploy treasury with relayer + mock USDC
        PayrollTreasury treasury = new PayrollTreasury(relayer, address(mockUsdc));

        vm.stopBroadcast();

        console.log("MockUSDC:        ", address(mockUsdc));
        console.log("PayrollTreasury: ", address(treasury));
        console.log("Relayer:         ", relayer);
        console.log("");
        console.log("Add to apps/web/.env.local:");
        console.log("NEXT_PUBLIC_USDC_ADDRESS=", address(mockUsdc));
    }
}
