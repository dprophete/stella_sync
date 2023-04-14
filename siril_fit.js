#!/usr/bin/env node

// Imports
const fs = require("fs-extra");
const chalk = require("chalk");
const argv = require("minimist")(process.argv.slice(2));
const path = require("path");
const { log, cleanPath, exe, logError } = require("utils");

const sirilCli = cleanPath("~/bin/siril-cli");

async function runSiril(dir, inputFileName) {
  if (path.extname(inputFileName) != ".fit") return;
  log(`processing ${chalk.blue(inputFileName)}`);

  fs.ensureDirSync(`${dir}/siril/fits`);
  fs.ensureDirSync(`${dir}/siril/jpgs`);
  const tmpScriptPath = `${dir}/siril.script`;
  const baseFileName = inputFileName.replace(".fit", "");
  const script = `
    requires 1.2.0
    cd "${dir}"
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
  fs.removeSync(tmpScriptPath);
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
      await runSiril(dir, fileName);
    }
  } else if (argv.img) {
    const img = cleanPath(argv.img);
    if (!fs.pathExistsSync(img)) {
      logError(`image ${img} not found -> abort`);
      process.exit();
    }
    await runSiril(path.dirname(img), path.basename(img));
  } else {
    usage();
  }
}

main();
