// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {Deploy} from "../script/Deploy.s.sol";
import {LaunchToken} from "../src/LaunchToken.sol";
import {HarbergerBillboard} from "../src/HarbergerBillboard.sol";

contract DeployTest is Test {
    Deploy internal deployer;

    function setUp() public {
        deployer = new Deploy();
    }

    function test_deployWiresBillboardToToken() public {
        (LaunchToken token, HarbergerBillboard billboard) = deployer.deploy(31_337);
        assertEq(address(billboard.token()), address(token));
        assertEq(token.totalSupply(), 10 ** 27);
        // The token mints to whoever deploys it: here the script contract, in production the factory.
        assertEq(token.balanceOf(address(deployer)), 10 ** 27);
        assertEq(token.balanceOf(address(billboard)), 0, "the app holds no BILL at deploy");
        assertEq(billboard.holder(), address(0));
    }

    function test_deployWithoutExpectedChainSkipsCheck() public {
        (LaunchToken token,) = deployer.deploy(0);
        assertEq(token.totalSupply(), 10 ** 27);
    }

    function test_deployRejectsChainMismatch() public {
        vm.expectRevert(abi.encodeWithSelector(Deploy.ChainMismatch.selector, 11_155_111, 31_337));
        deployer.deploy(11_155_111);
    }

    function test_deployRejectsUnsupportedChain() public {
        vm.chainId(1);
        vm.expectRevert(abi.encodeWithSelector(Deploy.UnsupportedChain.selector, 1));
        deployer.deploy(0);
    }

    function test_deployOnSepoliaChainId() public {
        vm.chainId(11_155_111);
        (LaunchToken token, HarbergerBillboard billboard) = deployer.deploy(11_155_111);
        assertEq(address(billboard.token()), address(token));
    }
}
