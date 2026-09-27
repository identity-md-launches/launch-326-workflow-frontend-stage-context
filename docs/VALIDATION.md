# Frontend validation

Validated on 2026-09-27 against the production export in `dist/`. This is worker evidence, not independent certification. No transaction, deployment, publication, site naming or IPFS pinning was performed.

## Scope and consequential choices

- One Vite/React/TypeScript page for the supplied HarbergerBillboard + BILL deployment. All seven application mutations have controls; paying actions have separate ERC-20 approval steps. The approved workflow explicitly says **no in-page swap**. Swap/quote/router/Permit2 actions therefore do not exist. BILL acquisition is explained on the page; the vetted network object is preserved without alteration.
- Addresses, chain and ABI paths come from the same `dist/imd-deployment.json` that publication will inspect. The browser fetches the referenced ABI arrays. There is no independent deployment map in the UI code.
- Read-only chain verification checked the expected chain, nonempty deployed code and `token()` binding. Inputs were the supplied workflow, deployment, network, both protected test files and the six-domain Better Interface reference. The existing Solidity source and exported ABIs were also read. No protected source or configuration was changed.
- Write scope takes precedence over the contradictory root `DESIGN.md` criterion. The complete design documentation is `docs/DESIGN.md`. The only new ignore file is the explicitly budgeted `web/.gitignore`; its dependency/cache patterns apply at every depth below `web/`.
- No WalletConnect ID was provided. The supported connector is the browser's injected EIP-1193 provider, with wallet instructions for missing-provider users.

## Commands and results

All commands below run from `web/` unless otherwise noted.

| Check | Result |
| --- | --- |
| `npm install --cache /tmp/billboard-npm-cache --no-audit --no-fund` | Passed; exact versions and npm lockfile delivered under `web/` |
| `npm run typecheck` | Passed after the final application-source edits |
| `npm run build` | Passed after the final application-source edits; Vite relative base, local assets, no source maps |
| `npm test` | Passed: 6/6 Node tests (one production-export suite and five scenario groups), no skipped tests |
| `npm run verify` | Passed: six assets, 508,788 bytes including manifest, exact handoff/network/ABI binding, all SHA-256 hashes match |
| `node scripts/live-read.mjs` | Passed against all three supplied public RPCs; chain 11155111, nonempty BILL and billboard code, matching `token()`, empty live billboard state |
| `node scripts/browser-live.mjs` | Passed real public-RPC browser reads under `/preview/`; no mocks/wallet/signing; no page/console errors or failed requests |
| `git diff --check` | Passed; existing tracked source files remain unchanged |
| Candidate-file path/size audit | Passed: all additions inside `web/`, `dist/` or `docs/`; no submodules, caches, dependencies, mirrors or package archives in the candidate set |
| `git add -- web dist docs` | **Blocked by environment**: `.git/index.lock` could not be created because `.git` is mounted read-only |

The source, lockfile, export and evidence are present for worker collection. A Git commit cannot be created in this worker. A writable Git context or the contributor publisher must stage/commit them. The complete candidate snapshot was approximately 5.4 MB **uncompressed**, already below the 8 MiB submission limit; `docs/evidence/submission-size.json` records the final inventory. No claim is made that a Git bundle was generated when Git writes are unavailable.

## Browser and interaction evidence

The assigned browser connector failed before navigation because it expected a missing executable at `/home/seat/.cache/ms-playwright/chromium-1246/chrome-linux64/chrome`. The existing Chromium headless shell at `/opt/ms-playwright/chromium_headless_shell-1246/chrome-headless-shell-linux64/chrome-headless-shell` worked through the installed Playwright library (Chromium 154.0.8037.0). Tests manage their own HTTP server and browser in one bounded foreground process and close both. A crash dump from the unsuccessful full-Chromium launch was removed; it is not part of the submission.

`web/tests/browser.test.mjs` serves the actual export at `/preview/`, intercepts the configured RPC URLs, and supplies an injected mock wallet. Assertions cover:

- Disconnected and missing-wallet states; blocked signing before verification/connection.
- Wrong chain; switch failure 4902, exact supplied `wallet_addEthereumChain` parameters, and a subsequent switch.
- Keyboard navigation to the message, approval and purchase; approval token/spender/amount calldata; separate approve and pay; self-buy prevention.
- All application writes: buy, setMessage, setPrice, addDeposit, withdrawDeposit, withdraw and settle; approval before deposit top-up; receipt-driven state refresh.
- Connected balance, allowance and withdrawable balance; account/chain/disconnect events and holder eligibility.
- Zero amounts, 32-byte UTF-8 limit, insufficient funds, price increase before payment, specific decoded simulation revert without signing, post-tax deposit-withdrawal bounds.
- Wallet rejection on connection and approval, all RPCs unavailable, missing deployed code, tampered ABI and reverted receipt. A reverted receipt retains the explorer link and does not claim confirmation.
- Exhausted deposit state projects zero purchase cost; holder controls are unavailable after foreclosure eligibility.
- Axe scans on disconnected mobile and connected-holder desktop with all disclosures open: **zero violations** in both tested states.
- No page/console errors or failed static resources during the mocked interactions.

