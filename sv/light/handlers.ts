import { APIGatewayEvent, Callback, Context, Handler } from 'aws-lambda';
import { mkAsyncH, errResp, toJ, resp200, assertHaveParams, SvHandler } from './helpers';
import { isArray } from 'util';
import * as t from 'io-ts'
import { ThrowReporter } from 'io-ts/lib/ThrowReporter'

// import * as StellarBase from 'stellar-base'
import * as Eth from 'ethjs'
import * as EthAbi from 'ethjs-abi'
import * as EthSign from 'ethjs-signer'
import { getNetwork } from 'sv-lib/lib/const'
import { ed25519DelegationIsValid, createEd25519DelegationTransaction, initializeSvLight } from 'sv-lib/lib/light';
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
    publickey: t.string,
    packed: Bytes32,
    subgroupVersion: t.Integer
})
type Ed25519DelegationReq = t.TypeOf<typeof Ed25519DelegationReqRT>

const submitEd25519DelegationInner = async (event: Ed25519DelegationReq, context) => {
    const { signature, publickey, packed } = event

    // Validate delegation is valid
    const isValid = ed25519DelegationIsValid(packed, publickey, signature);

    if (!isValid) {
        throw new Error('Signature does not seem to be valid')
    }

    // Initialise SV light
    const networkId = 42;
    const chainId = 1;
    const privKey = "not required?";
    const testingPrivateKey = '0x6c992d3a3738114b53a06c57499b4710257c6f4cac531bdbb06afb54334d248d';
    const testingAddress = '0x1233832f5Ba901205474A0b2F407da6666aBfb08';

    const svConfig = await getNetwork(networkId, chainId);
    console.log('svConfig :', svConfig);


    // Get the hex of the public key
    const StellarBase = require('stellar-base')
    const kp = StellarBase.Keypair.fromPublicKey(publickey)
    const rawPubKey = kp.rawPublicKey()
    const hexPubKey = '0x' + rawPubKey.toString('hex');

    // Split the 64 bytes of the signature into an array containging 2x bytes32
    const sig1 = signature.substring(0, 66)
    const sig2 = `0x${signature.substring(66)}`

    // Use the API snippet to generate the function bytecode
    const addUntrustedSelfDelegationABI = [{"inputs": [{"type": "bytes32"},{"type": "bytes32"},{"type": "bytes32[2]"}],}]

    const inputByteCode = EthAbi.encodeMethod(addUntrustedSelfDelegationABI[0], [packed, hexPubKey, [sig1, sig2]])

    // Create an instance of eth-js
    const { httpProvider, unsafeEd25519DelegationAddr } = svConfig;
    const eth = new Eth(new Eth.HttpProvider(httpProvider));
    const sign = EthSign.sign

    // Get the nonce
    const nonce = await eth.getTransactionCount(testingAddress)
        .catch(e => { throw e })

    // Sign and send the transaction
    const txHash = await eth.sendRawTransaction(sign({ to: unsafeEd25519DelegationAddr, value: '0', gas: 500000, nonce: nonce, data: inputByteCode }, testingPrivateKey))
        .catch(e => { throw e })

    return resp200({ txid: txHash, from: publickey, to: packed })
}
export const submitEd25519Delegation: Handler = mkAsyncH(submitEd25519DelegationInner, Ed25519DelegationReqRT)
