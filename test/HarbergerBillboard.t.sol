// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/IERC6093.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {LaunchToken} from "../src/LaunchToken.sol";
import {HarbergerBillboard} from "../src/HarbergerBillboard.sol";

contract HarbergerBillboardTest is Test {
    LaunchToken internal token;
    HarbergerBillboard internal bb;

    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;
    // Seconds of price-denominated tax per unit: due = ceil(price * elapsed / D).
    uint256 internal constant D = 365 days * 10_000 / 1000;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");

    uint256 internal constant FUND = 10_000_000 ether;

    event Bought(address indexed holder, uint256 price, uint256 deposit, bytes32 message);
    event PriceChanged(address indexed holder, uint256 oldPrice, uint256 newPrice);
    event MessageChanged(address indexed holder, bytes32 message);
    event DepositChanged(address indexed holder, uint256 deposit);
    event TaxBurned(uint256 amount);
    event Foreclosed(address indexed holder, uint256 burnedDeposit);
    event Withdrawn(address indexed account, uint256 amount);

    function setUp() public {
        token = new LaunchToken();
        bb = new HarbergerBillboard(address(token));
        _fund(alice);
        _fund(bob);
        _fund(carol);
        // Start at a non-round timestamp so nothing accidentally aligns.
        vm.warp(1_700_000_123);
    }

    function _fund(address who) internal {
        token.transfer(who, FUND);
        vm.prank(who);
        token.approve(address(bb), type(uint256).max);
    }

    function _buy(address who, uint256 newPrice, uint256 maxPrice, bytes32 msg_, uint256 dep) internal {
        vm.prank(who);
        bb.buy(newPrice, maxPrice, msg_, dep);
    }

    function _ceilTax(uint256 price, uint256 elapsed) internal pure returns (uint256) {
        if (price == 0 || elapsed == 0) return 0;
        return (price * elapsed + D - 1) / D;
    }

    function _assertConserved() internal view {
        assertEq(
            token.balanceOf(address(bb)), bb.deposit() + bb.totalWithdrawable(), "held BILL != deposit + withdrawable"
        );
    }

    // ------------------------------------------------------------------ construction

    function test_constructor() public view {
        assertEq(address(bb.token()), address(token));
        assertEq(bb.holder(), address(0));
        assertEq(bb.price(), 0);
        assertEq(bb.deposit(), 0);
        assertEq(token.balanceOf(address(bb)), 0);
        assertEq(bb.TAX_RATE_BPS(), 1000);
        assertEq(bb.TAX_PERIOD(), 365 days);
        assertEq(bb.MIN_PRICE(), 1 ether);
        assertEq(bb.MAX_PRICE(), 1_000_000_000 ether);
        assertEq(bb.BURN_ADDRESS(), DEAD);
    }

    function test_constructorRejectsZeroToken() public {
        vm.expectRevert(HarbergerBillboard.ZeroAddress.selector);
        new HarbergerBillboard(address(0));
    }

    function test_neverAcceptsEth() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (bool ok,) = address(bb).call{value: 1}("");
        assertFalse(ok, "plain ETH transfer must fail");
        vm.prank(alice);
        (ok,) = address(bb).call{value: 1}(abi.encodeWithSignature("settle()"));
        assertFalse(ok, "value with calldata must fail");
        assertEq(address(bb).balance, 0);
    }

    // ------------------------------------------------------------------ buying

    function test_buyEmptyBillboardCostsOnlyDeposit() public {
        uint256 before = token.balanceOf(alice);
        vm.expectEmit(true, true, true, true);
        emit Bought(alice, 100 ether, 10 ether, "hello");
        _buy(alice, 100 ether, 0, "hello", 10 ether);

        (address h, bytes32 m, uint256 p, uint256 d, uint256 ls) = bb.state();
        assertEq(h, alice);
        assertEq(m, bytes32("hello"));
        assertEq(p, 100 ether);
        assertEq(d, 10 ether);
        assertEq(ls, block.timestamp);
        assertEq(token.balanceOf(alice), before - 10 ether);
        assertEq(token.balanceOf(address(bb)), 10 ether);
        assertEq(bb.taxDue(), 0);
        _assertConserved();
    }

    function test_buyFromHolderPaysPriceAndCreditsSeller() public {
        _buy(alice, 100 ether, 0, "a", 10 ether);
        vm.warp(block.timestamp + 30 days);
        uint256 due = _ceilTax(100 ether, 30 days);

        uint256 bobBefore = token.balanceOf(bob);
        _buy(bob, 250 ether, 100 ether, "b", 5 ether);

        assertEq(token.balanceOf(bob), bobBefore - 105 ether, "bob pays price + deposit");
        assertEq(bb.withdrawable(alice), 100 ether + (10 ether - due), "alice credited price + remaining deposit");
        assertEq(bb.totalWithdrawable(), bb.withdrawable(alice));
        assertEq(bb.holder(), bob);
        assertEq(bb.price(), 250 ether);
        assertEq(bb.deposit(), 5 ether);
        assertEq(bb.message(), bytes32("b"));
        assertEq(bb.lastSettled(), block.timestamp);
        assertEq(token.balanceOf(DEAD), due);
        _assertConserved();
    }

    function test_buyRevertsWhenPriceRaisedAboveMax() public {
        _buy(alice, 100 ether, 0, "a", 10 ether);
        // Alice sees Bob's buy(maxPrice = 100) in the mempool and raises the price first.
        vm.prank(alice);
        bb.setPrice(200 ether);
        vm.expectRevert(abi.encodeWithSelector(HarbergerBillboard.PriceAboveMax.selector, 200 ether, 100 ether));
        _buy(bob, 300 ether, 100 ether, "b", 1 ether);
        // With maxPrice at the raised price the buy goes through.
        _buy(bob, 300 ether, 200 ether, "b", 1 ether);
        assertEq(bb.holder(), bob);
        assertEq(bb.withdrawable(alice), 200 ether + 10 ether);
    }

    function test_selfBuyRefused() public {
        _buy(alice, 100 ether, 0, "a", 10 ether);
        vm.expectRevert(HarbergerBillboard.AlreadyHolder.selector);
        _buy(alice, 50 ether, 100 ether, "a2", 1 ether);
    }

    function test_buyPriceBounds() public {
        vm.expectRevert(abi.encodeWithSelector(HarbergerBillboard.PriceOutOfBounds.selector, 0));
        _buy(alice, 0, 0, "a", 1 ether);
        vm.expectRevert(abi.encodeWithSelector(HarbergerBillboard.PriceOutOfBounds.selector, 1 ether - 1));
        _buy(alice, 1 ether - 1, 0, "a", 1 ether);
        vm.expectRevert(abi.encodeWithSelector(HarbergerBillboard.PriceOutOfBounds.selector, 1_000_000_000 ether + 1));
        _buy(alice, 1_000_000_000 ether + 1, 0, "a", 1 ether);
        // Boundaries are inclusive.
        _buy(alice, 1 ether, 0, "a", 1);
        _buy(bob, 1_000_000_000 ether, 1 ether, "b", 1);
        assertEq(bb.price(), 1_000_000_000 ether);
    }

    function test_buyRequiresDeposit() public {
        vm.expectRevert(HarbergerBillboard.ZeroAmount.selector);
        _buy(alice, 100 ether, 0, "a", 0);
    }

    function test_buyRequiresAllowanceAndBalance() public {
        address poor = makeAddr("poor");
        vm.prank(poor);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(bb), 0, 1 ether)
        );
        bb.buy(100 ether, 0, "x", 1 ether);

        vm.prank(poor);
        token.approve(address(bb), type(uint256).max);
        vm.prank(poor);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, poor, 0, 1 ether));
        bb.buy(100 ether, 0, "x", 1 ether);
        assertEq(bb.holder(), address(0), "failed buy must not change state");
    }

    function test_buyWithMaxPriceBelowCurrentReverts() public {
        _buy(alice, 100 ether, 0, "a", 10 ether);
        vm.expectRevert(abi.encodeWithSelector(HarbergerBillboard.PriceAboveMax.selector, 100 ether, 99 ether));
        _buy(bob, 100 ether, 99 ether, "b", 1 ether);
    }

    function test_buyChainOfThreeHoldersCreditsEachSeller() public {
        _buy(alice, 100 ether, 0, "a", 10 ether);
        _buy(bob, 200 ether, 100 ether, "b", 20 ether);
        _buy(carol, 300 ether, 200 ether, "c", 30 ether);
        assertEq(bb.withdrawable(alice), 110 ether);
        assertEq(bb.withdrawable(bob), 220 ether);
        assertEq(bb.withdrawable(carol), 0);
        assertEq(bb.deposit(), 30 ether);
        _assertConserved();
        // Alice can buy back from carol.
        _buy(alice, 150 ether, 300 ether, "a2", 1 ether);
        assertEq(bb.withdrawable(carol), 330 ether);
        _assertConserved();
    }

    // ------------------------------------------------------------------ tax

    function test_taxFormulaMatchesSpec() public view {
        // 10% per year exactly.
        assertEq(bb.taxFor(100 ether, 365 days), 10 ether);
        // One second on 100 BILL: 100e18 / 315_360_000 = 317_097_919_837.64... -> rounds up.
        assertEq(bb.taxFor(100 ether, 1), 317_097_919_838);
        // A price that divides exactly does not round.
        assertEq(bb.taxFor(D * 1e12, 1), 1e12);
        // Any positive elapsed on any in-bounds price owes at least 1 wei.
        assertEq(bb.taxFor(1 ether, 1), 3_170_979_199); // 1e18/315360000 = 3170979198.4 -> up
        assertEq(bb.taxFor(100 ether, 0), 0);
        assertEq(bb.taxFor(0, 100), 0);
    }

    function testFuzz_taxRoundsUp(uint256 price, uint256 elapsed) public view {
        price = bound(price, 1 ether, 1_000_000_000 ether);
        elapsed = bound(elapsed, 1, 1000 * 365 days);
        uint256 due = bb.taxFor(price, elapsed);
        assertEq(due, _ceilTax(price, elapsed));
        // ceil property: due * D >= price * elapsed > (due - 1) * D
        assertGe(due * D, price * elapsed);
        assertLt((due - 1) * D, price * elapsed);
        assertGe(due, 1);
    }

    function test_taxAccruesPerSecondAndRoundsUp() public {
        _buy(alice, 100 ether, 0, "a", 10 ether);
        vm.warp(block.timestamp + 1);
        assertEq(bb.taxDue(), 317_097_919_838);
        vm.expectEmit(true, true, true, true);
        emit TaxBurned(317_097_919_838);
        bb.settle();
        assertEq(bb.deposit(), 10 ether - 317_097_919_838);
        assertEq(token.balanceOf(DEAD), 317_097_919_838);
        assertEq(bb.lastSettled(), block.timestamp);
        assertEq(bb.taxDue(), 0);
        _assertConserved();
    }

    function test_settleAfterOneYearBurnsTenPercent() public {
        _buy(alice, 100 ether, 0, "a", 50 ether);
        vm.warp(block.timestamp + 365 days);
        assertEq(bb.taxDue(), 10 ether);
        bb.settle();
        assertEq(bb.deposit(), 40 ether);
        assertEq(token.balanceOf(DEAD), 10 ether);
        assertEq(bb.holder(), alice, "still held");
        _assertConserved();
    }

    function test_settleTwiceInSameSecondIsNoop() public {
        _buy(alice, 100 ether, 0, "a", 50 ether);
        vm.warp(block.timestamp + 7 days);
        bb.settle();
        uint256 dep = bb.deposit();
        uint256 dead = token.balanceOf(DEAD);
        bb.settle();
        assertEq(bb.deposit(), dep);
        assertEq(token.balanceOf(DEAD), dead);
    }

    function test_settleOnEmptyBillboardDoesNothing() public {
        vm.warp(block.timestamp + 30 days);
        bb.settle();
        assertEq(bb.holder(), address(0));
        assertEq(bb.lastSettled(), 0);
        assertEq(token.balanceOf(DEAD), 0);
    }

    function test_manySmallSettlesNeverBurnLessThanOneBigSettle() public {
        // Rounding up per settle means frequent settling can only cost the holder more, never less.
        _buy(alice, 100 ether, 0, "a", 50 ether);
        uint256 start = block.timestamp;
        for (uint256 i; i < 100; ++i) {
            vm.warp(block.timestamp + 1);
            bb.settle();
        }
        uint256 burnedFrequent = token.balanceOf(DEAD);
        uint256 single = _ceilTax(100 ether, block.timestamp - start);
        assertGe(burnedFrequent, single);
        // and the difference is bounded by one wei per settle
        assertLe(burnedFrequent - single, 100);
        _assertConserved();
    }

    // ------------------------------------------------------------------ foreclosure

    function test_foreclosureExactlyWhenDepositRunsOut() public {
        _buy(alice, 100 ether, 0, "a", 10 ether);
        // 10 BILL deposit on a 100 BILL price is exactly one year of tax.
        uint256 runway = bb.runwaySeconds();
        assertEq(runway, 365 days);

        vm.warp(block.timestamp + runway - 1);
        assertLt(bb.taxDue(), bb.deposit(), "one second early: not yet foreclosable");
        assertEq(bb.runwaySeconds(), 1);

        vm.warp(block.timestamp + 1);
        assertEq(bb.taxDue(), bb.deposit(), "at runway: due reaches deposit");
        assertEq(bb.runwaySeconds(), 0);

        vm.expectEmit(true, true, true, true);
        emit Foreclosed(alice, 10 ether);
        vm.expectEmit(true, true, true, true);
        emit TaxBurned(10 ether);
        bb.settle();

        (address h, bytes32 m, uint256 p, uint256 d,) = bb.state();
        assertEq(h, address(0));
        assertEq(m, bytes32(0));
        assertEq(p, 0);
        assertEq(d, 0);
        assertEq(token.balanceOf(DEAD), 10 ether);
        assertEq(token.balanceOf(address(bb)), 0);
        assertEq(bb.withdrawable(alice), 0, "a foreclosed deposit is gone");
        _assertConserved();
    }

    function test_foreclosureOneSecondEarlyDoesNotHappen() public {
        _buy(alice, 100 ether, 0, "a", 10 ether);
        vm.warp(block.timestamp + 365 days - 1);
        bb.settle();
        assertEq(bb.holder(), alice);
        assertGt(bb.deposit(), 0);
        assertLt(bb.deposit(), 1e12);
    }

    function testFuzz_runwayIsExact(uint256 price, uint256 dep, uint256 dt) public {
        price = bound(price, 1 ether, 1_000_000_000 ether);
        dep = bound(dep, 1, FUND - 1);
        dt = bound(dt, 0, 5000 * 365 days);
        _buy(alice, price, 0, "a", dep);
        uint256 runway = bb.runwaySeconds();
        assertGe(runway, 1);
        uint256 start = block.timestamp;

        vm.warp(start + runway - 1);
        assertLt(bb.taxDue(), dep, "not foreclosable one second before runway ends");
        assertEq(bb.runwaySeconds(), 1);

        vm.warp(start + runway);
        assertEq(bb.taxDue(), dep, "foreclosable exactly at runway");
        assertEq(bb.runwaySeconds(), 0);

        vm.warp(start + runway + dt);
        assertEq(bb.taxDue(), dep, "taxDue is capped at the deposit");
        bb.settle();
        assertEq(bb.holder(), address(0));
        assertEq(token.balanceOf(DEAD), dep);
        assertEq(token.balanceOf(address(bb)), 0);
    }

    function test_foreclosureFarInFutureBurnsOnlyTheDeposit() public {
        _buy(alice, 1_000_000_000 ether, 0, "a", 1 ether);
        vm.warp(block.timestamp + 1000 * 365 days);
        assertEq(bb.taxDue(), 1 ether);
        bb.settle();
        assertEq(token.balanceOf(DEAD), 1 ether);
        assertEq(bb.holder(), address(0));
    }

    function test_buyAfterForeclosureCostsOnlyDeposit() public {
        _buy(alice, 100 ether, 0, "a", 10 ether);
        vm.warp(block.timestamp + 2 * 365 days);
        bb.settle();
        assertEq(bb.holder(), address(0));
        uint256 before = token.balanceOf(bob);
        _buy(bob, 5 ether, 0, "b", 1 ether);
        assertEq(token.balanceOf(bob), before - 1 ether);
        assertEq(bb.withdrawable(alice), 0);
        _assertConserved();
    }

    function test_foreclosureMidBuyChargesBuyerOnlyDeposit() public {
        _buy(alice, 100 ether, 0, "a", 10 ether);
        vm.warp(block.timestamp + 2 * 365 days);
        // Nobody settled. Bob offers up to 100 BILL; the settle inside buy forecloses first.
        uint256 before = token.balanceOf(bob);
        vm.expectEmit(true, true, true, true);
        emit Foreclosed(alice, 10 ether);
        _buy(bob, 50 ether, 100 ether, "b", 3 ether);
        assertEq(token.balanceOf(bob), before - 3 ether, "bob paid no price");
        assertEq(bb.withdrawable(alice), 0, "alice gets nothing from a foreclosed sale");
        assertEq(token.balanceOf(DEAD), 10 ether);
        assertEq(bb.holder(), bob);
        assertEq(bb.deposit(), 3 ether);
        _assertConserved();
    }

    function test_foreclosedHolderMayBuyBackAtZero() public {
        _buy(alice, 100 ether, 0, "a", 10 ether);
        vm.warp(block.timestamp + 2 * 365 days);
        // Alice is still recorded as holder until settle; the settle inside buy clears her,
        // so this is not a self-buy.
        _buy(alice, 100 ether, 0, "again", 10 ether);
        assertEq(bb.holder(), alice);
        assertEq(bb.message(), bytes32("again"));
        assertEq(token.balanceOf(DEAD), 10 ether);
    }

    // ------------------------------------------------------------------ holder controls

    function test_setPrice() public {
        _buy(alice, 100 ether, 0, "a", 10 ether);
        vm.warp(block.timestamp + 1 days);
        uint256 due = _ceilTax(100 ether, 1 days);
        vm.expectEmit(true, true, true, true);
        emit PriceChanged(alice, 100 ether, 500 ether);
        vm.prank(alice);
        bb.setPrice(500 ether);
        assertEq(bb.price(), 500 ether);
        assertEq(bb.deposit(), 10 ether - due, "tax settled at the old price first");
        // From now on the tax runs at the new price.
        vm.warp(block.timestamp + 1 days);
        assertEq(bb.taxDue(), _ceilTax(500 ether, 1 days));
    }

    function test_setPriceRejectsNonHolderAndBounds() public {
        vm.prank(alice);
        vm.expectRevert(HarbergerBillboard.NotHolder.selector);
        bb.setPrice(100 ether);

        _buy(alice, 100 ether, 0, "a", 10 ether);
        vm.prank(bob);
        vm.expectRevert(HarbergerBillboard.NotHolder.selector);
        bb.setPrice(100 ether);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(HarbergerBillboard.PriceOutOfBounds.selector, 0));
        bb.setPrice(0);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(HarbergerBillboard.PriceOutOfBounds.selector, 1_000_000_000 ether + 1));
        bb.setPrice(1_000_000_000 ether + 1);
    }

    function test_setPriceAfterForeclosureRevertsNotHolder() public {
        _buy(alice, 100 ether, 0, "a", 10 ether);
        vm.warp(block.timestamp + 2 * 365 days);
        vm.prank(alice);
        vm.expectRevert(HarbergerBillboard.NotHolder.selector);
        bb.setPrice(50 ether);
        // The revert rolled back the inner settle as well; the foreclosure is only recorded once a
        // call succeeds. Anyone can trigger it.
        assertEq(bb.holder(), alice, "the settle inside the failed call is rolled back too");
        bb.settle();
        assertEq(bb.holder(), address(0));
    }

    function test_setMessage() public {
        _buy(alice, 100 ether, 0, "a", 10 ether);
        vm.expectEmit(true, true, true, true);
        emit MessageChanged(alice, "new");
        vm.prank(alice);
        bb.setMessage("new");
        assertEq(bb.message(), bytes32("new"));

        vm.prank(bob);
        vm.expectRevert(HarbergerBillboard.NotHolder.selector);
        bb.setMessage("bob");
    }

    function test_addDeposit() public {
        _buy(alice, 100 ether, 0, "a", 10 ether);
        vm.warp(block.timestamp + 1 days);
        uint256 due = _ceilTax(100 ether, 1 days);
        vm.expectEmit(true, true, true, true);
        emit DepositChanged(alice, 10 ether - due + 5 ether);
        vm.prank(alice);
        bb.addDeposit(5 ether);
        assertEq(bb.deposit(), 15 ether - due);
        _assertConserved();

        vm.prank(alice);
        vm.expectRevert(HarbergerBillboard.ZeroAmount.selector);
        bb.addDeposit(0);
        vm.prank(bob);
        vm.expectRevert(HarbergerBillboard.NotHolder.selector);
        bb.addDeposit(1 ether);
    }

    function test_addDepositExtendsRunway() public {
        _buy(alice, 100 ether, 0, "a", 10 ether);
        assertEq(bb.runwaySeconds(), 365 days);
        vm.prank(alice);
        bb.addDeposit(10 ether);
        assertEq(bb.runwaySeconds(), 2 * 365 days);
    }

    function test_withdrawDepositBounds() public {
        _buy(alice, 100 ether, 0, "a", 10 ether);
        vm.warp(block.timestamp + 1 days);
        uint256 due = _ceilTax(100 ether, 1 days);
        uint256 available = 10 ether - due;

        vm.prank(bob);
        vm.expectRevert(HarbergerBillboard.NotHolder.selector);
        bb.withdrawDeposit(1);

        vm.prank(alice);
        vm.expectRevert(HarbergerBillboard.ZeroAmount.selector);
        bb.withdrawDeposit(0);

        // Cannot withdraw the part that is already owed as tax.
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(HarbergerBillboard.InsufficientDeposit.selector, available + 1, available)
        );
        bb.withdrawDeposit(available + 1);

        uint256 before = token.balanceOf(alice);
        vm.expectEmit(true, true, true, true);
        emit DepositChanged(alice, available - 1 ether);
        vm.prank(alice);
        bb.withdrawDeposit(1 ether);
        assertEq(token.balanceOf(alice), before + 1 ether);
        assertEq(bb.deposit(), available - 1 ether);
        _assertConserved();
    }

    function test_withdrawWholeDepositThenForeclosedOnNextSettle() public {
        _buy(alice, 100 ether, 0, "a", 10 ether);
        vm.prank(alice);
        bb.withdrawDeposit(10 ether);
        assertEq(bb.deposit(), 0);
        assertEq(bb.holder(), alice, "still the holder until the next settle");
        assertEq(bb.runwaySeconds(), 0);
        assertEq(bb.taxDue(), 0);
        vm.expectEmit(true, true, true, true);
        emit Foreclosed(alice, 0);
        bb.settle();
        assertEq(bb.holder(), address(0));
        assertEq(token.balanceOf(DEAD), 0, "nothing to burn");
        _assertConserved();
    }

    function test_holderWithdrawingDepositBeforeSaleLosesTheSale() public {
        // Attack: the holder sees a buy coming and pulls the whole deposit so no tax is burned.
        _buy(alice, 100 ether, 0, "a", 10 ether);
        vm.warp(block.timestamp + 10 days);
        uint256 due = _ceilTax(100 ether, 10 days);
        vm.prank(alice);
        bb.withdrawDeposit(10 ether - due); // the settle inside burns the tax owed so far
        assertEq(token.balanceOf(DEAD), due, "tax to this moment cannot be avoided");
        assertEq(bb.deposit(), 0);

        // Bob's pending buy at maxPrice 100: the settle forecloses, Bob pays nothing for the slot.
        uint256 before = token.balanceOf(bob);
        _buy(bob, 100 ether, 100 ether, "b", 1 ether);
        assertEq(token.balanceOf(bob), before - 1 ether);
        assertEq(bb.withdrawable(alice), 0, "alice forfeits the 100 BILL sale price");
        assertEq(bb.holder(), bob);
        _assertConserved();
    }

    // ------------------------------------------------------------------ withdraw

    function test_withdrawPaysCreditAndIsPullOnly() public {
        _buy(alice, 100 ether, 0, "a", 10 ether);
        _buy(bob, 200 ether, 100 ether, "b", 1 ether);
        assertEq(bb.withdrawable(alice), 110 ether);

        uint256 before = token.balanceOf(alice);
        vm.expectEmit(true, true, true, true);
        emit Withdrawn(alice, 110 ether);
        vm.prank(alice);
        bb.withdraw();
        assertEq(token.balanceOf(alice), before + 110 ether);
        assertEq(bb.withdrawable(alice), 0);
        assertEq(bb.totalWithdrawable(), 0);
        _assertConserved();

        vm.prank(alice);
        vm.expectRevert(HarbergerBillboard.NothingToWithdraw.selector);
        bb.withdraw();
        vm.prank(carol);
        vm.expectRevert(HarbergerBillboard.NothingToWithdraw.selector);
        bb.withdraw();
    }

    function test_withdrawAlsoSettles() public {
        _buy(alice, 100 ether, 0, "a", 10 ether);
        _buy(bob, 200 ether, 100 ether, "b", 1 ether);
        vm.warp(block.timestamp + 1 days);
        vm.prank(alice);
        bb.withdraw();
        assertEq(bb.lastSettled(), block.timestamp);
        assertEq(token.balanceOf(DEAD), _ceilTax(200 ether, 1 days));
    }

    function test_creditsAccumulateAcrossSales() public {
        _buy(alice, 100 ether, 0, "a", 10 ether);
        _buy(bob, 100 ether, 100 ether, "b", 10 ether);
        _buy(alice, 100 ether, 100 ether, "a", 10 ether);
        _buy(bob, 100 ether, 100 ether, "b", 10 ether);
        assertEq(bb.withdrawable(alice), 220 ether);
        assertEq(bb.withdrawable(bob), 110 ether);
        assertEq(bb.totalWithdrawable(), 330 ether);
        _assertConserved();
    }

    // ------------------------------------------------------------------ views

    function test_viewsOnEmptyBillboard() public view {
        assertEq(bb.taxDue(), 0);
        assertEq(bb.runwaySeconds(), 0);
        assertEq(bb.withdrawable(alice), 0);
    }

    function test_runwayCountsDown() public {
        _buy(alice, 100 ether, 0, "a", 10 ether);
        uint256 r0 = bb.runwaySeconds();
        vm.warp(block.timestamp + 1000);
        assertEq(bb.runwaySeconds(), r0 - 1000);
        vm.prank(alice);
        bb.setPrice(200 ether);
        // Doubling the price roughly halves the remaining runway.
        uint256 r1 = bb.runwaySeconds();
        assertLe(r1, (r0 - 1000) / 2 + 1);
        assertGe(r1, (r0 - 1000) / 2 - 1);
    }

    // ------------------------------------------------------------------ reentrancy

    function test_reentrancyGuardBlocksReentryFromTokenCallbacks() public {
        MaliciousToken evil = new MaliciousToken();
        HarbergerBillboard target = new HarbergerBillboard(address(evil));
        evil.setTarget(target);
        evil.mint(alice, 1000 ether);
        evil.mint(bob, 1000 ether);
        vm.prank(alice);
        evil.approve(address(target), type(uint256).max);
        vm.prank(bob);
        evil.approve(address(target), type(uint256).max);

        vm.prank(alice);
        target.buy(100 ether, 0, "a", 10 ether);
        vm.prank(bob);
        target.buy(100 ether, 100 ether, "b", 10 ether);
        assertEq(target.withdrawable(alice), 110 ether);

        // Attack 1: re-enter withdraw() from the payout transfer.
        evil.arm(MaliciousToken.Mode.Withdraw);
        vm.prank(alice);
        target.withdraw();
        assertEq(evil.reentryAttempts(), 1);
        assertEq(evil.reentrySucceeded(), 0, "re-entrant withdraw must fail");
        assertEq(evil.lastError(), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(target.withdrawable(alice), 0);
        assertEq(evil.balanceOf(alice), 1000 ether - 10 ether + 110 ether, "paid exactly once");

        // Attack 2: re-enter buy() from the burn transfer inside settle().
        vm.warp(block.timestamp + 1 days);
        evil.arm(MaliciousToken.Mode.Buy);
        target.settle();
        assertEq(evil.reentrySucceeded(), 0, "re-entrant buy must fail");
        assertEq(evil.lastError(), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(target.holder(), bob);

        // Attack 3: re-enter withdrawDeposit() from the deposit payout.
        evil.arm(MaliciousToken.Mode.WithdrawDeposit);
        vm.prank(bob);
        target.withdrawDeposit(1 ether);
        assertEq(evil.reentrySucceeded(), 0, "re-entrant withdrawDeposit must fail");
        assertEq(evil.lastError(), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(evil.balanceOf(address(target)), target.deposit() + target.totalWithdrawable());
    }

    // ------------------------------------------------------------------ conservation

    function testFuzz_conservationAcrossRandomSequence(uint256 seed) public {
        address[3] memory actors = [alice, bob, carol];
        for (uint256 i; i < 24; ++i) {
            uint256 r = uint256(keccak256(abi.encode(seed, i)));
            address who = actors[r % 3];
            uint256 action = (r >> 8) % 6;
            vm.warp(block.timestamp + ((r >> 16) % (90 days)));
            vm.startPrank(who);
            if (action == 0 && bb.holder() != who) {
                uint256 p = bb.price();
                bb.buy(1 ether + (r >> 64) % (1000 ether), p, bytes32(r), 1 + (r >> 128) % (100 ether));
            } else if (action == 1 && bb.holder() == who && bb.taxDue() < bb.deposit()) {
                bb.setPrice(1 ether + (r >> 64) % (1000 ether));
            } else if (action == 2 && bb.holder() == who && bb.taxDue() < bb.deposit()) {
                bb.addDeposit(1 + (r >> 128) % (100 ether));
            } else if (action == 3 && bb.holder() == who && bb.taxDue() < bb.deposit()) {
                uint256 avail = bb.deposit() - bb.taxDue();
                bb.withdrawDeposit(1 + (r >> 128) % avail);
            } else if (action == 4 && bb.withdrawable(who) > 0) {
                bb.withdraw();
            } else {
                bb.settle();
            }
            vm.stopPrank();
            _assertConserved();
        }
        uint256 total = token.balanceOf(alice) + token.balanceOf(bob) + token.balanceOf(carol)
            + token.balanceOf(address(bb)) + token.balanceOf(DEAD) + token.balanceOf(address(this));
        assertEq(total, token.totalSupply());
    }
}

/// @dev An ERC-20 that calls back into the billboard during transfers, to prove the guard holds.
///      The real BILL token has no hooks; this exists only to exercise the nonReentrant paths.
contract MaliciousToken {
    enum Mode {
        None,
        Withdraw,
        Buy,
        WithdrawDeposit
    }

    string public constant name = "Evil";
    string public constant symbol = "EVIL";
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    HarbergerBillboard public target;
    Mode public mode;
    uint256 public reentryAttempts;
    uint256 public reentrySucceeded;
    bytes4 public lastError;

    function setTarget(HarbergerBillboard t) external {
        target = t;
    }

    function arm(Mode m) external {
        mode = m;
        lastError = bytes4(0);
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _move(msg.sender, to, amount);
        _reenter();
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        if (a != type(uint256).max) allowance[from][msg.sender] = a - amount;
        _move(from, to, amount);
        return true;
    }

    function _move(address from, address to, uint256 amount) internal {
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }

    function _reenter() internal {
        Mode m = mode;
        if (m == Mode.None) return;
        mode = Mode.None; // one attempt per arming
        reentryAttempts += 1;
        bool ok;
        bytes memory ret;
        if (m == Mode.Withdraw) {
            (ok, ret) = address(target).call(abi.encodeCall(HarbergerBillboard.withdraw, ()));
        } else if (m == Mode.Buy) {
            (ok, ret) =
                address(target).call(abi.encodeCall(HarbergerBillboard.buy, (1 ether, type(uint256).max, "x", 1)));
        } else {
            (ok, ret) = address(target).call(abi.encodeCall(HarbergerBillboard.withdrawDeposit, (1)));
        }
        if (ok) {
            reentrySucceeded += 1;
        } else if (ret.length >= 4) {
            lastError = bytes4(ret);
        }
    }
}
