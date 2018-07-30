import { APIGatewayEvent, Callback, Context, Handler } from "aws-lambda";
import * as R from "ramda";
import { isString } from "util";
import { InterfaceType } from "io-ts";
import { failure } from "io-ts/lib/PathReporter"

export const toJ = doc => JSON.stringify(doc, null, 2);

export const errResp = (str, extraProps = {}) => ({ ...extraProps, statusCode: 400, body: toJ({ error: str }) });

export const errWrap = (common) => (str, extraProps = {}) => errResp(`${common}: ${toJ(str)}`, extraProps)

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

export const mkAsyncH = <T, RTT>(f: SvHandler<T>, rtType: InterfaceType<RTT, T, T>): ((event: APIGatewayEvent | T, context: Context, cbRaw: Callback) => void) =>
    function(event: APIGatewayEvent | T, context, cbRaw) {
        console.log("FUNCTION STARTED")
        // parse the body as the expected type
        const parsedEvent: T = (<APIGatewayEvent>event).body ? <T>JSON.parse((<APIGatewayEvent>event).body) : <T>event;
        // decode via io-ts to validate type
        const decodedEvent = rtType.decode(parsedEvent)

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

        const onBadDecode = validationErrs => {
            const errs = failure(validationErrs)
            console.log("Validation Error", errs)
            cb(null, errResp(errs)) //${R.mapObjIndexed((v,k) => `${v} (type: ${k})`, ve.type.props)}
        }

        const onGoodDecode = e => f(e, context)
            .then(v => cb(null, v))
            .catch((err: Error) => {
                try {
                    console.log("Error thrown during handler", err)
                    cb(null, errResp(err.message || err))
                } catch (__e) {
                    console.warn("Error thrown while handling another Error. Second error: ", __e.message)
                    throw err;
                }
            })

        // run the handler
        decodedEvent.fold(onBadDecode, onGoodDecode)
    };
