#!/usr/bin/env node

const port = process.env.PORT
const cmd = process.argv[process.argv.length - 1]

console.log("Starting on port:", port)
console.log(`Any postdata will be forwarded to this command as the final argument:
${cmd}
`)

const express = require('express');
const http = require('http')
const child_process = require('child_process')

const app = express()

app.all('/*', (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Request-Method', '*');
    res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, GET');
    res.setHeader('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') {
        console.log('CORS');
        res.writeHead(200);
        res.end();
        return;
    }

    if (req.method !== "POST") {
        res.writeHead(400)
        res.end()
        console.log("not post")
        return
    }

    req.on('data')
    const body = req.body;
    console.log('body :', body);
    const data = JSON.stringify(JSON.parse(body))
    const calling = `${cmd} ${JSON.stringify(data)}`  // stringify twice should give us wrapping quotes and escape all other quotes
    console.log('calling :', calling);
    const output = child_process.execSync(calling)
    const ls = output.toString().split('\n')
    res.write(ls[ls.length - 1])

    next()
})


http.createServer(app).listen(port)
