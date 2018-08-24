#!/usr/bin/env node

const port = process.env.PORT
const cmd = process.argv[process.argv.length - 1]

console.log("Starting on port:", port)
console.log(`Any postdata will be forwarded to this command as the final argument:
${cmd}
`)

const http = require('http');
const child_process = require('child_process')

http.createServer((req, res) => {
    const data = JSON.stringify(JSON.parse(req.read().toString()))
    const calling = `${cmd} ${JSON.stringify(data)}`  // stringify twice should give us wrapping quotes and escape all other quotes
    console.log('calling :', calling);
    const output = child_process.execSync(calling)
    const ls = output.toString().split('\n')
    res.write(ls[ls.length - 1])
}).listen(port)
