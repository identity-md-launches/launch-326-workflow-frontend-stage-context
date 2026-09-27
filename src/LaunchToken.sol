// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title Billboard (BILL) launch token
/// @notice Fixed-supply ERC-20. The whole supply of 1,000,000,000 BILL (10^27 minor units,
///         18 decimals) is minted once to the deployer in the constructor. There is no mint,
///         burn-by-admin, owner, pause, blocklist, fee or upgrade path: the bytecode that is
///         deployed is the bytecode that runs forever.
/// @dev No constructor arguments: the project factory deploys it and receives the supply.
contract LaunchToken is ERC20 {
    /// @notice Total and only supply, in minor units.
    uint256 public constant TOTAL_SUPPLY = 1_000_000_000 ether;

    constructor() ERC20("Billboard", "BILL") {
        _mint(msg.sender, TOTAL_SUPPLY);
    }
}
