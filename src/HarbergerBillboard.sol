// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title HarbergerBillboard
/// @notice One billboard held under a Harberger tax, denominated entirely in BILL.
///
///  - The holder self-assesses a price and must keep a BILL deposit on the contract.
///  - Tax accrues per second at 10% of the price per 365 days and is burned by sending it
///    to 0x000000000000000000000000000000000000dEaD. Nobody receives it.
///  - Anyone may buy the billboard at the current price at any time (Harberger rule).
///    The seller is credited price + remaining deposit and collects it with withdraw().
///  - When the accrued tax reaches the deposit the billboard is foreclosed: holder, message
///    and price reset, the deposit is burned, and the next buyer pays only their deposit.
///
/// No owner, admin, pause or upgrade path. No payable function, no receive/fallback: the
/// contract never holds ETH. Every payment in is approve + safeTransferFrom; every payout is
/// pulled by its recipient. All state-changing entry points are nonReentrant and settle the
/// tax first.
contract HarbergerBillboard is ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ------------------------------------------------------------------ constants

    /// @notice Where burned tax goes.
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;
    /// @notice Lowest self-assessed price: 1 BILL.
    uint256 public constant MIN_PRICE = 1 ether;
    /// @notice Highest self-assessed price: 1,000,000,000 BILL (the whole supply).
    uint256 public constant MAX_PRICE = 1_000_000_000 ether;
    /// @notice Tax rate in basis points of the price per TAX_PERIOD.
    uint256 public constant TAX_RATE_BPS = 1000;
    /// @notice Basis-point denominator.
    uint256 public constant BPS = 10_000;
    /// @notice Period over which TAX_RATE_BPS of the price is owed.
    uint256 public constant TAX_PERIOD = 365 days;

    // ------------------------------------------------------------------ storage

    /// @notice The working currency (BILL). Set once at construction.
    IERC20 public immutable token;

    /// @notice Current holder, or address(0) when the billboard is empty / foreclosed.
    address public holder;
    /// @notice Current message.
    bytes32 public message;
    /// @notice Self-assessed price in BILL minor units (0 when empty).
    uint256 public price;
    /// @notice Holder's remaining tax deposit in BILL minor units.
    uint256 public deposit;
    /// @notice Timestamp up to which tax has been settled.
    uint256 public lastSettled;

    /// @notice Sum of every withdrawable(address). Kept so held BILL can be reconciled on-chain.
    uint256 public totalWithdrawable;

    mapping(address account => uint256 amount) private _withdrawable;

    // ------------------------------------------------------------------ events

    event Bought(address indexed holder, uint256 price, uint256 deposit, bytes32 message);
    event PriceChanged(address indexed holder, uint256 oldPrice, uint256 newPrice);
    event MessageChanged(address indexed holder, bytes32 message);
    event DepositChanged(address indexed holder, uint256 deposit);
    event TaxBurned(uint256 amount);
    event Foreclosed(address indexed holder, uint256 burnedDeposit);
    event Withdrawn(address indexed account, uint256 amount);

    // ------------------------------------------------------------------ errors

    error ZeroAddress();
    error NotHolder();
    error AlreadyHolder();
    error PriceOutOfBounds(uint256 price);
    error PriceAboveMax(uint256 price, uint256 maxPrice);
    error ZeroAmount();
    error InsufficientDeposit(uint256 requested, uint256 available);
    error NothingToWithdraw();

    // ------------------------------------------------------------------ constructor

    /// @param token_ The BILL token address. The contract holds no BILL at deploy.
    constructor(address token_) {
        if (token_ == address(0)) revert ZeroAddress();
        token = IERC20(token_);
    }

    // ------------------------------------------------------------------ mutations

    /// @notice Settle accrued tax: burn min(due, deposit) and foreclose if due >= deposit.
    /// @dev Callable by anyone. Every other state-changing function runs this first.
    function settle() external nonReentrant {
        _settle();
    }

    /// @notice Buy the billboard at its current price and become the holder.
    /// @param newPrice     Your self-assessed price, between MIN_PRICE and MAX_PRICE.
    /// @param maxPrice     Revert if the current price (after settling) is above this.
    /// @param newMessage   Message to display.
    /// @param depositAmount BILL to lock as your tax deposit (must be > 0).
    /// @dev Pays `price + depositAmount` from the caller (0 + deposit for an empty or foreclosed
    ///      billboard). The previous holder is credited `price + remaining deposit`.
    function buy(uint256 newPrice, uint256 maxPrice, bytes32 newMessage, uint256 depositAmount) external nonReentrant {
        _settle();

        address previous = holder;
        if (msg.sender == previous) revert AlreadyHolder();
        _checkPriceBounds(newPrice);
        if (depositAmount == 0) revert ZeroAmount();

        uint256 currentPrice = price;
        if (currentPrice > maxPrice) revert PriceAboveMax(currentPrice, maxPrice);

        if (previous != address(0)) {
            uint256 credit = currentPrice + deposit;
            _withdrawable[previous] += credit;
            totalWithdrawable += credit;
        }

        holder = msg.sender;
        price = newPrice;
        message = newMessage;
        deposit = depositAmount;
        lastSettled = block.timestamp;

        emit Bought(msg.sender, newPrice, depositAmount, newMessage);

        token.safeTransferFrom(msg.sender, address(this), currentPrice + depositAmount);
    }

    /// @notice Holder only: change the self-assessed price.
    function setPrice(uint256 newPrice) external nonReentrant {
        _settle();
        _onlyHolder();
        _checkPriceBounds(newPrice);
        uint256 old = price;
        price = newPrice;
        emit PriceChanged(msg.sender, old, newPrice);
    }

    /// @notice Holder only: change the message.
    function setMessage(bytes32 newMessage) external nonReentrant {
        _settle();
        _onlyHolder();
        message = newMessage;
        emit MessageChanged(msg.sender, newMessage);
    }

    /// @notice Holder only: add BILL to the tax deposit.
    function addDeposit(uint256 amount) external nonReentrant {
        _settle();
        _onlyHolder();
        if (amount == 0) revert ZeroAmount();
        uint256 newDeposit = deposit + amount;
        deposit = newDeposit;
        emit DepositChanged(msg.sender, newDeposit);
        token.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @notice Holder only: take BILL out of the tax deposit after settling. Withdrawing the whole
    ///         deposit is allowed; the billboard is then foreclosed by the next settle.
    function withdrawDeposit(uint256 amount) external nonReentrant {
        _settle();
        _onlyHolder();
        if (amount == 0) revert ZeroAmount();
        uint256 available = deposit;
        if (amount > available) revert InsufficientDeposit(amount, available);
        uint256 newDeposit = available - amount;
        deposit = newDeposit;
        emit DepositChanged(msg.sender, newDeposit);
        token.safeTransfer(msg.sender, amount);
    }

    /// @notice Collect BILL credited to the caller (sale proceeds and returned deposits).
    function withdraw() external nonReentrant {
        _settle();
        uint256 amount = _withdrawable[msg.sender];
        if (amount == 0) revert NothingToWithdraw();
        _withdrawable[msg.sender] = 0;
        totalWithdrawable -= amount;
        emit Withdrawn(msg.sender, amount);
        token.safeTransfer(msg.sender, amount);
    }

    // ------------------------------------------------------------------ views

    /// @notice The whole billboard state in one call.
    function state()
        external
        view
        returns (address holder_, bytes32 message_, uint256 price_, uint256 deposit_, uint256 lastSettled_)
    {
        return (holder, message, price, deposit, lastSettled);
    }

    /// @notice Tax that a settle() right now would burn: min(accrued, deposit). 0 when empty.
    function taxDue() external view returns (uint256) {
        if (holder == address(0)) return 0;
        uint256 due = _tax(price, block.timestamp - lastSettled);
        uint256 dep = deposit;
        return due < dep ? due : dep;
    }

    /// @notice Seconds from now until the deposit is exhausted and a settle() forecloses.
    ///         0 when empty, when the deposit is already exhausted, or when the deposit is 0.
    function runwaySeconds() external view returns (uint256) {
        if (holder == address(0)) return 0;
        uint256 dep = deposit;
        if (dep == 0) return 0;
        // Foreclosure happens at the first elapsed second t with ceil(price * t / D) >= dep,
        // i.e. price * t > (dep - 1) * D, i.e. t = floor((dep - 1) * D / price) + 1.
        uint256 foreclosureElapsed = ((dep - 1) * (TAX_PERIOD * BPS / TAX_RATE_BPS)) / price + 1;
        uint256 elapsed = block.timestamp - lastSettled;
        return foreclosureElapsed > elapsed ? foreclosureElapsed - elapsed : 0;
    }

    /// @notice BILL credited to `account`, collectable with withdraw().
    function withdrawable(address account) external view returns (uint256) {
        return _withdrawable[account];
    }

    /// @notice Pure tax formula: ceil(price_ * elapsed * TAX_RATE_BPS / (TAX_PERIOD * BPS)).
    function taxFor(uint256 price_, uint256 elapsed) external pure returns (uint256) {
        return _tax(price_, elapsed);
    }

    // ------------------------------------------------------------------ internals

    function _settle() internal {
        address current = holder;
        if (current == address(0)) return;

        uint256 due = _tax(price, block.timestamp - lastSettled);
        uint256 dep = deposit;
        lastSettled = block.timestamp;

        if (due >= dep) {
            // Foreclosure: the whole deposit is burned, the billboard is emptied.
            holder = address(0);
            message = bytes32(0);
            price = 0;
            deposit = 0;
            emit Foreclosed(current, dep);
            if (dep > 0) {
                emit TaxBurned(dep);
                token.safeTransfer(BURN_ADDRESS, dep);
            }
            return;
        }

        if (due > 0) {
            deposit = dep - due;
            emit TaxBurned(due);
            token.safeTransfer(BURN_ADDRESS, due);
        }
    }

    function _tax(uint256 price_, uint256 elapsed) internal pure returns (uint256) {
        if (price_ == 0 || elapsed == 0) return 0;
        uint256 numerator = price_ * elapsed * TAX_RATE_BPS;
        uint256 denominator = TAX_PERIOD * BPS;
        return (numerator + denominator - 1) / denominator;
    }

    function _onlyHolder() internal view {
        if (msg.sender != holder) revert NotHolder();
    }

    function _checkPriceBounds(uint256 price_) internal pure {
        if (price_ < MIN_PRICE || price_ > MAX_PRICE) revert PriceOutOfBounds(price_);
    }
}
