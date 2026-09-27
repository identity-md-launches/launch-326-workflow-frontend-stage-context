// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {LaunchToken} from "../src/LaunchToken.sol";
import {HarbergerBillboard} from "../src/HarbergerBillboard.sol";

/// @dev Drives the billboard with a small set of actors, random amounts and warped time.
///      Every call is guarded by exact preconditions so the run fails on any unexpected revert.
contract BillboardHandler is Test {
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;

    LaunchToken public token;
    HarbergerBillboard public bb;
    address[] public actors;

    // Ghost state
    uint256 public burnExceededDepositCount;
    uint256 public totalBurnedObserved;
    uint256 public buys;
    uint256 public settles;
    uint256 public foreclosures;
    uint256 public priceChanges;
    uint256 public depositAdds;
    uint256 public depositWithdrawals;
    uint256 public withdraws;
    uint256 public warps;

    constructor(LaunchToken token_, HarbergerBillboard bb_, address[] memory actors_) {
        token = token_;
        bb = bb_;
        actors = actors_;
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    // ------------------------------------------------------------------ helpers

    modifier tracksBurn() {
        uint256 depositBefore = bb.deposit();
        address holderBefore = bb.holder();
        uint256 deadBefore = token.balanceOf(DEAD);
        _;
        uint256 burned = token.balanceOf(DEAD) - deadBefore;
        totalBurnedObserved += burned;
        if (burned > depositBefore) burnExceededDepositCount += 1;
        if (holderBefore != address(0) && bb.holder() == address(0)) foreclosures += 1;
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function _foreclosable() internal view returns (bool) {
        // taxDue() is capped at the deposit; equality means a settle forecloses.
        return bb.taxDue() >= bb.deposit();
    }

    // ------------------------------------------------------------------ actions

    function warp(uint256 dt) external {
        dt = bound(dt, 0, 400 days);
        vm.warp(block.timestamp + dt);
        warps += 1;
    }

    function settle() external tracksBurn {
        bb.settle();
        settles += 1;
    }

    function buy(uint256 actorSeed, uint256 newPrice, bytes32 msg_, uint256 dep) external tracksBurn {
        address who = _actor(actorSeed);
        if (who == bb.holder()) return;
        newPrice = bound(newPrice, 1 ether, 1_000_000 ether);
        uint256 currentPrice = bb.price(); // after the settle it is this or 0
        uint256 balance = token.balanceOf(who);
        if (balance <= currentPrice) return;
        dep = bound(dep, 1, balance - currentPrice);
        vm.prank(who);
        bb.buy(newPrice, currentPrice, msg_, dep);
        buys += 1;
    }

    function setPrice(uint256 newPrice) external tracksBurn {
        address who = bb.holder();
        if (who == address(0) || _foreclosable()) return;
        newPrice = bound(newPrice, 1 ether, 1_000_000 ether);
        vm.prank(who);
        bb.setPrice(newPrice);
        priceChanges += 1;
    }

    function setMessage(bytes32 msg_) external tracksBurn {
        address who = bb.holder();
        if (who == address(0) || _foreclosable()) return;
        vm.prank(who);
        bb.setMessage(msg_);
    }

    function addDeposit(uint256 amount) external tracksBurn {
        address who = bb.holder();
        if (who == address(0) || _foreclosable()) return;
        uint256 balance = token.balanceOf(who);
        if (balance == 0) return;
        amount = bound(amount, 1, balance);
        vm.prank(who);
        bb.addDeposit(amount);
        depositAdds += 1;
    }

    function withdrawDeposit(uint256 amount) external tracksBurn {
        address who = bb.holder();
        if (who == address(0) || _foreclosable()) return;
        uint256 available = bb.deposit() - bb.taxDue();
        amount = bound(amount, 1, available);
        vm.prank(who);
        bb.withdrawDeposit(amount);
        depositWithdrawals += 1;
    }

    function withdraw(uint256 actorSeed) external tracksBurn {
        address who = _actor(actorSeed);
        if (bb.withdrawable(who) == 0) return;
        vm.prank(who);
        bb.withdraw();
        withdraws += 1;
    }
}

/// forge-config: default.invariant.fail-on-revert = true
contract HarbergerBillboardInvariantTest is Test {
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;

    LaunchToken internal token;
    HarbergerBillboard internal bb;
    BillboardHandler internal handler;
    address[] internal actors;

    function setUp() public {
        token = new LaunchToken();
        bb = new HarbergerBillboard(address(token));
        for (uint256 i; i < 5; ++i) {
            address a = makeAddr(string.concat("actor", vm.toString(i)));
            actors.push(a);
            token.transfer(a, 1_000_000 ether);
            vm.prank(a);
            token.approve(address(bb), type(uint256).max);
        }
        handler = new BillboardHandler(token, bb, actors);
        vm.warp(1_700_000_123);
        targetContract(address(handler));
    }

    function _sumWithdrawable() internal view returns (uint256 sum) {
        for (uint256 i; i < actors.length; ++i) {
            sum += bb.withdrawable(actors[i]);
        }
    }

    /// BILL held by the contract is exactly the holder's deposit plus everyone's withdrawable credit.
    /// Taxes are burned, never held.
    function invariant_heldEqualsDepositPlusWithdrawable() public view {
        assertEq(token.balanceOf(address(bb)), bb.deposit() + bb.totalWithdrawable());
        assertEq(bb.totalWithdrawable(), _sumWithdrawable());
    }

    /// No settle ever burns more than the deposit it found.
    function invariant_settleNeverBurnsMoreThanDeposit() public view {
        assertEq(handler.burnExceededDepositCount(), 0);
    }

    /// Everything burned went to the burn address and nowhere else; supply is conserved.
    function invariant_supplyConserved() public view {
        uint256 total = token.balanceOf(address(bb)) + token.balanceOf(DEAD) + token.balanceOf(address(this));
        for (uint256 i; i < actors.length; ++i) {
            total += token.balanceOf(actors[i]);
        }
        assertEq(total, token.totalSupply());
        assertEq(token.balanceOf(DEAD), handler.totalBurnedObserved());
    }

    /// An empty billboard is fully reset; a held one has an in-bounds price.
    function invariant_stateShape() public view {
        if (bb.holder() == address(0)) {
            assertEq(bb.price(), 0);
            assertEq(bb.deposit(), 0);
            assertEq(bb.message(), bytes32(0));
            assertEq(bb.taxDue(), 0);
            assertEq(bb.runwaySeconds(), 0);
        } else {
            assertGe(bb.price(), bb.MIN_PRICE());
            assertLe(bb.price(), bb.MAX_PRICE());
            assertLe(bb.taxDue(), bb.deposit());
            assertLe(bb.lastSettled(), block.timestamp);
        }
        assertEq(address(bb).balance, 0);
    }
}