`docs/evidence/browser-results.json` is the machine-readable record. Its mock outcomes validate UI/RPC integration, not the actual contract economics. Solidity accounting, reentrancy and time accrual were not re-audited or retested by this frontend task.

Rendered widths checked: 1440, 820, 768, 390 and 320 CSS pixels, height 1000, no horizontal overflow. The live-RPC browser check additionally rendered at 1440 and 390, loading block 11,791,517 with the billboard empty. The direct RPC check read block 11,791,495 on all three RPCs; bytecode lengths were 1,802 bytes for LaunchToken and 3,874 for HarbergerBillboard. These are point-in-time observations, not ongoing availability guarantees.

Screenshots inspected from the rendered export:

- `evidence/live-1440.png`, `evidence/live-390.png`: actual public-RPC empty state, desktop/mobile.
- `evidence/disconnected-1440.png`, `evidence/disconnected-390.png`, `evidence/disconnected-320.png`: mocked empty state and recoverable missing-wallet notice.
- `evidence/holder-desktop.png`: mocked active holder with advanced controls exposed.
- `evidence/keyboard-focus.png`, `evidence/approval-focus.png`: skip-link and approval focus states. The approval screenshot shows the visible green outline on the light form surface.

## Better Interface consolidated review

All six core domains were read and applied during implementation. Coverage below refers to the final source/export.

| Domain | Coverage | Evidence and limits |
| --- | --- | --- |
| Accessibility | Checked | Native controls and disclosure semantics, one main/H1, skip link, labels/hints/errors, live status, keyboard approval/buy, focus screenshot, two axe scans. No real screen-reader session, physical touch device or full focus-background matrix. |
| Layout | Checked | Source grid/spacing/logical-property review, screenshots, five viewport widths, all disclosures, overflow checks. 200% root text enlargement and RTL overflow stress at 820 passed. Native browser 200% zoom was not performed; no translated locale is claimed. |
| Writing | Checked | Action names match functions, BILL units consistent, public-message/approval/tax/foreclosure consequences described, rejection and RPC recovery text, no backend or swap claims. Decoded revert reasons now give an actionable next step. |
| Typography | Checked | System sans/serif hierarchy, 16px inputs, tabular amounts/countdown, message/address wrapping, mobile screenshots and text-resize check. Exact font rasterization across platforms and non-English font stacks not verified. |
| Colors | Checked | Semantic sRGB tokens, actual computed foreground/background pairs and automated contrast checks. Muted/page 5.46:1; muted/white 6.01:1; main/white 15.15:1; board text 13.76:1; board captions 8.62:1. No dark theme; forced-colors CSS reviewed but no dedicated visual forced-colors run. |
| UI | Checked | Empty/loading/error/active/disabled states; payment/holder controls; native disclosure affordances; persistent transaction status; hover/press rules and reduced-motion computed transition of 0s. No overlays, image assets or staged animations; 10%-speed animation-panel replay is not applicable. |

### Findings, fixes and rechecks

| Severity / source | Reproduction and impact | Fix and evidence |
| --- | --- | --- |
| Medium — `web/src/forms.tsx:36` | A disconnected wallet's default zero balance produced an “insufficient BILL” warning even though no account had been read. | Insufficient-balance evaluation now requires a snapshot account. Final disconnected screenshot has no false warning; connected insufficient-funds test still passes. |
| High — `web/src/forms.tsx:120` | Axe reported `definition-list`: captions were non-definition children within a `dl` group, weakening the semantic association of state values. | Captions now live inside the `dd`. Both final axe scans report zero violations. |
| Medium — `web/src/model.ts:69` | Simulation failure initially displayed only “buy reverted,” hiding the decoded contract reason and recovery action. | Walk viem's revert error and map known ABI errors to specific explanations. Mock PriceAboveMax simulation now displays the maximum-price reason and never calls wallet signing. |
| Medium — `web/src/useBillboard.ts:129` | Source review found a successful cancellation/replacement receipt could be described as the original action's confirmation. | Replacement callback marks non-repricing replacements and reports cancellation/replacement with the updated hash. Receipt-revert path is browser-tested; actual replacement/cancellation detection and timeout are source-reviewed, not executed. |

Test-harness repairs (Playwright context creation, abbreviated-address selector and duplicate hidden-control selector) were made before the final passing run. They are not product findings. No known blocking product defect remains from the performed checks.

## Remaining limits and completion

Implementation, static-export integrity, typecheck, production build, rendered browser review and required mocked interactions are complete. Git staging/commit is blocked only by the read-only Git metadata noted above. No out-of-scope workaround was attempted.

Untested live behavior: real browser-wallet extension signing, gas estimation UX, funded BILL approvals/payments, actual swaps, transaction inclusion/reorgs, real replacement/cancellation and receipt timeout. Wallet-provider read fallback exists but a successful real wallet fallback was not exercised. Browser testing used Chromium only; Safari, Firefox, physical mobile devices, real screen readers and native zoom remain unverified. Publication/CID/ENS checks are subsequent control-plane work and were not claimed as evidence here.
