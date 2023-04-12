#!/usr/bin/env node

const fs = require("fs-extra");
const express = require("express");
const multer = require("multer");
const chalk = require("chalk");
const argv = require("minimist")(process.argv.slice(2));
const path = require("path");
const { degToJ2000, j2000ToDeg, normalizeDeg } = require("convert");
const { log, logError, exe, resolveLocalhost, sleep, cleanPath, play, astap, watch } = require("utils");
const { ppPath, ppDeg, ppJ2000 } = require("pp");

const tmpDir = "/tmp/stella_sync";
const plateSolveDir = `${tmpDir}/platesolve`; // where the server will put the platesolving files
const downloadDir = `${tmpDir}/download`; // where the server will receive the images
const uploadDir = `${tmpDir}/upload`; // where the client send the images
const lockFile = `${tmpDir}/stella_sync.lock`; // a file used to make sure we don't try to process two images at once

// defaults for astap
const astapSearch = 25;

// will be defined later
let stellariumApi;

//--------------------------------------------------------------------------------
// stellarium/plate solving
//--------------------------------------------------------------------------------

// find where we are in stellarium
// return: [ra, dec] (degreees)
async function getRaDegStella() {
  try {
    let res = await exe(`curl -s ${stellariumApi}/main/view`);
    let jsonRes = JSON.parse(res);
    let j2000 = JSON.parse(jsonRes["j2000"]);
    let [raDeg, decDeg] = j2000ToDeg(j2000);
    log(`stellarium at: ${ppJ2000(j2000)} -> ra: ${ppDeg(raDeg)}, dec: ${ppDeg(decDeg)}`);
    return [raDeg, decDeg];
  } catch (_) {
    logError("stellarium not running or doesn't have the remote control plugin)");
    process.exit();
  }
}

async function getFovStella() {
  try {
    let res = await exe(`curl -s ${stellariumApi}/stelproperty/list`);
    const jsonRes = JSON.parse(res);
    const lensIndex = jsonRes["Oculars.selectedLensIndex"]["value"];
    const ratios = [1, 2.5, 0.73, 0.66, 0.6, 0.54, 1.6, 2.5];
    const ratio = ratios[lensIndex + 1] || 1; 
    if (ratio == 1) log(`detected ${chalk.blue("no barlow or FR")}`);
    else if (ratio > 1) log(`detected barlow ${chalk.blue(ratio)}`);
    else log(`detected FR ${chalk.blue(ratio)}`);
    return ratio;
  } catch (_) {
    logError("stellarium not running or doesn't have the remote control plugin)");
    process.exit();
  }
}

// params is: { srcImg, raDegStella, decDegStella, searchRadius, fovCamera, server }
// return: [angle (degrees), j2000]
async function plateSolve(params) {
  let startDate = new Date().getTime();
  const [angle, raDeg, decDeg] = params.server ? await remotePlateSolve(params) : await localPlateSolve(params);
  let endDate = new Date().getTime();
  log(`platesolving took ${chalk.blue(((endDate - startDate) / 1000).toFixed(2) + "s")}`);

  const j2000 = degToJ2000(raDeg, decDeg);
  log(`solved: ra: ${chalk.blue(ppDeg(raDeg))}, dec: ${chalk.blue(ppDeg(decDeg))} -> ${ppJ2000(j2000)}`);
  log(`rotation: ${chalk.blue(ppDeg(angle))}`);
  return [angle, j2000];
}

// send image to remote server for platesolving
async function remotePlateSolve({ srcImg, raDegStella, decDegStella, searchRadius, fovCamera, server }) {
  log("sending img to remote server for platesolve");
  const dstImg = `${uploadDir}/tmp${path.extname(srcImg)}`;
  fs.removeSync(dstImg);
  fs.copySync(srcImg, dstImg);
  let res = await exe(`curl -X POST -F "ra=${raDegStella}" -F "dec=${decDegStella}" -F "seach=${searchRadius}" -F "fov=${fovCamera}" -F "img=@${dstImg}" ${server}/platesolve`, true);
  let { success, angle, raDeg, decDeg, error } = JSON.parse(res);
  if (success) return [angle, raDeg, decDeg];
  throw error;
}

