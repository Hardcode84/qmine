#!/bin/bash
# Bundle Quantum Minesweeper into a single HTML file.
# Works on file:// and GitHub Pages alike.
# Requires: bun
set -euo pipefail
cd "$(dirname "$0")"

bun build app.js --bundle --outfile=.bundle.js --target=browser

bun -e "
const html = await Bun.file('index.html').text();
const js   = await Bun.file('.bundle.js').text();
const out  = html.replace(
  '<script type=\"module\" src=\"app.js\"></script>',
  '<script>' + js + '<\/script>'
);
await Bun.write('qmine.html', out);
"

rm -f .bundle.js
echo "Built: qmine.html ($(wc -c < qmine.html | tr -d ' ') bytes)"
