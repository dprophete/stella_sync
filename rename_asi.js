#!/usr/bin/env node

const fs = require("fs-extra");
const chalk = require("chalk");
const argv = require("minimist")(process.argv.slice(2));
const path = require("path");
const { ppPath } = require("pp");
const { cleanPath, log, logError } = require("utils");

//--------------------------------------------------------------------------------
// main
//--------------------------------------------------------------------------------

function getUniqueName(dir, fileName) {
  // check for duplicates
  if (!fs.pathExistsSync(`${dir}/${fileName}`)) return fileName;

  const base = path.parse(fileName).name;
  const ext = path.extname(fileName);
  let idx = 2;
  let possibleNewName;
  while (true) {
    possibleNewName = `${base} - v${idx}${ext}`;
    if (!fs.pathExistsSync(`${dir}/${possibleNewName}`)) break;
    idx++;
  }
  logError(`duplicate ${fileName} -> using ${possibleNewName}`);
  return possibleNewName;
}

function formatName(fileName) {
  const matches = fileName.match(/Light_Stack_(\d+)frames_(.*)_(\d+)sec_.*_gain(\d+).*\.(.*)$/);
  if (!matches) return null;

  const [full, frames, name, sub, gain, ext] = matches;
  const total = parseInt(frames) * parseInt(sub);
  let totalStr = "";
  if (total < 120) {
    totalStr = `${total}s`;
  } else {
    totalStr = `${Math.round(total / 60)}m`;
  }
  let gainStr = "high";
  if (gain == "0") gainStr = "low";
  if (gain == "120") gainStr = "mid";

  return `${name} - gain ${gainStr} - ${frames}x${sub}s - total ${totalStr}.${ext}`.replace("  ", " ");
}

function usage() {
  let name = path.basename(process.argv[1]);
  let ex = "Light_Stack_4frames_c27 - gain low - fwhm 9_30sec_Bin1_22.8C_gain0_2023-09-09_222322.jpg";
  console.log(`usage:
  ${name} --dir <dir>

  renames asi files: ${ex} -> ${formatName(ex)}

example:
  ${name} --dir $ASTRO/asistudio/2023-04-08`);
  process.exit();
}

//--------------------------------------------------------------------------------
// main
//--------------------------------------------------------------------------------

if (argv.dir) {
  const dir = cleanPath(argv.dir);
  if (!fs.pathExistsSync(dir)) {
    logError(`dir ${dir} not found -> abort`);
    process.exit();
  }
  log(`cleaning dir ${chalk.blue(ppPath(dir))}`);
  fs.readdirSync(dir).forEach((fileName) => {
    if (fs.statSync(`${dir}/${fileName}`).isFile() && fileName.startsWith("Light_Stack_")) {
      if (fileName.indexOf("_test_") != -1) {
        fs.removeSync(`${dir}/${fileName}`);
        log(`removing ${fileName}`);
        return;
      }
      let newName = formatName(fileName);
      if (newName) {
        let ext = path.extname(newName);
        let newDir = `${dir}/originals/${ext.substring(1)}s`;
        newName = getUniqueName(newDir, newName);
        log(`${fileName} -> ${newName}`);
        // fs.copySync(`${dir}/${fileName}`, `${dir}/originals/${newName}`);
        fs.moveSync(`${dir}/${fileName}`, `${newDir}/${newName}`);
      }
    }
  });
} else {
  usage();
}
