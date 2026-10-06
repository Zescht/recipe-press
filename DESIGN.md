# Recipe Press — Edition II

## Visual thesis

Recipe Press is an **editorial kitchen archive**: part art-book folio, part precise working instrument. A photographic left rail gives every batch a cover; the right side stays flat, typographic, and functional. The interface should feel authored rather than decorated.

The redesign changes the composition, not merely the palette:

- desktop uses a full-height photographic folio rail beside the working surface;
- progress sits on the folio like a printed contents strip;
- mobile compresses the folio into a masthead without hiding the first action;
- thin rules, hard edges, and negative space replace floating cards and soft shadows;
- acid citrus is the only expressive UI accent.

## Research sources

Primary references:

- Godly — mmmmenu, a food-and-drink product with a strongly authored composition: https://godly.design/website/mmmmenu/
- Refero Styles — Visual, for high-contrast editorial serif, mono marginalia, flat structure, and one highlighter accent: https://styles.refero.design/style/d2c0ed7b-c649-4d77-91de-1bd69dd10a9e
- Refero Styles — Rox, for the broadsheet/product-UI contrast and dense hairline information structure: https://styles.refero.design/style/66eb1c37-a8e5-4e6c-b17f-a75385b462e7

Secondary comparison:

- Refero Styles — Garden Eight, for image-led scale and a limited chromatic language: https://styles.refero.design/style/e4593570-e43f-4eda-8618-0bb704d5ebb7

The project adapts principles only. It does not copy reference screenshots, assets, branding, or trade dress. Mobbin remains access-limited without an account, so no unseen flow details are attributed to it; the actual workflow comes from the user-approved prototypes.

## Tokens

- Carbon ink: `#151613`
- Soft ink: `#2b2c27`
- Archive paper: `#efeee7`
- Bright paper: `#faf9f4`
- Hairline: `#b9b9ae`
- Secondary copy: `#696a61`
- Citrus signal: `#dfff55`
- Citrus pressed: `#c7ea3e`
- Destructive: `#d43d42`

## Typography

- Display: Iowan Old Style / Palatino Linotype / Book Antiqua / Georgia
- UI: Inter / Helvetica Neue / Arial
- Marginalia: IBM Plex Mono / Cascadia Mono / Consolas
- Display text uses regular weight, tight tracking, and dramatic scale.
- UI text remains at least 16px for prose and 14px for regularly used controls.

## Shape and depth

- Working surfaces are flat and edge-to-edge.
- Inputs, buttons, cards, and selectors use hard 0px corners.
- The single exception is circular image-navigation controls.
- Structure comes from one-pixel rules, scale, and contrast—not shadows.
- The destructive dialog uses one intentional offset citrus shadow.

## Interaction

- Citrus marks the current step, selected values, and the primary action.
- A state change enters with a short opacity/vertical transition.
- The folio photograph receives one slow reveal; it does not continuously animate.
- Reduced-motion preferences collapse all movement.
- Destructive actions preserve confirmation and Undo.

## Responsive behavior

- Above 900px: folio rail and workspace form a two-column application shell.
- At 900px and below: the folio becomes a compact image masthead; workflow returns to a four-part strip.
- Below 420px: nonessential folio metadata disappears, but the cover identity remains.
- Touch targets remain at least 44px and the page must not scroll horizontally.
