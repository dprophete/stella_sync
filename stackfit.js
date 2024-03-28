#!/usr/bin/env node

// Imports
const { basename, extname, join } = require("path");
const { execSync } = require("child_process");
const { statSync, readdirSync, writeFileSync, rmSync, renameSync, mkdirSync } = require("fs");
const { randomUUID } = require("crypto");
const chalk = require("chalk");
const yargs = require("yargs");

// Constants
const SIRIL = "~/bin/siril-cli";
const pixelWidth = 4144;
const pixelHeight = 2822;
const sirilMinVersion = "1.2.0";

// Console Logging
function log(tag, str, color) {
  color = color || chalk.green;
  console.log(color(`${new Date().toTimeString().substring(0, 8)} ${tag.padEnd(16)} : ${str}`));
}

function logMulti(tag, header, body, color) {
  color = color || chalk.green;
  log(tag, `------------ ${header} ------------`, color);
  console.log(color(body));
}

function logError(err) {
  log("error", err, chalk.red);
}

function run(cmd, dirPath) {
  execSync(cmd, { cwd: dirPath, stdio: "ignore" });
}

function isFrameDirectory(path) {
  const regex = /^\d{4}-\d{2}-\d{2}_\d{2}_\d{2}_\d{2}Z$/;
  return statSync(path).isDirectory() && regex.test(basename(path));
}

function countSelectedFrames(frameDirPath) {
  const selectedFrameRegex = /^r_img_[0-9]*.fit/;
  const frames = readdirSync(join(frameDirPath, "out")).filter((f) => selectedFrameRegex.test(f));
  return frames.length;
}

function computeFrameBaseName(frameDirPath) {
  const sourceFrameRegex = /Light_([^_]*)_([0-9\.]*)sec_.*_gain([0-9]*)_([0-9]*-[0-9]*-[0-9]*)_([0-9]*)_[0-9]*.fit/;
  const files = readdirSync(frameDirPath).filter((f) => f.endsWith(".fit") && f.match(sourceFrameRegex));
  if (files.length > 0) {
    const match = files[0].match(sourceFrameRegex);
    const attrs = {
      countFrames: countSelectedFrames(frameDirPath),
      objectName: match[1],
      frameLength: match[2],
      gain: match[3],
      date: match[4],
      time: match[5],
    };

    return `${attrs.date} ${attrs.time} ${attrs.objectName} ${attrs.countFrames}x${attrs.frameLength}s gain ${attrs.gain}`;
  } else {
    return null;
  }
}

function computeDriftPerFrame(outputDirPath) {
  const regFiles = readdirSync(outputDirPath).filter((f) => /^r_img_[0-9]*.fit/.test(f));
  const indices = regFiles.map((f) => parseInt(f.match(/^r_img_(.*).fit/)[1]));
  const firstIndex = Math.min(...indices);
  const lastIndex = Math.max(...indices);
  const identifyCmd = `identify ${join(outputDirPath, regFiles[0])}`;
  const info = execSync(identifyCmd).toString();
  const infoParsed = info.match(/.*[ ]([0-9]*)x([0-9]*)[ ].*/);
  const width = parseInt(infoParsed[1]);
  const height = parseInt(infoParsed[2]);
  const dw = pixelWidth - width;
  const dh = pixelHeight - height;
  const driftPerFrame = Math.sqrt(dw * dw + dh * dh) / (lastIndex - firstIndex + 1);

  return Math.round(driftPerFrame * 10) / 10;
}

function prepareOutDir(frameDirPath) {
  const outDirPath = join(frameDirPath, "out");
  rmSync(outDirPath, { recursive: true, force: true });
  mkdirSync(outDirPath);
  return outDirPath;
}

function process() {
  const parentDir = config.workingDir;
  readdirSync(parentDir).map((entry) => {
    if (isFrameDirectory(join(parentDir, entry))) {
      runSiril(parentDir, entry);
    }
  });
}

class SirilScriptBuilder {
  constructor(sirilMinVersion, outDirPath) {
    this.commands = [];
    this.seqName = "img";
    this.commands.push(`requires ${sirilMinVersion}`);
    this.commands.push(`convert ${this.seqName} -debayer -out=${outDirPath}`);
    this.commands.push(`cd ${basename(outDirPath)}`);
  }

  calibrate(bias, dark, flat) {
    if (bias || dark || flat) {
      const biasParam = bias ? `-bias=${bias}` : "";
      const darkParam = dark ? `-dark=${dark} -cc=dark` : "";
      const flatParam = flat ? `-flat=${flat}` : "";
      this.commands.push(`calibrate ${this.seqName} ${biasParam} ${darkParam} ${flatParam}`);
      this.seqName = `pp_${this.seqName}`;
    }
    return this;
  }

