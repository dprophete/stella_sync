#!/usr/bin/env zx
// usage: stella_sync.mjs --img <path to img>
//        stella_sync.mjs --dir <path to dir to watch>

import "zx";
$.verbose = false;

const chokidar = require("chokidar");

const stellariumApi = "http://localhost:8090/api";
const dstDir = "/tmp/stella_sync";
const lockFile = "/tmp/stella_sync.lock";

const PI = Math.PI;
const cos = Math.cos;
const sin = Math.sin;
const asin = Math.asin;
const atan2 = Math.atan2;

const fovStella = 1;

function log(...args) {
  console.log(chalk.yellow(ppNow()), ...args);
}

function logError(...args) {
  $`afplay /System/Library/Sounds/Ping.aiff`;
  console.log(chalk.red(ppNow(), ...args));
}

//--------------------------------------------------------------------------------
// conversion
//--------------------------------------------------------------------------------

// degrees (0-360) -> radiants (0-2PI)
function degToRad(deg) {
  return (deg * PI) / 180;
}

// radiants (0-2PI) -> degrees (0-360)
function radToDeg(rad) {
  return (rad * 180) / PI;
}

// [deg, mins, secs] -> degrees
function dmsToDeg([degs, mins, secs]) {
  return degs + mins / 60 + secs / 3600;
}

// [hours, mins, secs] -> degrees
function hmsToDeg([hours, mins, secs]) {
  return ((hours + mins / 60 + secs / 3600) / 24) * 360;
}

function degToJ2000(raDeg, decDeg) {
  let α = degToRad(raDeg);
  let δ = degToRad(decDeg);
  return [cos(δ) * cos(α), cos(δ) * sin(α), sin(δ)];
}

function j2000ToDeg([x, y, z]) {
  return [radToDeg(atan2(y, x)), radToDeg(asin(z))];
}

//--------------------------------------------------------------------------------
// pp
//--------------------------------------------------------------------------------

function ppNow() {
  return "[" + new Date().toLocaleTimeString().padStart(11) + "]";
}

function ppPath(pth) {
  return pth.replace(os.homedir(), "~");
}
// pp number with 2 decimals
function pp2Dec(num) {
  return (Math.round(num * 100) / 100).toFixed(2);
}

// pp right ascension: 21h36m14.42s
function ppRa([hours, mins, secs]) {
  return `${Math.round(hours)}h${Math.round(mins)}m${pp2Dec(secs)}s`;
}
// pp declination: 57°34'28.16"
function ppDec([degs, mins, secs]) {
  return `${Math.round(degs)}°${Math.round(mins)}'${pp2Dec(secs)}"`;
}

// pp degrees: 57.57°
function ppDeg(degs) {
  return `${pp2Dec(degs)}°`;
}

// pp radians: 0.69rad
function ppRad(degs) {
  return `${pp2Dec(degs)}rad`;
}

// pp J2000: [0.50, 0.76, 0.41][j2000]
function ppJ2000([x, y, z]) {
  return `[j2000 | x:${pp2Dec(x)}, y:${pp2Dec(y)}, z:${pp2Dec(z)}]`;
}

//--------------------------------------------------------------------------------
// misc
//--------------------------------------------------------------------------------

// find where we are in stellarium
async function getRaDegStella() {
  try {
    let res = await $`curl -s ${stellariumApi}/main/view`;
    let j2000 = JSON.parse(JSON.parse(res.stdout)["j2000"]);
    let [raDeg, decDeg] = j2000ToDeg(j2000);
    log(`stellarium at: ${ppJ2000(j2000)} -> ra: ${ppDeg(raDeg)}, dec: ${ppDeg(decDeg)}`);
    return [raDeg, decDeg];
  } catch (_) {
    logError("stellarium not running or doesn't have the remote control plugin)");
    process.exit();
  }
}

async function plateSolve({ srcImg, raDegStella, decDegStella, fovStella }) {
  // copy img to tmp dst
  const baseImg = path.basename(srcImg);
  const dstImg = `${dstDir}/${baseImg}`;
  fs.removeSync(dstDir);
  fs.mkdirpSync(dstDir);
  fs.copySync(srcImg, dstImg);

  // plate solve
  let res = await $`solve-field --cpulimit 20 --ra=${raDegStella} --dec=${decDegStella} --radius=${fovStella} --no-plot ${dstImg}`;

  // extract result
  const matchRaDec = res.stdout.match(/Field center: \(RA,Dec\) = \(([-]?\d+.\d+), ([-]?\d+.\d+)\) deg./);
  if (matchRaDec == null) throw "error: couldn't solve for ra/dec";
  const raDeg = parseFloat(matchRaDec[1]);
  const decDeg = parseFloat(matchRaDec[2]);
  let j2000 = degToJ2000(raDeg, decDeg);
  log(`solved: ra: ${ppDeg(raDeg)}, dec: ${ppDeg(decDeg)} -> ${ppJ2000(j2000)}`);

  const matchAngle = res.stdout.match(/Field rotation angle: up is ([-]?\d+.\d+) degrees/);
  if (matchAngle == null) throw "error: couldn't solve for angle";
  const angle = (180 - parseFloat(matchAngle[1])) % 360;
  log(`rotation: ${ppDeg(angle)}`);

  return [angle, j2000];
}

// move stellarium
async function moveStellarium(angle, [x, y, z]) {
  await $`curl -s -d 'position=[${x}, ${y}, ${z}]' ${stellariumApi}/main/focus`;
  await $`curl -s -d "id=Oculars.selectedCCDRotationAngle&value=${angle}" ${stellariumApi}/stelproperty/set`;
}

async function processImg(srcImg) {
  log(`processing ${ppPath(srcImg)}`);
  if (fs.pathExistsSync(lockFile)) {
    logError(`lockFile ${lockFile} already exists -> abort`);
    return;
  }
  if (!fs.pathExistsSync(srcImg)) {
    logError(`image ${srcImg} not found -> abort`);
    return;
  }
  fs.ensureFileSync(lockFile);

  let [raDegStella, decDegStella] = await getRaDegStella();
  try {
    let [angle, j2000] = await plateSolve({ srcImg, raDegStella, decDegStella, fovStella });
    await moveStellarium(angle, j2000);
    $`afplay /System/Library/Sounds/Purr.aiff`;
  } catch (e) {
    logError(e);
  }
  fs.removeSync(lockFile);
}

function cleanPath(pth) {
  return pth.replace("~", os.homedir());
}

//--------------------------------------------------------------------------------
// main
//--------------------------------------------------------------------------------

fs.removeSync(lockFile);

if (argv.img) {
  const img = cleanPath(argv.img);
  processImg(img);
} else if (argv.dir) {
  if (!fs.pathExistsSync(argv.dir)) {
    logError(`dir ${argv.dir} not found -> abort`);
    process.exit();
  }
  const dir = cleanPath(argv.dir);
  log(`watching dir ${ppPath(dir)}`);
  chokidar.watch(dir).on("add", (path) => {
    if (path.endsWith(".fit") || path.endsWith(".png") || path.endsWith(".jpg")) {
      log(chalk.yellow("--------------------------------------------------------------------------------"));
      processImg(path);
    }
  });
} else {
  console.log(`usage: stella_sync.mjs --img <img to analyze>
       stella_sync.mjs --dir <dir to watch>`);
}
