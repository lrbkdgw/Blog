# Magic UI adaptations

Source: https://github.com/magicuidesign/magicui
Upstream revision: `85f97fd27b053339af74ba9dd4ca428ee25989fb`.
Source files: `apps/www/registry/magicui/{aurora-text,magic-card,border-beam}.tsx`.
License: MIT, reproduced in LICENSE.md.

These are local, deliberately reduced adaptations of the open-source components,
not the Magic UI Pro package. AuroraText retains accessible duplicate text and animated
gradients; MagicCard retains pointer-relative radial highlights; BorderBeam retains
masked borders and offset-path motion. Tailwind 4 classes, next-themes and Motion
were replaced with Tailwind 3-compatible CSS, the existing theme provider and
requestAnimationFrame. No new runtime dependency is required.

Effects respect the site effect setting and prefers-reduced-motion. CSS lives in
src/styles/appearance.css and is scoped to the web site, not the VS Code preview.
