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
stella_sync.js --img <img to analyze> [--server <server url>]
stella_sync.js --dir <dir to watch> [--server <server url>]
stella_sync.js --port <port>
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


TODO
---
A hybrid/dual screen mode, where the server also runs stellarium and the client only runs sharpcap. 
