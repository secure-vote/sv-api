#!/bin/bash

mkdir -p docker-run
rsync -rtv --progress ./sv ./docker-run/sv

echo "compiling TS in ./docker-run/sv/light/"
tsc ./docker-run/sv/light/*.ts
echo "finished compiling"
