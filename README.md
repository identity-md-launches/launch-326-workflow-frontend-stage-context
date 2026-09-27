# Billboard (BILL) + HarbergerBillboard

Sepolia `evm_project` launch: a fixed-supply ERC-20 (**Billboard**, symbol **BILL**) and one
application contract, **HarbergerBillboard**, a single message board held under a Harberger tax
that is paid and burned in BILL.

This repository holds the contracts, their Foundry tests, ABI exports and this document. The
launch manifest (`launch.json`) is produced by the separate manifest assignment; the independent
adversarial review is a separate assignment. The one-page website is built after deployment.

| Contract | File | Constructor | Purpose |
|---|---|---|---|
| `LaunchToken` | `src/LaunchToken.sol` | none | BILL, 1,000,000,000 × 10^18 minted once to `msg.sender` (the factory) |
| `HarbergerBillboard` | `src/HarbergerBillboard.sol` | `(address token)` = `$token` | the billboard, all accounting in BILL |

ABI exports: `docs/abi/LaunchToken.json`, `docs/abi/HarbergerBillboard.json`.

---

## Rules of the billboard

There is exactly one billboard. It is either **empty** (`holder == address(0)`) or **held**.

- **Buying.** Anyone who is not the current holder can call
  `buy(newPrice, maxPrice, newMessage, depositAmount)`. They pay `price + depositAmount` BILL
  (the current price is `0` when the billboard is empty or foreclosed, so they pay only the
  deposit). The previous holder is credited `price + their remaining deposit`, collectable with
  `withdraw()`. `maxPrice` is the buyer's protection: if the current price (after settling) is
  above it the call reverts, so a holder cannot front-run a buyer with a price raise.
- **Self-assessed price.** `newPrice` must be between 1 BILL and 1,000,000,000 BILL inclusive.
  The holder may change it at any time with `setPrice`. Anyone may buy at that price at any time.
- **Tax.** 10% of the price per 365 days, accrued per second and rounded up:

  ```
  due = ceil(price * elapsed * 1000 / (365 days * 10000))
      = ceil(price * elapsed / 315_360_000)
  ```

  `elapsed = block.timestamp - lastSettled`. Tax is **burned**: transferred to
  `0x000000000000000000000000000000000000dEaD`. Nobody receives it.
- **Settling.** `settle()` can be called by anyone and runs first inside every state-changing
  function. It burns `min(due, deposit)`. If `due >= deposit` the billboard is **foreclosed**:
  holder, message and price reset to zero and the whole deposit is burned.
- **Deposit.** The holder can top up with `addDeposit(amount)` and take out with
  `withdrawDeposit(amount)`; the latter settles first and never goes below zero. Withdrawing the
  whole deposit is allowed; the billboard then forecloses at the next settle (by anyone).
- **Message.** `setMessage(bytes32)` by the holder only. Messages are 32 bytes.
- **Payouts.** Pull only. Sale proceeds and returned deposits are credited to `withdrawable(addr)`
  and collected with `withdraw()`. `withdrawDeposit` pays the calling holder directly. Nothing is
  ever pushed to a third party.
- **No ETH, no admin.** No payable function, no `receive`/`fallback`, no owner, no pause, no
  upgrade path. The contract holds no BILL at deploy.

### Interface

Mutations (all `nonReentrant`, all settle first):

| Function | Who | Effect |
|---|---|---|
| `settle()` | anyone | burn accrued tax, foreclose if the deposit is exhausted |
| `buy(uint256 newPrice, uint256 maxPrice, bytes32 newMessage, uint256 depositAmount)` | not the holder | take over; pays `price + depositAmount` via `safeTransferFrom` |
| `setPrice(uint256)` | holder | change price (1 … 1e9 BILL) |
| `setMessage(bytes32)` | holder | change message |
| `addDeposit(uint256)` | holder | add BILL to the deposit |
| `withdrawDeposit(uint256)` | holder | take BILL out of the deposit after settling |
| `withdraw()` | anyone with credit | collect credited BILL |

Views: `state()` → `(holder, message, price, deposit, lastSettled)`, `taxDue()` (amount a settle
now would burn, capped at the deposit), `runwaySeconds()` (seconds until a settle forecloses),
`withdrawable(address)`, `totalWithdrawable()`, `token()`, `taxFor(price, elapsed)` (pure
formula), plus public getters for every state variable and constant.

