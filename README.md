# Back to the Future project page

Project page for *Back to the Future: Predicting Long-Horizon Dynamics with Retrospective Correction for Disturbance-Aware Retrieval* (anonymous submission).

Live site: https://the-back-to-the-future.github.io/

## Layout

- `index.html`: the page content only, one `<section>` per paper section; behaviour is attached through `data-` attributes.
- `assets/css/site.css`: every style; colours are tokens on `:root`, breakpoints at 1068 px and 734 px.
- `assets/js/site.js`: page behaviour, one init function per feature (continuous corners, hero video chapters, highlight strip, method steps, BibTeX copy), loaded with `defer`.
- Rounded corners: every element the stylesheet rounds is redrawn by `site.js` with Apple's continuous corner curve (clip path plus a stroked edge coloured by the component's `--edge` token); the CSS `border-radius` is the fallback without JavaScript.
- `assets/media/`: videos, posters and figures, named by content and size (for example `hero-947-3840.mp4`).

Served by GitHub Pages from the root of `main`; no build step.