async function localPlateSolve({ srcImg, raDegStella, decDegStella, searchRadius, fovCamera }) {
  // copy img to tmp dst
  const baseImg = path.basename(srcImg);
  const img = `${plateSolveDir}/${baseImg}`;
  fs.removeSync(plateSolveDir);
  fs.ensureDirSync(plateSolveDir);
  fs.copySync(srcImg, img);

  return localPlateSolveAstap({ img, raDegStella, decDegStella, searchRadius, fovCamera });
}

async function localPlateSolveAstap({ img, raDegStella, decDegStella, searchRadius, fovCamera }) {
  const ext = path.extname(img);

  const wcs = img.replace(ext, ".wcs");
  // plate solve
  try {
    let output = await exe(`${astap()} -ra ${raDegStella / 15} -spd ${normalizeDeg(90 + decDegStella)} -r ${searchRadius} -f ${img}`);
  } catch (e) {
    throw "error: couldn't solve for ra/dec";
  }

  // extract result
  let values = {}; // hashmap of values from the wcs file
  let res = await exe(`cat ${wcs}`);
  res.split("\n").forEach((line) => {
    let parts = line.slice(0, line.indexOf(" / ")).split("=");
    if (parts.length == 2) values[parts[0].trim()] = parts[1].trim();
  });

  const raDeg = parseFloat(values["CRVAL1"]);
  const decDeg = parseFloat(values["CRVAL2"]);
  const angle = normalizeDeg(180 - parseFloat(values["CROTA1"]));

  return [angle, raDeg, decDeg];
}

// move stellarium
// params: angle (in degrees), j2000
async function moveStellarium(angle, [x, y, z]) {
  await exe(`curl -s -d 'position=[${x}, ${y}, ${z}]' ${stellariumApi}/main/focus`);
  await exe(`curl -s -d "id=Oculars.selectedCCDRotationAngle&value=${angle}" ${stellariumApi}/stelproperty/set`);
}

// process image:
// - check with stellarium where we are pointing
// - use this to platesolve (within 1° of where stellarium is pointing)
// - move stellarium to exactly where we are (position + rotation)
async function processImg(img, searchRadius, fovCamera, server) {
  log(`processing ${chalk.blue(ppPath(img))}`);
  if (fs.pathExistsSync(lockFile)) {
    logError(`lockFile ${lockFile} already exists -> abort`);
    return;
  }
  if (!fs.pathExistsSync(img)) {
    logError(`image ${img} not found -> abort`);
    return;
  }
  fs.ensureFileSync(lockFile);

  const srcImg = `${uploadDir}/tmp${path.extname(img)}`;
  fs.removeSync(srcImg);
  fs.copySync(img, srcImg);
  let [raDegStella, decDegStella] = await getRaDegStella();

  if (img.indexOf("Light_Preview_test_") != -1) {
    const ext = path.extname(img);
    const jpg = img.replace(ext, ".jpg");
    fs.removeSync(img);
    fs.removeSync(jpg);
    log(`delete img ${img}`);
    log(`delete img ${jpg}`);
  }
  try {
    let [angle, j2000] = await plateSolve({ srcImg, raDegStella, decDegStella, searchRadius, fovCamera, server });
    await moveStellarium(angle, j2000);
    await play("/System/Library/Sounds/Purr.aiff");
  } catch (e) {
    logError(e);
  }
  fs.removeSync(lockFile);
}

