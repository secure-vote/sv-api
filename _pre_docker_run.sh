#!/bin/bash

mkdir -p docker-run
rsync --omit-dir-times --no-g -rtv --progress . ./docker-run \
    --exclude node_modules --exclude node_modules.docker --exclude node_modules.native \
    --exclude .git --exclude docs --exclude node_modules.docker.tar --exclude pkg-docker \
    --exclude docker-run --exclude package-lock.json

docker run --rm --cpus=2 -v $(pwd)/docker-run:/var/task -it lambci/lambda:build-nodejs8.10 npm install --production
