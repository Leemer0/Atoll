#!/bin/bash
# Concatenate src/ into the single page that gets published.
cd "$(dirname "$0")"
{ cat src/00-head.html; echo '<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>'; echo '<script>'; echo '(() => {'; echo "'use strict';"; cat src/01-core.js src/02-sim.js src/03-net.js src/04-render.js src/05-ui.js; echo '})();'; echo '</script>'; } > index.html
wc -c index.html
