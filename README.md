# Snowpack Viewer

A web viewer for SNOWPACK `.pro` files. Explore a snowpack timeline, inspect individual profiles, and export figures directly in your browser. Local files are read entirely on your computer.

Source and issue tracking: [chriscmorin/snowpack-viewer](https://github.com/chriscmorin/snowpack-viewer) · [Issues](https://github.com/chriscmorin/snowpack-viewer/issues).

A hosted demo is available at [winterscience.com/snowpack-viewer](https://winterscience.com/snowpack-viewer). Hosting is separate from this repository; any group can build and host the same viewer.

## Use

Open the downloadable `snowpack-viewer.html` in a browser, then choose or drag in a `.pro` or `.pro.gz` file. Compressed files open automatically. This standalone version works offline and needs no installation.

The hosted demo uses the same viewer and adds **Open example**, which loads the full season from the demo website. **Download example data** saves the sample file, and **Download offline viewer** saves the standalone app. No GitHub account is needed.

To build the HTML from source, install Node.js 22 or newer and run:

```sh
npm ci
npm run build
```

The viewer is written to `dist/snowpack-viewer.html`. Node.js is needed for development and building only.

## Host the demo

The full-season example is distributed separately from the source repository. Import its `.pro` or `.pro.gz` file, then build the demo:

```sh
npm run example:import -- --file /path/to/snowpack-large-MST96.pro.gz
npm run build:demo
```

The importer verifies the pinned SHA-256 and stores the data in ignored `.cache/examples/`. It also accepts `--url` with an explicit HTTPS download URL. To obtain the example file, use **Download example data** on the [hosted demo](https://winterscience.com/snowpack-viewer). The normal offline and npm builds do not need this dataset.

Serve the resulting `dist/demo/` over HTTPS using any static website host. It contains the demo page, compressed example data, and the downloadable offline viewer. The demo loads its example from the same website, so it does not rely on cross-site access to GitHub release attachments.

Example data are downloaded only when requested. The offline viewer has no dependency on the demo website.

To link a hosted build to its matching source version, set `SPV_SOURCE_URL` to the HTTPS URL of that version before building. Without an override, **Source & license** links to the repository. Publish the referenced source version before sharing the hosted build.

## Features and scope

- Timeline views for snow temperature, grain shape, grain size, snow density, liquid water content, sphericity, and dendricity.
- Linked profiles with grain-colored hardness layers, property curves, stability markers, and layer details.
- Soil visibility, hover preview, pinned selection, timestep navigation, timeline zoom, and independent profile zoom.
- PNG export for both views and printing for the timeline.

This is a working reimplementation of niViz's `.pro` timeline and profile workflow. It preserves the scientific classifications and axis conventions for that workflow, with its own interface and vector grain symbols. It currently covers a subset of niViz: other file formats, profile editing, time-series addition/extraction, a snow-height dialog, maximize, and SVG/JSON export are not implemented.

## Embed in another application

The same parser and viewer are available as an ES module with TypeScript declarations and CSS. Create the npm package with `npm run build && npm pack`, then install the resulting tarball in a browser project:

```sh
npm install /path/to/snowpack-pro-viewer-0.1.0.tgz
```

```ts
import { parsePro, createViewer } from 'snowpack-pro-viewer';
import 'snowpack-pro-viewer/style.css';

const input = document.querySelector<HTMLInputElement>('#pro-file')!;
const host = document.querySelector<HTMLElement>('#viewer')!;
let viewer: ReturnType<typeof createViewer> | undefined;

input.addEventListener('change', async () => {
  const file = input.files?.[0];
  if (!file) return;
  const station = parsePro(await file.text());
  if (viewer) viewer.update(station, { sourceName: file.name });
  else viewer = createViewer(host, station, { sourceName: file.name });
});
```

Use an `<input id="pro-file" type="file" accept=".pro">` and a `<div id="viewer"></div>`. Call `viewer.destroy()` when unmounting. Multiple viewer instances are supported. The npm package is currently distributed locally as a tarball.

## Development

The TypeScript source separates parsing and scientific rules (`src/core`), Canvas/SVG rendering (`src/render`), and standalone file controls (`src/app`). The public API is `src/index.ts`.

Run `npm run check` for type checking, a production build, and automated tests. Install the test browsers with `npx playwright install chromium firefox webkit`. Select an engine with `SPV_BROWSER=chromium`, `SPV_BROWSER=firefox`, or `SPV_BROWSER=webkit`; Chromium is the default, and `SPV_BROWSER_PATH` can select an installed Chromium-compatible executable. `npm run dev` rebuilds the offline HTML when source files change.

After importing the full-season data, run `SPV_FULL_SEASON=1 npm run check` to also build the demo and test the full season. Ordinary checks use the small fixtures included in the repository. Missing browser installations or explicitly requested full-season data fail with instructions instead of silently skipping checks.

Tests cover three bundled legacy `.pro` fixtures, the optional full-season fixture, and synthetic PRO 1.4 data. Automated checks exercise current Chromium, Firefox, and Playwright WebKit, including local HTML, gzip loading, navigation, PNG export, and npm embedding. Safari 18.6 also passed a manual check of local file selection, full-season gzip loading, navigation, and license access with the viewer served on localhost. This is not exhaustive Safari or mobile-device coverage. Real PRO 1.4 files and pixel-level visual equivalence across browsers have not been verified. Symbol contours and formatting can differ from niViz.

## Build release files

With Node.js 22+ and Python 3 installed, `npm run release:local` checks the project and prepares release files under `dist/release/`: the standalone HTML, npm tarball, current source archive, and SHA-256 checksums. If the verified full-season cache is present, it also includes the demo ZIP and separate compressed example data. Use `SPV_FULL_SEASON=1 npm run release:local` to require the season data and run the full-season checks. The source archive excludes Git history, caches, generated files, and the full-season dataset.

GitHub Actions runs build and browser checks and collects build artifacts. It does not deploy the demo, create GitHub releases, or publish to npm. When distributing compiled files, provide the matching source archive alongside them. The npm package remains private pending a separate publishing decision.

## License and attribution

Licensed under [AGPL-3.0-or-later](LICENSE). Scientific behavior is based on niViz; SNOWPACK and IACS provide the data-format and grain-classification references. See [NOTICE](NOTICE) and [upstream attribution](docs/upstream.md) for source identities, example-data provenance, and licenses.

You can use, modify, and redistribute the viewer under these terms, including commercially. Distribution of modified versions and covered network use carry source-sharing obligations; see the license for the full requirements. Opening a private snow profile does not require publishing that data. Example datasets have separate provenance and are not relicensed by the viewer's license.
