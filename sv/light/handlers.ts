import { APIGatewayEvent, Callback, Context, Handler } from 'aws-lambda';
import { mkAsyncH, errResp, toJ, resp200, assertHaveParams, SvHandler } from './helpers';
import { isArray } from 'util';
import * as t from 'io-ts'
import { ThrowReporter } from 'io-ts/lib/ThrowReporter'


import { verifySignedBallotForProxy } from 'sv-lib/lib/ballotBox'
import { Bytes32, HexString, Bytes64 } from 'sv-lib/lib/runtimeTypes';


const ProxyVoteInputRT = t.type({
    democHash: Bytes32,
    extra: HexString,
    proxyReq: t.tuple([Bytes32, Bytes32, Bytes32, Bytes32, Bytes32]),
    ballotId: Bytes32
})
type ProxyVoteInput = t.TypeOf<typeof ProxyVoteInputRT>

const submitProxyVoteInner = async (event: ProxyVoteInput, context) => {
    const {verified, address} = verifySignedBallotForProxy(event)

    // sanity check vote
    // - is the voter someone we expect? (note: need to account for delegates)
    // - are the ballotId and democHash compatible?
    // - will the tx succeed?

    return resp200({txid: "0x-not-done-yet", address})
}
export const submitProxyVote: Handler = mkAsyncH(submitProxyVoteInner, ProxyVoteInputRT)


const Ed25519DelegationReqRT = t.type({
    signature: Bytes64,
    publickey: Bytes32,
    packed: Bytes32,
    subgroupVersion: t.Integer
})
type Ed25519DelegationReq = t.TypeOf<typeof Ed25519DelegationReqRT>

const submitEd25519DelegationInner = async (event: Ed25519DelegationReq, context) => {
    // todo: validate ed25519 signature (reconstructing signed blob if needed)

    // return the SETLLAR encoded PK
    const from = "Stellar Addr goes here"
    // return ethereum address as in data packed
    const to = "0xEth address here"

    // do ethereum classic transaction (or tx based on )

    return resp200({txid: "0x---", from, to})
}
export const submitEd25519Delegation: Handler = mkAsyncH(submitEd25519DelegationInner, Ed25519DelegationReqRT)
