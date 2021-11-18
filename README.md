# stella_sync

Analyze astro image(s) and sync up stellarium's view.

install
---

- install https://stellarium.org/
- install https://astrometry.net/use.html (`brew install astrometry-net` + download index files)
- `npm install`

usage
---
```
usage: stella_sync.mjs --img <img to analyze>
       stella_sync.mjs --dir <dir to watch>
```

stella_sync will analyze an astro image (a `.fit`, `.png` or `.jpg`) using your local astrometry.net install. It will then send the result back to stellarium and sync the oreveall focus and properly rotate the sensor view to show you exactly where your pictur was taken.
