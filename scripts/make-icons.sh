#!/bin/sh
# Regenerate PNG icons from public/icons/icon.svg (needs rsvg-convert).
# The artwork sits inside the central 80% so it doubles as the maskable icon.
set -eu
cd "$(dirname "$0")/../public/icons"
rsvg-convert -w 192 -h 192 icon.svg -o icon-192.png
rsvg-convert -w 512 -h 512 icon.svg -o icon-512.png
rsvg-convert -w 512 -h 512 icon.svg -o maskable-512.png
rsvg-convert -w 180 -h 180 icon.svg -o apple-touch-180.png
