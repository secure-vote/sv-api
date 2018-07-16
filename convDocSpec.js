#!/usr/bin/env node

const toOpenApi = require('json-schema-to-openapi-schema');

const fs = require('fs')
const R = require('ramda')
const YAML = require('yaml').default

const main = () => {
    const origDocs = YAML.parse(fs.readFileSync('./sls-documentation.yml').toString())
    const swaggerSpec = JSON.parse(fs.readFileSync('./swagger-docs.json'))
    const packageJson = JSON.parse(fs.readFileSync('./package.json'))

    console.log(swaggerSpec)

    swaggerSpec.definitions = R.map(schema => toOpenApi(schema), swaggerSpec.definitions)

    swaggerSpec.info.title = packageJson.docs.title
    swaggerSpec.info.version = packageJson.version

    console.log(origDocs.documentation.models)
    console.log(swaggerSpec.definitions)
    R.mapObjIndexed((model, _name) => {
        const _m = R.compose(R.head, R.filter(({name}) => name == _name))(origDocs.documentation.models)
        console.log(_name, _m, model)
        if (_m) {
            ['pattern', 'format', 'example'].map(i => { if(_m[i]) { model[i] = _m[i] }})
            console.log(model)
        }
    }, swaggerSpec.definitions)


    // swaggerSpec.definitions.TXID = swaggerSpec.definitions.TXID || {}
    // swaggerSpec.definitions.TXID.pattern = "/^0x([0-9a-fA-F]{2})*$/"
    // swaggerSpec.definitions.TXID.minLength = 66
    // swaggerSpec.definitions.TXID.maxLength = 66
    // swaggerSpec.definitions.TXID.format = "hexString"

    // swaggerSpec.definitions.ErrTy.nullable = true

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
