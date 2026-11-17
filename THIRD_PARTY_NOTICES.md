# Third-party notices

nexy-web is MIT licensed (see [LICENSE](LICENSE)). It ships the following third-party
components, under their own licences.

## Fonts (`public/fonts`)

Licensed under the SIL Open Font License 1.1. The licence text and copyright notices are in
[public/fonts/OFL.txt](public/fonts/OFL.txt).

| File | Font | Licence | Source |
|---|---|---|---|
| `geist.woff2` | Geist | OFL-1.1 | https://github.com/vercel/geist-font |
| `jetbrains-mono.woff2` | JetBrains Mono | OFL-1.1 | https://github.com/JetBrains/JetBrainsMono |
| `antonio.woff2` | Antonio | OFL-1.1 | https://github.com/googlefonts/antonioFont |

## noVNC 1.5.0 (`@novnc/novnc`)

Bundled, unmodified, into the browser code for the screen viewer.

- Licence: MPL-2.0, https://www.mozilla.org/MPL/2.0/
- Source: https://github.com/novnc/noVNC/tree/v1.5.0
- Copyright (C) 2022 The noVNC Authors

noVNC includes files under other MPL-compatible licences, listed in its `LICENSE.txt`:

- `vendor/pako`: MIT, Copyright (C) 2014-2017 by Vitaly Puzrin and Andrei Tuputcyn
- `core/des.js`: BSD-style licences, as stated in the file's header

## Server dependencies

`astro` and `@astrojs/node` are bundled into the server build. Both are MIT licensed
(https://github.com/withastro/astro); their own dependencies are under MIT, ISC, BSD or
Apache-2.0 licences, listed in `package-lock.json`.

Not shipped: `sharp` (Apache-2.0, with LGPL-3.0 libvips binaries) is loaded only if it is
installed beside the server, and `lightningcss` (MPL-2.0) runs at build time only.