  register(fwhmFilterPerc) {
    this.commands.push(`register ${this.seqName} -2pass`);
    this.commands.push(`seqapplyreg ${this.seqName} -framing=min -filter-fwhm=${fwhmFilterPerc}%`);
    this.seqName = `r_${this.seqName}`;
    return this;
  }

  seqSubSky(enabled) {
    if (enabled) {
      this.commands.push(`seqsubsky ${this.seqName} 2 -samples=8`);
      this.seqName = `bkg_${this.seqName}`;
    }
    return this;
  }

  stack() {
    this.commands.push(`stack ${this.seqName} rej 3 3 -norm=addscale`);
    this.commands.push(`load ${this.seqName}_stacked`);
    return this;
  }

  rmGreen() {
    this.commands.push(`rmgreen 0`);
    return this;
  }

  subSky(enabled) {
    if (enabled) {
      this.commands.push(`subsky -rbf -samples=75 -tolerance=3.0 -smooth=0.5`);
    }
    return this;
  }

  autoStretch(shadowsClip, targetBg, isLinked) {
    const linkedOption = isLinked ? "-linked" : "";
    this.commands.push(`autostretch ${linkedOption} ${shadowsClip} ${targetBg}`);
    return this;
  }

  satu(amount) {
    this.commands.push(`satu ${amount} 1`);
    return this;
  }

  save(outputName) {
    this.commands.push(`mirrorx`);
    this.commands.push(`cd ..`);
    this.commands.push(`savejpg ${outputName}`);
    return this;
  }

  build() {
    return this.commands.join("\n");
  }
}

function runSiril(parentDir, frameDirName) {
  const frameDirPath = join(parentDir, frameDirName);
  log("runSiril", `Processing frames in: ${parentDir}/${frameDirName}`);
  const uuid = randomUUID();
  const tmpScriptName = `${uuid}.script`;
  const tmpScriptPath = join(parentDir, tmpScriptName);
  const tmpOutputName = `${uuid}`;
  const outDirPath = prepareOutDir(frameDirPath);

  const builder = new SirilScriptBuilder(sirilMinVersion, outDirPath);
  const script = builder
    .calibrate(config.bias, config.dark, config.flat)
    .register(config.fwhmFilter)
    .seqSubSky(config.doSeqSubSky)
    .stack()
    .rmGreen()
    .subSky(config.doSubSky)
    .autoStretch(config.shadowsClip, config.targetBg, config.linked)
    .satu(config.satuAmount)
    .save(tmpOutputName)
    .build();

  writeFileSync(tmpScriptPath, script);
  const cmd = `${SIRIL} -s ${tmpScriptPath} -d ${frameDirPath}`;
  try {
    run(cmd, parentDir);
    const driftPerFrame = computeDriftPerFrame(join(frameDirPath, "out"));
    const frameBaseName = computeFrameBaseName(frameDirPath);
    const linkedDesc = config.linked ? "linked" : "unlinked";
    const outputName = `${frameBaseName} dpf ${driftPerFrame} sclip ${config.shadowsClip} tbg ${config.targetBg} subSky ${config.doSubSky} seqSubSky ${config.doSeqSubSky} satu ${config.satuAmount} ${linkedDesc}`;
    log("runSiril", `Generated: ${outputName}`);
    renameSync(join(frameDirPath, `${tmpOutputName}.jpg`), join(parentDir, `${outputName}.sfit.jpg`));
    rmSync(tmpScriptPath);
    rmSync(outDirPath, { recursive: true, force: true });
  } catch (err) {
    logError(`Failed to run: ${cmd}`);
    logError(err);
    logMulti("runSiril", "script", script);
  }
}

// Main
const args = yargs.argv;
const config = {
  workingDir: args["dir"] || "/Users/wmathurin/Downloads/LastNight",
  bias: args["bias"],
  dark: args["dark"],
  flat: args["flat"],
  fwhmFilter: args["fwhmFilter"] || "80",
  doSubSky: args["doSubSky"] === "true",
  doSeqSubSky: args["doSeqSubSky"] === "true",
  shadowsClip: args["shadowsClip"] || "-2.8",
  targetBg: args["targetBg"] || "0.25",
  linked: args["linked"] === "true",
  satuAmount: args["satuAmount"] || "0",
};
logMulti("main", "Running with configuration", JSON.stringify(config, null, 2));

// Go!
process();