Events: `Bought(holder, price, deposit, message)`, `PriceChanged(holder, oldPrice, newPrice)`,
`MessageChanged(holder, message)`, `DepositChanged(holder, newDeposit)`, `TaxBurned(amount)`,
`Foreclosed(holder, burnedDeposit)`, `Withdrawn(account, amount)`.

Errors: `ZeroAddress`, `NotHolder`, `AlreadyHolder`, `PriceOutOfBounds(price)`,
`PriceAboveMax(price, maxPrice)`, `ZeroAmount`, `InsufficientDeposit(requested, available)`,
`NothingToWithdraw`, and OpenZeppelin's `ReentrancyGuardReentrantCall` / ERC-20 errors.

### Runway

Foreclosure happens at the first elapsed second `t` where `ceil(price · t / D) >= deposit`
(`D = 315_360_000`), i.e. `t = floor((deposit − 1) · D / price) + 1`. `runwaySeconds()` returns
that minus the seconds already elapsed, floored at zero. Because any in-bounds price owes at
least 1 wei per second, a deposit of 1 wei survives exactly 0 seconds past the next block.

---

## Assumptions and trust model

- **BILL is the only token.** The billboard's `token` is immutable and set by the factory to the
  launch token. BILL is a plain OpenZeppelin ERC-20: no fees, no hooks, no rebasing. The
  reentrancy guard is defence in depth, exercised in tests against a hostile mock token.
- **Players get BILL from the launch pool.** The contract never holds ETH and offers no swap.
- **Tax is burned to `0x…dEaD`.** Burned BILL is out of circulation but still counted in
  `totalSupply`. No party, including the launch owner, receives tax.
- **Nobody is privileged.** There is no owner; `$owner` is not used. The factory is
  `msg.sender` in the constructor and gets no rights.
- **Time comes from `block.timestamp`.** A builder can nudge it by seconds, which changes the tax
  by a few wei; nothing valuable depends on exact timing.
- **Frequent settling costs the holder more, never less.** Each settle rounds up independently,
  so a griefer who settles every block can add at most 1 wei per settle to the holder's tax.
  The test `test_manySmallSettlesNeverBurnLessThanOneBigSettle` pins this bound.
- **Foreclosure is lazy.** A billboard whose deposit has run out (or was fully withdrawn)
  still shows its holder and message until someone calls `settle()` or any other mutation.
  The website should show `runwaySeconds() == 0` as "foreclosed, pending settle" and offer a
  Settle button. A buyer never needs to settle first: `buy` settles internally.
- **A holder who withdraws the whole deposit forfeits the sale.** The next `buy` (or any settle)
  forecloses first, the price becomes 0 and the ex-holder is credited nothing. Tax accrued up to
  the moment of withdrawal is burned by the settle inside `withdrawDeposit`. What the holder can
  do is display the message tax-free between that withdrawal and the next settle by anyone; the
  cost of ending that window is one `settle()` call.
- **Tests are not an audit.** The independent adversarial review is a separate assignment.

## Deployment parameters

Target: Sepolia (chain id 11155111), through the IdentityMD project factory. The factory
deploys the token, receives the supply, then deploys the application with the token address.

| Item | Value |
|---|---|
| Launch token | `LaunchToken` (`src/LaunchToken.sol`), name `Billboard`, symbol `BILL`, 18 decimals, supply `1000000000000000000000000000` |
| Application | `HarbergerBillboard`, constructorArgs `["$token"]`, no `$owner` |
| Constructor types | `address` only; nonpayable; no calls made in the constructor |
| Pool | no hook; pair against native ETH; fee 3000, tickSpacing 60, `initialPrice` `79228162514264337593543950336` unless policy overrides |
| Compiler | solc 0.8.26, optimizer 200 runs, `evm_version = "paris"`, `bytecode_hash = "none"`, `cbor_metadata = false` |
| Runtime size | HarbergerBillboard ≈ 3.9 KB, LaunchToken ≈ 2 KB (well under EIP-170) |
| Forbidden opcodes | none: no DELEGATECALL, CALLCODE or SELFDESTRUCT in either runtime |

