#!/usr/bin/env node

// Imports
const fs = require("fs-extra");
const chalk = require("chalk");
const argv = require("minimist")(process.argv.slice(2));
const path = require("path");
const { log, cleanPath, exe, logError } = require("utils");

const sirilCli = cleanPath("~/bin/siril-cli");
const tmpScriptPath = "/tmp/siril.script";
const cropPct = 0.15;

async function runSirilScript(script) {
  fs.writeFileSync(tmpScriptPath, script);
  await exe(`${sirilCli} -s ${tmpScriptPath}`);
  fs.removeSync(tmpScriptPath);
}

// run a siril script to extract image metadata
async function getFitMeta(dir, inputFileName) {
  const justFileName = inputFileName.replace(".fit", "");
  const jsonPath = `${dir}/${justFileName}.json`;

  await runSirilScript(`
    requires 1.2.0
    cd "${dir}"
    jsonmetadata "${inputFileName}"`);

  let json = JSON.parse(fs.readFileSync(jsonPath));
  fs.removeSync(jsonPath);

  let fields = {};
  json.headers.forEach(({ key, value }) => {
    fields[key] = value;
  });
  return fields;
}

function cropParams(width, height, pct) {
  const startX = (pct * width).toFixed();
  const startY = (pct * height).toFixed();
  const endX = width - 2 * startX;
  const endY = height - 2 * startY;

  return `${startX} ${startY} ${endX} ${endY}`;
}

async function process(dir, inputFileName) {
  if (path.extname(inputFileName) != ".fit") return;

  log(`processing ${chalk.blue(inputFileName)}`);

  fs.ensureDirSync(`${dir}/siril/fits`);
  fs.ensureDirSync(`${dir}/siril/jpgs`);
  const justFileName = inputFileName.replace(".fit", "");
  let meta = await getFitMeta(dir, inputFileName);
  let width = parseInt(meta["NAXIS1"]);
  let height = parseInt(meta["NAXIS2"]);

  await runSirilScript(`
    requires 1.2.0
    cd "${dir}"
    load "${inputFileName}"
    crop ${cropParams(width, height, cropPct)}
    rmgreen 1
    subsky -rbf -samples=75 -tolerance=2.0 -smooth=0.5
    fmedian 3x3 1
    mirrorx
    autostretch -linked -2.8 0.1
    save "siril/fits/${justFileName}"
    savejpg "siril/jpgs/${justFileName}" 99`);
}

function usage() {
  let name = path.basename(process.argv[1]);
  console.log(`usage:
  ${name} --dir <dir with fit files>
  ${name} --img <fit file>

example:
  ${name} --dir $ASTRO/asistudio/2023-04-08`);
  process.exit();
}

//--------------------------------------------------------------------------------
// main
//--------------------------------------------------------------------------------

async function main() {
  if (argv.dir) {
    const dir = cleanPath(argv.dir);
    if (!fs.pathExistsSync(dir)) {
      logError(`dir ${dir} not found -> abort`);
      process.exit();
    }

    log(`processing dir ${chalk.blue(dir)}`);
    for (fileName of fs.readdirSync(dir)) {
      await process(dir, fileName);
    }
  } else if (argv.img) {
    const img = cleanPath(argv.img);
    if (!fs.pathExistsSync(img)) {
      logError(`image ${img} not found -> abort`);
      process.exit();
    }
    await process(path.dirname(img), path.basename(img));
  } else {
    usage();
  }
}

main();
