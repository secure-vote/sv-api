console.log('at least this shows up right?')

// import { isObject } from 'ramda'
import { APIGatewayEvent, Callback, Context, Handler } from 'aws-lambda';
import { mkAsyncH, errResp, toJ, resp200, assertHaveParams, SvHandler } from './helpers';
import { isArray } from 'util';

console.log('loaded stuff that used to work')

import { verifySignedBallotForProxy } from 'sv-lib/dist/ballotBox'

console.log('loaded all')

type ProxyVoteInput = {
    democHash: string,
    extra: string,
    proxyReq: [string, string, string, string, string],
    ballotId: string
}


const submitProxyVoteInner = async (event: ProxyVoteInput, context) => {
    assertHaveParams(event, ["democHash", "extra", "proxyReq", "ballotId"])
    if (!isArray(event.proxyReq) || event.proxyReq.length != 5) {
        throw Error("proxyReq is invalid.")
    }

    const {verified, address} = verifySignedBallotForProxy(event)

    return resp200({txid: "0x-not-done-yet", address})
}
export const submitProxyVote: Handler = mkAsyncH<ProxyVoteInput>(submitProxyVoteInner)
