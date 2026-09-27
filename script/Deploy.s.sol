// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script} from "forge-std/Script.sol";
import {LaunchToken} from "../src/LaunchToken.sol";
import {HarbergerBillboard} from "../src/HarbergerBillboard.sol";

/// @title Deploy (local / dry-run reference)
/// @notice The production deployment is performed by the IdentityMD project factory from
///         launch.json: it deploys LaunchToken, then HarbergerBillboard with constructorArgs
///         ["$token"]. This script reproduces that pair on a local chain so the wiring can be
///         checked without the factory. It reads no keys. The only environment input is
///         EXPECTED_CHAIN_ID (optional, 0 = do not check).
contract Deploy is Script {
    uint256 public constant ANVIL_CHAIN_ID = 31_337;
    uint256 public constant SEPOLIA_CHAIN_ID = 11_155_111;

    error UnsupportedChain(uint256 chainId);
    error ChainMismatch(uint256 expected, uint256 actual);

    function run() external returns (LaunchToken token, HarbergerBillboard billboard) {
        uint256 expectedChainId = vm.envOr("EXPECTED_CHAIN_ID", uint256(0));
        vm.startBroadcast();
        (token, billboard) = deploy(expectedChainId);
        vm.stopBroadcast();
    }

    /// @dev Deploys the launch token and the billboard wired to it. Tests call this directly.
    /// @param expectedChainId Chain the caller intends to deploy to; 0 skips the check.
    function deploy(uint256 expectedChainId) public returns (LaunchToken token, HarbergerBillboard billboard) {
        if (block.chainid != ANVIL_CHAIN_ID && block.chainid != SEPOLIA_CHAIN_ID) {
            revert UnsupportedChain(block.chainid);
        }
        if (expectedChainId != 0 && expectedChainId != block.chainid) {
            revert ChainMismatch(expectedChainId, block.chainid);
        }
        token = new LaunchToken();
        billboard = new HarbergerBillboard(address(token));
    }
}
