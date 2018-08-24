#!/bin/bash

set -e

# sudo mv /var/task /var/task2
# mkdir -p /var/task
sudo mount -t tmpfs -o size=1024M tmpfs /var/task
sudo chown slicer:docker /var/task

load_docker_node_modules () {
    echo "INIT DOCKER NODE_MODULES"
    currdir=$(pwd)
    cd /lambda
    if [ -f node_modules.docker.tar ]; then
        echo "Found node_modules backup"
        tar xf node_modules.docker.tar -C /var/task/
    else
        echo "No node_modules backup; will rebuild from scratch"
    fi
    cd "$currdir"
    echo "DONE INIT DOCKER NODE_MODULES"
}

save_docker_node_modules () {
    echo "SAVING DOCKER NODE_MODULES"
    cd /var/task/
    rm -f /lambda/node_modules.docker.tar
    tar cf /var/task/node_modules.docker.tar node_modules
    mv /var/task/node_modules.docker.tar /lambda/
    echo "DONE SAVING DOCKER NODE_MODULES"
}

# move original node modules back if we can on exit
trap save_docker_node_modules EXIT

mkdir -p /var/task/node_modules

# go to /lambda and set up modules
load_docker_node_modules

cd /lambda

rsync --omit-dir-times --no-g -rtv --progress . /var/task \
    --exclude node_modules --exclude node_modules.docker --exclude node_modules.native \
    --exclude .git --exclude docs --exclude node_modules.docker.tar --exclude pkg-docker

cd /var/task

echo -e "\n\n ## running npm install ## \n\n"

npm i

echo "Compiling TS"
./node_modules/.bin/tsc sv/light/*.ts
echo "Compiled TS files in sv/light/"

ls -al

echo -e "\n\n ## npm install done ## starting execution ## \n\n"

sudo -u sbx_user1051 /var/lang/bin/node --expose-gc --max-semi-space-size=150 --max-old-space-size=2707 /var/runtime/node_modules/awslambda/index.js "$1"
