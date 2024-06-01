//--------------------------------------------------------------------------------
// utils functions
//--------------------------------------------------------------------------------

const { exec } = require("child_process");
const chalk = require("chalk");
const os = require("os");
const fs = require("fs-extra");
const path = require("path");
const { ppNow } = require("./pp.js");

function log(...args) {
  console.log(chalk.yellow(ppNow()), ...args);
}

function logError(...args) {
  play("/System/Library/Sounds/Ping.aiff");
  console.log(chalk.red(ppNow(), ...args));
}

function exe(cmd, logCmd = false) {
  return new Promise((resolve, reject) => {
    if (logCmd) log(`cmd: ${cmd}`);
    exec(cmd, { maxBuffer: 100 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (logCmd) log(`stdout: ${stdout}\nstderr: ${stderr}\nerror: ${error}`);
      if (error) reject(error);
      else resolve((stdout || stderr || "").trim());
    });
  });
}

async function resolveLocalhost() {
  // on windows, wsl can't ping localhost (apparently the port mapping in only one way so we
  // have to resolve localhost in a different way)
  return (await exe(`hostname -s`)) + ".local";
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

// ~/astronomy/sharpcap -> /Users/didier/astronomy/sharpcap
function cleanPath(pth) {
  return pth.replace("~", os.homedir());
}

// myimg.fit -> myimg
function removeExtension(fileName) {
  return fileName.replace(path.extname(fileName), "");
}

async function play(sound) {
  if (fs.pathExistsSync("/usr/bin/afplay")) {
    await exe(`afplay ${sound}`);
  } else {
    console.log("");
  }
}

// watch a dir and return the last changed file
async function watch(dir, pattern) {
  if (pattern == null) pattern = "*";
  let find = fs.pathExistsSync("/opt/homebrew/bin/gfind") ? "gfind" : "find";
  // note: it needs to be .fit since jpg/png have an internal rotation and this messes up astap
  let cmd = `${find} "${dir}" -type f -path '${pattern}' -printf '%T+ %p\n' | sort -r | head -n1`;
  let last;
  let current = await exe(cmd);
  while (true) {
    await sleep(500);
    last = await exe(cmd);
    if (last != current) break;
  }
  // last is going to be: <last-modif-date><space><filepath>, so let's only keep the filepath
  return last.substr(last.indexOf(" ") + 1);
}

module.exports = {
  cleanPath,
  exe,
  log,
  logError,
  play,
  removeExtension,
  resolveLocalhost,
  sleep,
  watch,
};
