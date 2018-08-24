#!/usr/bin/env sh

set -e

mkdir -p /build
mkdir -p /build/node_modules

load_docker_node_modules () {
    echo "INIT DOCKER NODE_MODULES"
    currdir=$(pwd)
    cd /lambda
    if [ -f node_modules.docker.tar ]; then
        echo "Found node_modules backup"
        tar xf node_modules.docker.tar -C /build/
    else
        echo "No node_modules backup; will rebuild from scratch"
    fi
    cd "$currdir"
    echo "DONE INIT DOCKER NODE_MODULES"
}

save_docker_node_modules () {
    echo "SAVING DOCKER NODE_MODULES"
    cd /lambda
    tar cf node_modules.docker.tar node_modules
    echo "DONE SAVING DOCKER NODE_MODULES"
}

# move original node modules back if we can on exit
trap save_docker_node_modules EXIT

# go to /lambda and set up modules
cd /lambda
load_docker_node_modules

rsync -av --progress . /build \
    --exclude node_modules --exclude node_modules.docker --exclude node_modules.native \
    --exclude .git --exclude docs --exclude node_modules.docker.tar --exclude pkg-docker
cd /build

echo -e "\n\n ## running npm install ## \n\n"

npm i

echo -e "\n\n ## npm install done ## starting package ## \n\n"

./node_modules/.bin/serverless package --package /build/pkg-docker
rsync -av --progress /build/pkg-docker/ /lambda/pkg-docker --delete
