# Design System Strategy: The Sovereign Ledger

## 1. Overview & Creative North Star
This design system is built upon the Creative North Star of **"Atmospheric Intelligence."** In an era of cluttered fintech interfaces, we move beyond the "template" look by treating financial data as a high-end editorial experience. 

The goal is to evoke the feeling of a private wealth management firm—authoritative, quiet, and incredibly precise. We achieve this through **Intentional Asymmetry**: hero sections may be weighted to the left with expansive white space on the right, and data visualizations are treated as primary art pieces rather than secondary widgets. We replace the rigid, boxed-in grid of traditional finance apps with layered surfaces and breath, creating a digital environment that feels as secure as a vault but as fluid as a modern AI.

---

## 2. Colors: Tonal Architecture
The palette is rooted in deep, professional blues and sharp blacks, contrasted with a high-growth "Sovereign Green."

*   **Primary (#000000) & Primary Container (#131b2e):** These represent the core of the brand—stark, authoritative, and unshakeable.
*   **The Growth Signal:** Use `tertiary_fixed` (#6ffbbe) and `on_tertiary_container` (#009668) exclusively for positive financial movement and growth indicators.
*   **The "No-Line" Rule:** To maintain a premium feel, **1px solid borders are prohibited** for sectioning content. Boundaries must be defined through background color shifts. For example, a `surface_container_low` (#eff4ff) section should sit on a `background` (#f8f9ff) to create a soft, edge-less transition.
*   **Surface Hierarchy & Nesting:** Treat the UI as a series of physical layers. Use `surface_container_lowest` (#ffffff) for the highest-priority cards (like a primary balance) and `surface_container_highest` (#d3e4fe) for utility-based background elements.
*   **Signature Textures:** For main CTAs and hero backgrounds, use a subtle linear gradient transitioning from `primary` (#000000) to `primary_container` (#131b2e) at a 135-degree angle. This adds a "silk" sheen that flat colors cannot replicate.

---

## 3. Typography: Editorial Utility
The system pairs the technical precision of **Inter** with the editorial character of **Manrope**.

*   **The Authority (Manrope):** All `display` and `headline` tokens utilize Manrope. Its geometric yet warm curves provide a "modern boutique" feel. Use `display-lg` (3.5rem) sparingly to highlight singular, impactful numbers (e.g., Net Worth).
*   **The Utility (Inter):** All `title`, `body`, and `label` tokens utilize Inter. It is the workhorse of the system, ensuring that small-scale financial data remains legible at a glance.
*   **Data Scanning:** Always use `on_surface_variant` (#45464d) for secondary labels to create a clear hierarchy against the `on_surface` (#0b1c30) primary data points.

---

## 4. Elevation & Depth: Tonal Layering
We reject the use of heavy shadows in favor of a more sophisticated "Tonal Layering" principle.

*   **The Layering Principle:** Depth is achieved by stacking. A `surface_container_lowest` card placed on a `surface_container_low` background creates an organic lift.
*   **Ambient Shadows:** For floating elements (like Modals), use a highly diffused shadow: `box-shadow: 0 20px 40px rgba(11, 28, 48, 0.06)`. The tint is derived from `on_surface`, ensuring the shadow feels like a natural obstruction of light rather than a gray smudge.
*   **The "Ghost Border" Fallback:** If a container requires further definition for accessibility, use a "Ghost Border": the `outline_variant` token (#c6c6cd) at 15% opacity. 
*   **Glassmorphism:** For top navigation bars or floating action buttons, use a backdrop-blur (20px) combined with a semi-transparent `surface_bright` (#f8f9ff) at 80% opacity. This allows the data to flow "underneath" the UI, maintaining the sense of an infinite, data-rich environment.

---

## 5. Components: Precision Primitives

### Buttons
*   **Primary:** A stark `primary` (#000000) background with `on_primary` (#ffffff) text. Use the `xl` (0.75rem) roundedness for a modern, approachable feel.
*   **Secondary:** Utilize the `secondary_container` (#d5e3fd) with `on_secondary_container` (#57657b). This provides a lower-contrast option that still feels premium.

### Data Visualizations (Line Graphs & Progress)
*   **Growth Lines:** Use a 3px stroke of `tertiary_fixed_dim` (#4edea3) with a subtle glow (drop shadow) of the same color at 20% opacity. 
*   **Progress Bars:** The track should be `surface_container_high` (#dce9ff) with the indicator using the `tertiary_fixed` (#6ffbbe) gradient. Use `full` (9999px) roundedness for bars to contrast with the `xl` corners of cards.

### Cards & Lists
*   **Card Containers:** Use `surface_container_lowest` (#ffffff) with `xl` (0.75rem) corners.
*   **No Dividers:** Forbid the use of line dividers between list items. Use 16px or 24px of vertical whitespace (from the spacing scale) and subtle shifts to `surface_container_low` on hover to separate content.

### Input Fields
*   **State:** The default state is a "Ghost" style—no fill, only a `outline_variant` at 20%. Upon focus, transition to a `surface_container_lowest` fill with a `primary` (#000000) 1.5px bottom-border only. This mimics high-end stationery.

---

## 6. Do's and Don'ts

### Do:
*   **Do** use extreme typographic contrast. A `display-md` headline next to a `label-sm` secondary tag creates an editorial feel.
*   **Do** embrace negative space. If a screen feels "busy," increase the padding to 32px or 40px rather than adding borders.
*   **Do** use `on_tertiary_container` (#009668) for all success states to maintain the "Growth" brand pillar.

### Don't:
*   **Don't** use pure gray shadows. Always tint shadows with the `on_surface` blue-black to maintain tonal harmony.
*   **Don't** use 100% opaque borders for containers. It breaks the "Atmospheric" feel and makes the app look like a standard template.
*   **Don't** use `error` (#ba1a1a) for anything other than critical alerts. Financial apps should remain calm; use `secondary` tones for neutral warnings.