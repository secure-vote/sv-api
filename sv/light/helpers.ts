import { APIGatewayEvent, Callback, Context, Handler } from 'aws-lambda';

export const toJ = doc => JSON.stringify(doc, null, 2)

export const errResp = (str, extraProps = {}) => ({...extraProps, statusCode: 400, body: {error: str}})

export const resp200 = (doc, extraProps = {}) => ({...extraProps, statusCode: 200, body: doc})


export const assertHaveParams = (event, params: string[]) => {
    params.map(p => {
        if (!event[p]) {
            throw Error("Required params: " + params.join(', '))
        }
    })
}

export type SvHandler<T> = <T>(event: T, context: Context) => Promise<string | number | boolean | object | any>

export const mkAsyncH = <T>(f: SvHandler<T>): ((event: APIGatewayEvent | T, context: Context, cb: Callback) => void) =>
    function(event: APIGatewayEvent | T, context, cb) {
        const params = (<APIGatewayEvent>event).body ? <T>JSON.parse((<APIGatewayEvent>event).body) : <T>event
        f(params, context).then(v => cb(null, v)).catch((err: Error) => cb(null, errResp(err.message)))
    }
