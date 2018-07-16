import { isObject } from 'ramda'
import { APIGatewayEvent, Callback, Context, Handler } from 'aws-lambda';
import { mkAsyncH, errResp, toJ, resp200, assertHaveParams, SvHandler } from './helpers';
import { isArray } from 'util';


type ProxyVoteInput = {
    democHash: string,
    extra: string,
    proxyVoteReq: string[],
    ballotId: string
}


const submitProxyVoteInner = async (event, context) => {
    console.log("started", event)

    assertHaveParams(event, ["democHash", "extra", "proxyVoteReq", "ballotId"])
    if (!isArray(event.proxyVoteReq) || event.proxyVoteReq.length != 5) {
        throw Error("proxyVoteReq is invalid.")
    }

    return resp200(event)
}
export const submitProxyVote: Handler = mkAsyncH<ProxyVoteInput>(submitProxyVoteInner)
