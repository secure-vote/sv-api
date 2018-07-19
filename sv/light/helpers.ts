import { APIGatewayEvent, Callback, Context, Handler } from "aws-lambda";
import * as R from "ramda";

export const toJ = doc => JSON.stringify(doc, null, 2);

export const errResp = (str, extraProps = {}) => ({ ...extraProps, statusCode: 400, body: toJ({ error: str }) });

export const resp200 = (doc, extraProps = {}) => ({ ...extraProps, statusCode: 200, body: toJ(doc) });

export const assertHaveParams = (event, params: string[]) => {
    params.map(p => {
        if (!(p in event)) {
            throw Error(`Required param: ${p} not found; value found: ${event[p]}; instead got object ${toJ(event)}`);
        }
    });
};

export type GenericResponse = { statusCode: number; body: string; headers?: { [hdr: string]: string }; [k: string]: any };

export type SvHandler<T> = (event: T, context: Context) => Promise<GenericResponse>;

export const mkAsyncH = <T>(f: SvHandler<T>): ((event: APIGatewayEvent | T, context: Context, cbRaw: Callback) => void) =>
    function(event: APIGatewayEvent | T, context, cbRaw) {
        console.log("FUNCTION STARTED")
        // parse the body as the expected type
        const params: T = (<APIGatewayEvent>event).body ? <T>JSON.parse((<APIGatewayEvent>event).body) : <T>event;

        // cb middleware to add CORS headers
        const cb = (e, v) => {
            console.log("CB TRIGGERED", e, v)
            if (e) {
                console.log(e, e.message)
                return cbRaw(e);
            }
            v.headers = R.merge(v.headers || {}, {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Credentials": true
            });
            console.log(v);
            return cbRaw(null, v);
        };

        // run the handler
        f(params, context)
            .then(v => cb(null, v))
            .catch((err: Error) => {
                try {
                    cb(null, errResp(err.message))
                } catch (__e) {
                    console.warn("Error thrown while handling another Error. Second error: ", __e.message)
                    throw err;
                }
            })
    };
