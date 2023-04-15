#!/bin/bash

DIR=$1

if [ "$#" -eq "0" ]; then
  cat <<EOT
usage:
  $0 <dir with original asi studio files>

  will process the asi studio files:
  - rename files using readable names
  - use siril to crop, extract bg, and autostretch
  - launch denoise

  you end up with the following dir structure:
    <base>/originals/fits
    <base>/originals/jpgs
    <base>/siril/fits
    <base>/siril/jpgs
    <base>/ <- the resulting files from denoise will be saved here

example:
  $0 \$ASTRO/asistudio/2023-04-08
EOT
  exit
fi

if [ ! -d $1 ]; then 
  echo "dir $1 not found"
  exit
fi

echo ">>--------------------------------------------------------------------------------"
echo ">> renaming files"
echo ">>--------------------------------------------------------------------------------"
./rename_asi.js --dir $DIR

echo
echo ">>--------------------------------------------------------------------------------"
echo ">> processing fit files with siril"
echo ">>--------------------------------------------------------------------------------"
./siril_fit.js --dir $DIR/originals/fits
mv $DIR/originals/fits/siril --dst $DIR

echo
echo ">>--------------------------------------------------------------------------------"
echo ">> opeming with denoise"
echo ">>--------------------------------------------------------------------------------"
cp -R $DIR/siril/jpgs/* $DIR
open -a "topaz Denoise AI" $DIR/*.jpg
