import { APIGatewayEvent, Callback, Context, Handler } from 'aws-lambda';
import { mkAsyncH, errResp, toJ, resp200, assertHaveParams, SvHandler } from './helpers';
import { isArray } from 'util';
import * as t from 'io-ts'
import { ThrowReporter } from 'io-ts/lib/ThrowReporter'


import { verifySignedBallotForProxy } from 'sv-lib/dist/ballotBox'


const ProxyVoteInputRT = t.type({
    democHash: t.string,
    extra: t.string,
    proxyReq: t.tuple([t.string, t.string, t.string, t.string, t.string]),
    ballotId: t.string
})

type ProxyVoteInput = t.TypeOf<typeof ProxyVoteInputRT>

const submitProxyVoteInner = async (event: ProxyVoteInput, context) => {
    ThrowReporter.report(ProxyVoteInputRT.decode(event))

    const {verified, address} = verifySignedBallotForProxy(event)

    // sanity check vote
    // - is the voter someone we expect? (note: need to account for delegates)
    // - are the ballotId and democHash compatible?
    // - will the tx succeed?

    return resp200({txid: "0x-not-done-yet", address})
}
export const submitProxyVote: Handler = mkAsyncH<ProxyVoteInput>(submitProxyVoteInner)


const Ed25519DelegationReqRT = t.type({

})
type Ed25519DelegationReq = t.TypeOf<typeof Ed25519DelegationReqRT>


const submitEd25519DelegaitonInner = async (event: Ed25519DelegationReq, context) => {
    ThrowReporter.report(Ed25519DelegationReqRT.decode(event))

    const from = "Stellar Addr goes here"
    const to = "0xEth address here"

    return resp200({txid: "0x---", from, to})
}
export const submitEd25519Delegaiton: Handler = mkAsyncH<Ed25519DelegationReq>(submitEd25519DelegaitonInner)