async function processDir(dir, searchRadius, fovCamera, server, pattern) {
  if (!fs.pathExistsSync(dir)) {
    logError(`dir ${dir} not found -> abort`);
    process.exit();
  }
  log(`watching dir ${chalk.blue(ppPath(dir))}`);
  while (true) {
    let path = await watch(dir, pattern);
    if (path == "") continue; // when you delete files
    log(chalk.yellow("--------------------------------------------------------------------------------"));
    await sleep(500); // make sure the file is fully written (seems that sharpcap takes a little bit of time)
    await processImg(path, searchRadius, fovCamera, server);
  }
}
//--------------------------------------------------------------------------------
// server
//--------------------------------------------------------------------------------

async function startServer(port) {
  const app = express();
  const upload_middleware = multer({ dest: downloadDir });

  app.get("/ping", (req, res) => {
    log("received ping");
    res.send("file received");
  });

  app.post("/platesolve", upload_middleware.single("img"), async (req, res) => {
    log(chalk.yellow("--------------------------------------------------------------------------------"));
    log(`received platesolve for ${req.file.originalname} (size: ${Math.round(req.file.size / 1024)}kb)`);
    const srcImg = `${downloadDir}/${req.file.originalname}`;
    fs.moveSync(req.file.path, srcImg, { overwrite: true });
    const raDegStella = parseFloat(req.body.ra);
    const decDegStella = parseFloat(req.body.dec);
    const searchRadius = parseFloat(req.body.search);
    const fovCamera = parseFloat(req.body.fov);
    try {
      let [angle, raDeg, decDeg] = await localPlateSolve({ srcImg, raDegStella, decDegStella, searchRadius, fovCamera });
      res.json({ success: true, angle, raDeg, decDeg });
    } catch (e) {
      logError(e);
      res.json({ success: false, error: e.toString() });
    }
    fs.removeSync(srcImg);
  });

  const localIp = await exe(`ipconfig getifaddr en0`);
  app.listen(port, () => {
    log(`starting in server mode on http://${localIp}:${port}`);
  });
}

async function pingServer(server) {
  log(`will use remote server at ${server} for platesolving`);
  // try to ping server
  try {
    await exe(`curl -s ${server}/ping`);
  } catch (_) {
    logError(`server did not respond`);
    process.exit();
  }
}

//--------------------------------------------------------------------------------
// main
//--------------------------------------------------------------------------------

async function main() {
  fs.ensureDirSync(tmpDir);
  fs.ensureDirSync(uploadDir);
  fs.ensureDirSync(downloadDir);
  fs.removeSync(lockFile);
  const localhost = await resolveLocalhost();
  stellariumApi = `http://${localhost}:8090/api`;

  let ratioCamera = await getFovStella();
  const fovDefault = 1 / ratioCamera; // base fov is 1 arciminute on the y axis

  const fovCamera = parseFloat(argv.fov || fovDefault);
  const searchRadius = parseInt(argv.search || astapSearch);
  const pattern = argv.pattern || "*test*.fit";

  log(`using ${chalk.blue("astap")} for platesolving`);
  log(`using fov for camera ${chalk.blue(fovCamera.toFixed(2))}`);
  log(`using search radius ${chalk.blue(searchRadius.toFixed(2))}`);
  log(`using pattern ${chalk.blue(pattern)}`);

  const server = argv.server;
  if (server) pingServer(server);

  if (argv.img) {
    const img = cleanPath(argv.img);
    processImg(img, searchRadius, fovCamera, server);
  } else if (argv.dir) {
    const dir = cleanPath(argv.dir);
    processDir(dir, searchRadius, fovCamera, server, pattern);
  } else if (argv.port) {
    const port = parseInt(argv.port);
    startServer(port);
  } else {
    console.log(`usage:
  stella_sync.js --img <img to analyze> [options]
  stella_sync.js --dir <dir to watch> [options]
  stella_sync.js --port <port> [options]

options:
  --pattern: pattern for files to watch (when dir is used), default "*test*.fit"
  --radius: search radius in degrees, default 25
  --fov: fov of the camera in degrees, default 1
  --server: an optional server url`);
  }
}

main();
