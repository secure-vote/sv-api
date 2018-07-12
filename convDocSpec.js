#!/usr/bin/env node

const toOpenApi = require('json-schema-to-openapi-schema');

const fs = require('fs')
const R = require('ramda')

const main = () => {
    const swaggerSpec = JSON.parse(fs.readFileSync('./swagger-docs.json'))
    const packageJson = JSON.parse(fs.readFileSync('./package.json'))

    swaggerSpec.definitions = R.map(schema => toOpenApi(schema), swaggerSpec.definitions)

    swaggerSpec.info.title = packageJson.docs.title
    swaggerSpec.info.version = packageJson.version

    fixPathParamDesc(swaggerSpec)

    // ahh some crappy manual additions for the doc generation
    swaggerSpec.definitions.HexString.pattern = "/^0x([0-9a-fA-F]{2})*$/"
    swaggerSpec.definitions.HexString.format = "hexString"

    swaggerSpec.definitions.TXID.pattern = "/^0x([0-9a-fA-F]{2})*$/"
    swaggerSpec.definitions.TXID.minLength = 66
    swaggerSpec.definitions.TXID.maxLength = 66
    swaggerSpec.definitions.TXID.format = "hexString"

    swaggerSpec.definitions.ErrTy.nullable = true

    // manual additions over

    fs.writeFileSync('./swagger-docs.json', JSON.stringify(swaggerSpec, null, 2))

    console.log("Converted swagger-docs.json from JsonSchema to OpenAPI")
}


const fixPathParamDesc = (spec) => {
    R.map(path => {
        if (path.post) {
            R.map((param) => {
                if (param.name) {
                    param.description = getDescriptionFor(spec, param.name)
                }
            }, path.post.parameters)
        }
    }, spec.paths)
}


const getDescriptionFor = (spec, modelName) => {
    const defaultDesc = "No description available 😢"
    if (spec.definitions[modelName]) {
        return spec.definitions[modelName].description || defaultDesc
    }
    return defaultDesc
}



main()
