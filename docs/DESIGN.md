# Billboard design

## Overview

This is a single-page Sepolia application for people buying or holding a shared billboard. A cream page, dark message surface and restrained green payment action give the public message priority. Live contract state precedes the forms; explanations and advanced holder/contract controls follow the main task. The layout is editorial and flat, with no decorative imagery, external fonts or charting.

The implemented source of truth is `web/src/styles.css`, `App.tsx` and `forms.tsx`. This document is in `docs/` because the assignment's explicit write scope prohibits a root-level `DESIGN.md`.

## Colors

All colors use sRGB hex values. Primitives are declared at `web/src/styles.css:1`; components consume semantic tokens.

| Token | Value | Use |
| --- | --- | --- |
| `--bg` | `#f5f4ef` | Page and payment summary |
| `--surface` | `#ffffff` | Forms, inputs, neutral buttons |
| `--ink` | `#242720` | Main text, billboard background, connect button |
| `--muted` | `#62645b` | Secondary text and disabled controls |
| `--border` | `#a5a69b` | Input/section boundaries |
| `--subtle` | `#eaeae2` | Notices, hover and disabled surfaces |
| `--accent` / `--accent-hover` | `#d6ed9b` / `#c4e27e` | Enabled payment action |
| `--error` / `--error-bg` | `#9c2922` / `#fff0ed` | Error text, border and surface |
| `--focus` | `#345c13` | 3px keyboard outline, offset 4px (2px on inputs) |
| `--on-board` / `--board-muted` | `#f5f4ef` / `#c1c5b9` | Billboard and connect-button text |

Measured rendered WCAG contrast: muted text/page 5.46:1, muted text/white 6.01:1, main text/white 15.15:1, billboard text/dark 13.76:1, billboard captions/dark 8.62:1. These refer to tested states in `docs/evidence/browser-results.json`, not every possible state. The page deliberately supports one light theme; the dark billboard is a content surface, not a second theme.

## Typography

- Interface: `Arial, Helvetica, sans-serif`, with body 16px/1.5. OS-provided font substitution is allowed; no font download is needed. CSS requests 400/500/600/700 weights; the actual platform may synthesize intermediate weights.
- Billboard message: `Georgia, 'Times New Roman', serif`, `clamp(2.2rem, 5.4vw, 4.7rem)`, line-height 1.14, tracking −0.04em. Mobile uses `clamp(2.2rem, 8vw, 3.5rem)`. `white-space: pre-wrap`, `dir="auto"` and `overflow-wrap: anywhere` preserve and contain onchain messages.
- H1: `clamp(2.6rem, 4.8vw, 4.1rem)`/1.04, weight 500, tracking −0.06em. H2: 1.75rem/1.18, weight 500. H3: 1.05rem, weight 600. The billboard's section label is intentionally visually smaller than its message.
- Tokens: `--body: 1rem`, `--small: .875rem`, `--caption: .75rem`, `--section: 1.75rem`. Compact eyebrows/captions use .6875rem; eyebrow tracking is .12em and CSS uppercase.
- Inputs stay 1rem, including mobile. Values and countdowns use tabular numerals. Addresses use the system monospace stack; full contract addresses and exact token values remain available in the details disclosure.
- Headings balance; paragraphs use pretty wrapping and a maximum 68ch measure. No global selection suppression or text clipping.

## Layout

`.wrap` is at most 1200px, with 3rem outer margins per side at desktop. At 65rem it uses 1.5rem margins; at 34rem, 1rem. Section spacing uses .5rem, .75rem, 1rem, 1.5rem, 2rem and 3.5rem. Panel padding is 2rem, reduced to 1.5rem and then 1.25rem.

The statistics use four equal columns. The working area is a 1.25fr buy column and 1fr wallet/management column, separated by 1.5rem. Below 48rem, the working area and explainer stack, statistics become two columns, and contract details become one column. Below 34rem, paired fields and approval/payment buttons stack. Native disclosure summaries expose advanced content without adding navigation or modal state.

Observed widths: 1440, 820, 768, 390 and 320 CSS pixels, with no horizontal overflow. The real-RPC page was also inspected at 1440 and 390. A 200% root text enlargement and RTL stress test passed overflow checks at 820; these are not claims of native browser zoom or a translated RTL product. Long onchain messages and addresses wrap instead of escaping panels.

## Elevation & Depth

The interface is flat. Dark and light tonal surfaces organize content; structural borders define fields and disclosures. No drop shadows, overlays, gradients or background media are used. The only elevated navigation element is the keyboard skip link (`z-index: 5`), visible on focus.

## Shapes

Billboard and panels use 8px radii, buttons/notices 6px, inputs/payment summaries 5px, and the billboard badge 3px. The brand mark is four CSS squares with an −8° rotation. Numbered payment steps are 18px circles; buttons themselves have a minimum 46px target. Inputs have a minimum 48px height. Buttons can grow with wrapped content.

## Components

| Component/pattern | Source | Behavior |
| --- | --- | --- |
| `Field` | `web/src/forms.tsx` | Persistent label, amount unit, UTF-8 message counter, hint and field error linked by `aria-describedby`; first invalid field receives focus |
| `Payment` | `web/src/forms.tsx` | Maximum total, explicit approval and payment steps, sufficient-allowance state, account-aware balance warning |
| `BuyForm` | `web/src/forms.tsx` | Price, deposit, message, explicit maximum price; never silently updates the maximum |
| `HolderControls` / `SimpleForm` | `web/src/forms.tsx` | Native disclosure containing message/price/deposit actions; active-holder gating |
| `Stat` | `web/src/forms.tsx` | Semantic `dt`/`dd` with the caption inside the definition; numeric and wallet variants in CSS |
| Buttons | `web/src/styles.css` | Neutral outline, dark connect, green enabled payment, explicit disabled state; hover only on hover-capable devices |
| Status/errors | `web/src/App.tsx` | Persistent polite status region and urgent error alerts; explorer links survive submitted-transaction errors |
| Billboard | `web/src/App.tsx` | Loading, empty, active-message and foreclosure states; plain React text, never HTML rendering |

Native buttons, inputs, links and `details` provide keyboard behavior. The first focusable element skips to the single main landmark. Transaction prerequisites override form submission availability. Form validation focuses and describes invalid fields. There are no custom modals or focus traps.

Motion is limited to a 120ms button background/press transition and a .96 press scale, only under `prefers-reduced-motion: no-preference`. Under reduced motion there are no transitions. A forced-colors rule uses the system Highlight outline. Countdown updates are visual, not repetitive live announcements.

## Do's and Don'ts

- Start a section with `.wrap`, semantic headings and the existing spacing/grid patterns.
- Reuse semantic color tokens, `Field`, `Payment` and `Stat`; keep token amounts legible with units and exact values available.
- Keep only the currently available payment action green. Use neutral buttons for other actions.
- Preserve explicit approval, state verification, wallet review and disabled-prerequisite explanations when adding a control.
- Do not introduce addresses, ABI copies or network constants into view components, or render onchain messages as HTML.
- Do not add external fonts, icon packages, animations, themes or modal UI merely to imitate this page's visual character.

Design guidance: Jakub Krehel's Better Interface, MIT, pinned commit `267330e1adfc66a718fb65fa6918c1f06d0a689e`. Documentation method: Paul Bakaus's Impeccable, Apache-2.0, commit `9d715cc4f5564a990ca8345abfdd5df6dc9b41c8`. These sources were used as design references; their guide text is not republished here.