Fixed protocol constants (not configurable): `TAX_RATE_BPS = 1000`, `TAX_PERIOD = 365 days`,
`MIN_PRICE = 1e18`, `MAX_PRICE = 1e27`, `BURN_ADDRESS = 0x…dEaD`.

## Operational responsibilities

- **Deployer (network service):** publishes source, attests, admits and deploys through the
  factory from `launch.json`. Nothing in this repository holds keys or broadcasts.
- **Holder:** keep the deposit funded (`runwaySeconds()`), price the slot honestly (anyone can buy
  at that price), withdraw credits with `withdraw()` after being bought out.
- **Anyone:** may call `settle()` to burn overdue tax and finalize a foreclosure. Nobody is
  required to; the contract is correct without a keeper, only lazier.
- **Website:** reads the BILL address from `token()`, shows `state()`, `taxDue()`,
  `runwaySeconds()`, the connected wallet's balance, allowance and `withdrawable`, requires an
  Approve step before `buy` and `addDeposit`, exposes `maxPrice` on the buy form, and offers
  Withdraw and Settle buttons. No backend and no indexer: lists come from views and events.

## Build and test (offline)

```
forge build --offline
forge test --offline
forge fmt --check
EXPECTED_CHAIN_ID=0 forge script script/Deploy.s.sol:Deploy --offline
```

Dependencies are vendored as plain files under `lib/` (forge-std 1.16.2, OpenZeppelin Contracts
5.7.0); no git submodules, no network. Tests read no environment variables and pass in any order.

Test map:

| File | Covers |
|---|---|
| `test/LaunchToken.t.sol` | name/symbol/decimals, supply minted to deployer, exact transfer, no mint/admin selectors |
| `test/HarbergerBillboard.t.sol` | tax rounding (unit + fuzz), foreclosure exactly at runway (unit + fuzz), buy of empty/held/foreclosed board, `maxPrice` front-run protection, self-buy refused, price bounds, deposit bounds, whole-deposit withdrawal, holder-withdraws-before-sale, foreclosure mid-buy, withdraw pull semantics, reentrancy via a hostile token (withdraw, buy, withdrawDeposit), conservation over random sequences, ETH refused |
| `test/HarbergerBillboard.invariant.t.sol` | fuzzed call sequences with warped time, `fail_on_revert = true`: held BILL == deposit + Σ withdrawable; no settle burns more than the deposit it found; supply conservation; state shape |
| `test/Deploy.t.sol` | the deploy function's wiring and chain checks, called directly |

## Local dry-run deployment (operator only)

Production deployment is the factory's job. To reproduce the pair on a local chain for
inspection:

```
EXPECTED_CHAIN_ID=31337 forge script script/Deploy.s.sol:Deploy --rpc-url <anvil> --broadcast
```

The script accepts only chain ids 31337 and 11155111 and reads nothing but `EXPECTED_CHAIN_ID`.

## Self-review notes (for the independent reviewer)

Attack surfaces named in the workflow and how the code answers them:

1. **Tax rounding / elapsed arithmetic.** `ceil` via `(n + d − 1) / d`; `price ≤ 1e27`,
   `elapsed` bounded by real time, so `price · elapsed · 1000` cannot overflow uint256.
   `elapsed = 0` → `0`. Fuzz-checked against a reference implementation and the ceil property.
2. **Front-running a buyer with `setPrice`.** `buy` checks `price ≤ maxPrice` after settling.
3. **Holder avoiding tax by withdrawing the deposit before a buy.** The settle inside
   `withdrawDeposit` burns everything owed to that second; afterwards the board is foreclosable
   and the buy forecloses it, so the holder gets no sale price.
4. **Foreclosure mid-buy.** `_settle()` runs first; a foreclosed board has price 0 and the old
   holder is not credited. `AlreadyHolder` is checked after the settle so a foreclosed holder may
   re-buy.
5. **Reentrancy on withdraw.** State zeroed before the transfer, `nonReentrant` on every entry
   point, tested with a callback token.

Known limitations the tests do not cover: behaviour under a token other than the plain BILL
ERC-20 (by design the token is immutable), and gas-price-level economics of griefing settles.
