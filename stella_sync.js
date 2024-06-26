#!/usr/bin/env node

const fs = require("fs-extra");
const chalk = require("chalk");
const argv = require("minimist")(process.argv.slice(2));
const path = require("path");
const { degToJ2000, j2000ToDeg, normalizeDeg } = require("./convert.js");
const { log, logError, exe, resolveLocalhost, sleep, cleanPath, play, watch } = require("./utils.js");
const { ppPath, ppDeg, ppJ2000 } = require("./pp.js");

const tmpDir = "/tmp/stella_sync";
const plateSolveDir = `${tmpDir}/platesolve`; // where the server will put the platesolving files
const downloadDir = `${tmpDir}/download`; // where the server will receive the images
const uploadDir = `${tmpDir}/upload`; // where the client send the images
const lockFile = `${tmpDir}/stella_sync.lock`; // a file used to make sure we don't try to process two images at once

// defaults for astap
const astap = cleanPath("~/bin/astap");
const astapSearchRadius = 25;

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
    log(`stellarium: ${res}`);
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
  const [angle, raDeg, decDeg] = await localPlateSolve(params);
  let endDate = new Date().getTime();
  log(`platesolving took ${chalk.blue(((endDate - startDate) / 1000).toFixed(2) + "s")}`);

  const j2000 = degToJ2000(raDeg, decDeg);
  log(`solved: ra: ${chalk.blue(ppDeg(raDeg))}, dec: ${chalk.blue(ppDeg(decDeg))} -> ${ppJ2000(j2000)}`);
  log(`rotation: ${chalk.blue(ppDeg(angle))}`);
  return [angle, j2000];
}

async function localPlateSolve({ srcImg, raDegStella, decDegStella, searchRadius }) {
  // copy img to tmp dst
  const baseImg = path.basename(srcImg);
  const img = `${plateSolveDir}/${baseImg}`;
  fs.removeSync(plateSolveDir);
  fs.ensureDirSync(plateSolveDir);
  fs.copySync(srcImg, img);

  const ext = path.extname(img);
  const wcs = img.replace(ext, ".wcs");
  // plate solve
  try {
    await exe(`${astap} -ra ${raDegStella / 15} -spd ${normalizeDeg(90 + decDegStella)} -r ${searchRadius} -f ${img}`);
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
async function processImg(img, searchRadius, fovCamera) {
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
    let [angle, j2000] = await plateSolve({ srcImg, raDegStella, decDegStella, searchRadius, fovCamera });
    await moveStellarium(angle, j2000);
    await play("/System/Library/Sounds/Purr.aiff");
  } catch (e) {
    logError(e);
  }
  fs.removeSync(lockFile);
}

async function processDir(dir, searchRadius, fovCamera, pattern) {
  if (!fs.pathExistsSync(dir)) {
    logError(`dir ${dir} not found -> abort`);
    process.exit();
  }
  log(`watching dir ${chalk.blue(ppPath(dir))}`);
  while (true) {
    let path = await watch(dir, pattern);
    if (path == "") continue; // when you delete files
    log(chalk.yellow("--------------------------------------------------------------------------------"));
    await sleep(500); // make sure the file is fully written (seems that sharpcap/asistudio takes a little bit of time)
    await processImg(path, searchRadius, fovCamera);
  }
}

function usage() {
  let name = path.basename(process.argv[1]);
  console.log(`usage:
  ${name} --img <img to analyze> [options]
  ${name} --dir <dir to watch> [options]
  ${name} --port <port> [options]

options:
  --pattern: pattern for files to watch (when dir is used), default "*test*.fit"
  --radius: search radius in degrees, default 25
  --fov: fov of the camera in degrees, default 1

example:
  ${name}.js --dir $ASTRO/asistudio`);
  process.exit();
}

//--------------------------------------------------------------------------------
// main
//--------------------------------------------------------------------------------

async function main() {
  if (process.argv.length == 2) usage();

  fs.ensureDirSync(tmpDir);
  fs.ensureDirSync(uploadDir);
  fs.ensureDirSync(downloadDir);
  fs.removeSync(lockFile);
  const localhost = '127.0.0.1'; //await resolveLocalhost();
  stellariumApi = `http://${localhost}:8090/api`;

  let ratioCamera = await getFovStella();
  const fovDefault = 1 / ratioCamera; // base fov is 1 arciminute on the y axis

  const fovCamera = parseFloat(argv.fov || fovDefault);
  const searchRadius = parseInt(argv.search || astapSearchRadius);
  const pattern = argv.pattern || "*test*.fit";

  log(`monitoring dir ${chalk.blue(argv.dir)}`);
  log(`using ${chalk.blue("astap")} for platesolving`);
  log(`using fov for camera ${chalk.blue(fovCamera.toFixed(2))}`);
  log(`using search radius ${chalk.blue(searchRadius.toFixed(2))}`);
  log(`using pattern ${chalk.blue(pattern)}`);

  if (argv.img) {
    const img = cleanPath(argv.img);
    processImg(img, searchRadius, fovCamera);
  } else if (argv.dir) {
    const dir = cleanPath(argv.dir);
    processDir(dir, searchRadius, fovCamera, pattern);
  } else {
    usage();
  }
}

main();
