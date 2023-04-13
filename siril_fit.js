#!/usr/bin/env node

// Imports
const fs = require("fs-extra");
const chalk = require("chalk");
const argv = require("minimist")(process.argv.slice(2));
const { basename, extname } = require("path");
const { log, cleanPath, exe, logError } = require("utils");

// Siril
const sirilCli = "/Users/didier/bin/siril-cli";
const tmpDir = "/tmp/siril";

async function runSiril(dirPath, inputFileName) {
  log(`processing ${chalk.blue(inputFileName)}`);
  const tmpScriptPath = `${tmpDir}/siril.script`;
  const baseFileName = basename(inputFileName);
  const script = `
    requires 1.2.0
    cd "${dirPath}"
    load "${inputFileName}"
    rmgreen 1
    subsky -rbf -samples=75 -tolerance=2.0 -smooth=0.5
    fmedian 3x3 1
    mirrorx
    autostretch -linked -2.8 0.1
    save "siril/fits/${baseFileName}"
    savejpg "siril/jpgs/${baseFileName}" 99`;

  fs.writeFileSync(tmpScriptPath, script);
  await exe(`${sirilCli} -s ${tmpScriptPath}`);
}

function usage() {
  console.log(`usage:
  siril_fit.js --dir <dir>

example:
  ./siril_fit.js --dir $ASTRO/asistudio/2023-04-08`);
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

    fs.ensureDirSync(tmpDir);
    fs.ensureDirSync(`${dir}/siril/fits`);
    fs.ensureDirSync(`${dir}/siril/jpgs`);

    log(`processing dir ${chalk.blue(dir)}`);
    for (fileName of fs.readdirSync(dir)) {
      if (extname(fileName) == ".fit") {
        await runSiril(dir, fileName);
      }
    }
  } else {
    usage();
  }
}

main();