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
stella_sync.js --img <img to analyze> [options]
stella_sync.js --dir <dir to watch> [options]
stella_sync.js --port <port> [options]

options:
  --radius: search radius in degrees, default 15
  --fov: fov of the camera in degrees, default 1
  --astap | astro: use astap or astronomy.net for platesolving, default astap
  --server: an optional server url
```

standalone mode
---
Here, you have stellarium, astrometry.net and sharpcap running on the same machine.

Run: `stella_sync.js --dir <sharpcap image dir>`

When you save an image in sharpcap, the server will query stellarium to get a rough idea of where you are pointing, then analyze the sharcap image, platesolve and then redirect stellarium to show the exact position + orientation of your image (when showing the image sensor for the current camera)

client/server mode
---
Here, 2 machines are involved:


**The server**  _(the machine doing the platesolving, usually the mac running atrometry.net)_
- run `./stella_sync.js --port 9010`.
- this will start the server and display the exact ip of the server. When the server recevied an image, it will try to platesolve it and send back the exact coordinates/rotation for stellarium.

**The client** _(the machine which takes the pictures and runs stellarium, usually the pc running sharpcap)_
- run `./stella_sync.js --dir <sharpcap img dir> --server <the exact ip/port of the server>`
- this will monitor the shapcap dir, send the images to the server for platesolving, and then properly center/orient stellarium.


examples
---
- `./stella_sync.js --port 9000`: runs the platesolving server on port 9000
- `./stella_sync.js --dir ~/shapcap --pattern '*/test/*'`: watches sharpcap dir, but only for targets named 'test' and does the whole platesolving locally
- `./stella_sync.js --dir ~/shapcap --pattern '*/test/*' --server http://127.20.10.2:9000`: watches sharpcap dir, but only for targets named 'test' and uses a remote server for platesolving
- `./stella_sync.js --img ~/shapcap/test/m8.png`: local platesolving for one image

TODO
---
A hybrid/dual screen mode, where the server also runs stellarium and the client only runs sharpcap. 
