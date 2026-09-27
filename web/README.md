# Billboard frontend

One static page for the attested HarbergerBillboard deployment. React + TypeScript + Vite, with viem for contract reads, simulation and injected-wallet signing. No backend, indexer, private credentials or external font assets.

## Install, build and preview

Use Node 22.12+ (validated with Node 24.9.0 and npm 11.6.0):

```sh
cd web
npm ci
npm run typecheck
npm run build
npm run preview
```

`npm run dev` first builds the deployment assets and then runs Vite. `npm run build` writes `../dist/`, verifies both implementation-derived ABI exports against their pinned Git blobs and canonical Keccak hashes, and writes `dist/imd-deployment.json` **after** all exported files. The manifest inventories every other export with a lowercase SHA-256. Do not edit exported files by hand; rebuild after a source/configuration change. The build requires the handoff's source commit to be present in local Git history.

Publish the complete `dist/` directory as static files. Vite uses `base: './'`; the app has one page and anchor disclosures, with no server routing requirement. HTTP hosting is required (opening `index.html` using `file://` does not support configuration fetching). The export was exercised under `/preview/`, including real RPC reads. Publication, DNS/ENS naming and IPFS pinning are the publisher's work.

## Configuration and provenance

- `deployment/handoff.json` is the supplied deployment handoff, preserved unchanged.
- `deployment/network.json` is the supplied network table and exact wallet-add-chain parameters, preserved unchanged.
- `../docs/abi/{LaunchToken,HarbergerBillboard}.json` are the existing raw ABI arrays. `scripts/export.mjs` checks their bytes against `git show <sourceCommit>:docs/abi/<Contract>.json` before copying them into `dist/abi/`. Canonical ABI hashing recursively sorts object keys, preserves array order, serializes without whitespace and applies Keccak-256 to the UTF-8 bytes.
- The browser fetches **only** the generated `imd-deployment.json` for its deployment configuration and then loads the ABI paths in that manifest. `src/config.ts` contains readers and types, not another deployment address map. The manifest includes the unmodified network object and exact `walletAddChain` extension.
- Public RPCs are tried in supplied order, with a connected wallet provider as the final read fallback only when it is on the expected chain. Wallet signing always uses the visitor's injected provider.
- Startup verifies ABI hashes. Each state refresh verifies RPC chain ID, nonempty code for both contracts and `HarbergerBillboard.token()` against the attested token. All token reads use that returned address; approvals sign against the verified returned address. Every snapshot is read at one block number.

The source commit, launch ID, chain ID, contract addresses and ABI hashes remain those in the handoff. No contract source, deployment, root build settings or existing ABI file was changed.

## Wallet and payment behavior

Use an injected EIP-1193 browser wallet (or a wallet's embedded browser). No WalletConnect project ID was supplied; no WalletConnect dependency or credential is necessary. Select the intended wallet/account in the browser extension when multiple providers are installed. Account, chain and disconnect events invalidate previous account state. An unknown chain triggers `wallet_addEthereumChain` only after switching fails with 4902 or an unknown-chain message, followed by another switch.

The page reads the billboard without connecting. After connection it also shows BILL balance, allowance for the billboard, and withdrawable sale proceeds. Reads refresh every 20 seconds; a snapshot older than 45 seconds disables signing. Exact token values are available in the contract-details disclosure; summaries truncate to four decimal places and mark tiny nonzero values as `<0.0001`. Input parsing uses token decimals and bigint; excess precision, invalid/negative/zero payments and uint256 overflow are rejected.

The primary application controls are `buy`, `setPrice`, `setMessage`, `addDeposit`, `withdrawDeposit`, `withdraw` and `settle`. Holder controls are disclosed under “Manage your billboard”; public settlement is under “Live state & contract details.”

Buying has separate **Approve BILL** and **Buy billboard** controls. Approval is limited to the chosen maximum purchase price plus deposit; the actual purchase transfers the current price plus deposit. Existing sufficient allowance is shown as “BILL approved.” A changed form is checked against the allowance again. The maximum is never silently raised. Adding a deposit also requires its separate BILL approval. Approvals go to the application contract, not Uniswap or Permit2: the approved workflow explicitly excludes an in-page swap. The page explains that BILL comes from swapping Sepolia ETH in the launch's Uniswap v4 pool outside this page. The vetted Uniswap addresses remain intact in the runtime network configuration.

Every mutation refreshes and validates current state, checks wallet account/chain, simulates the exact call, checks the wallet again, and then asks it to sign. Holder eligibility, post-tax withdrawal bounds, balance and allowance are checked before signing. A pending operation locks other actions. Status text persists through wallet review, submission, receipt confirmation/revert and errors, with a transaction explorer link. Replacement/cancellation changes the reported outcome. Receipt timeouts retain the submitted hash: check the explorer before retrying.

## Economics and limitations

The holder sets a price from 1 to 1,000,000,000 BILL. Anyone else may buy at that price. Tax accrues per second, rounds up and is burned by transfer to the dead address; it is 10% of the asking price per 365 days. Every action settles first. If tax exhausts the deposit, settlement clears the billboard and a new purchase costs only its deposit. Withdrawing the whole deposit permits foreclosure at the next settlement. Runway is an estimate from the last observed block, not a guarantee of transaction ordering. Another transaction or elapsed tax can still make a simulated transaction revert; the contract enforces the final result.

The app trusts configured public RPC responses for live state. Nonempty code checks are not an independent runtime-bytecode audit. The manifest's ABI hashes bind its ABI files, while the external publication verifier binds the manifest to the attestation. Mocked interaction checks do not prove a real wallet/funded transaction works end to end. No transaction was broadcast for validation.

## Validation

```sh
cd web
npm run typecheck
npm run build
npm test
npm run verify
node scripts/live-read.mjs
node scripts/browser-live.mjs
```

The browser scripts manage a temporary HTTP server and Chromium within their own foreground process, then close both. They default to this worker's installed headless Chromium executable. Elsewhere, install a compatible Playwright Chromium and set `BILLBOARD_CHROMIUM` to its executable. For example, use `PLAYWRIGHT_BROWSERS_PATH=/tmp/billboard-browsers npx playwright install chromium`, then point `BILLBOARD_CHROMIUM` at the installed executable. This requires no vendored npm registry or browser binary in Git.

`npm test` runs the actual production export with mock HTTP RPCs and an injected mock provider. It verifies transaction calldata, approval ordering, all application mutations, chain addition, account changes, error handling, a tampered ABI, responsive overflow, keyboard approval/buy, axe checks and computed contrast. `live-read.mjs` only reads real public RPC state. `browser-live.mjs` visits the actual app using public RPCs without mocks or a wallet. Results and screenshots are under `../docs/evidence/`; see `../docs/VALIDATION.md` for coverage and limitations and `../docs/DESIGN.md` for the implemented design.

## Submission scope and size

The only ignore-file budget is the explicitly allowed `web/.gitignore` (one path). Its unanchored directory patterns keep dependencies and caches ignored at all depths under `web/`; generated crash dumps and test reports are also excluded. Package manifests and lockfiles stay under `web/`. No dependencies, caches, mirrors, package archives or submodules are delivered. The scope forbids repository-root `DESIGN.md`, so its requested content is delivered at `docs/DESIGN.md`.
