// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {LaunchToken} from "../src/LaunchToken.sol";

contract LaunchTokenTest is Test {
    LaunchToken internal token;
    address internal deployer = address(0xD3B107);

    function setUp() public {
        vm.prank(deployer);
        token = new LaunchToken();
    }

    function test_metadata() public view {
        assertEq(token.name(), "Billboard");
        assertEq(token.symbol(), "BILL");
        assertEq(token.decimals(), 18);
    }

    function test_fixedSupplyMintedToDeployer() public view {
        assertEq(token.totalSupply(), 1_000_000_000 ether);
        assertEq(token.totalSupply(), 10 ** 27);
        assertEq(token.TOTAL_SUPPLY(), 10 ** 27);
        assertEq(token.balanceOf(deployer), 10 ** 27);
    }

    function test_transferMovesExactAmount() public {
        address to = address(0xCAFE);
        vm.prank(deployer);
        assertTrue(token.transfer(to, 123 ether));
        assertEq(token.balanceOf(to), 123 ether);
        assertEq(token.balanceOf(deployer), 10 ** 27 - 123 ether);
        assertEq(token.totalSupply(), 10 ** 27);
    }

    function testFuzz_transferConservesSupply(address to, uint256 amount) public {
        vm.assume(to != address(0) && to != deployer);
        amount = bound(amount, 0, 10 ** 27);
        vm.prank(deployer);
        token.transfer(to, amount);
        assertEq(token.balanceOf(to) + token.balanceOf(deployer), 10 ** 27);
        assertEq(token.totalSupply(), 10 ** 27);
    }

    function test_transferAboveBalanceReverts() public {
        vm.prank(address(0xBEEF));
        vm.expectRevert();
        token.transfer(deployer, 1);
    }

    function test_noMintOrAdminEntryPoints() public {
        string[6] memory sigs = [
            "mint(address,uint256)",
            "mint(uint256)",
            "burn(address,uint256)",
            "transferOwnership(address)",
            "pause()",
            "upgradeTo(address)"
        ];
        for (uint256 i; i < sigs.length; ++i) {
            vm.prank(deployer);
            (bool ok,) = address(token).call(abi.encodeWithSignature(sigs[i], deployer, uint256(1)));
            assertFalse(ok, sigs[i]);
        }
        assertEq(token.totalSupply(), 10 ** 27);
    }
}
