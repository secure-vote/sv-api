import { APIGatewayEvent, Callback, Context, Handler } from 'aws-lambda';
import { mkAsyncH, errResp, toJ, resp200, assertHaveParams, SvHandler } from './helpers';
import { isArray } from 'util';
import * as t from 'io-ts'
import { ThrowReporter } from 'io-ts/lib/ThrowReporter';

import * as doc from 'dynamodb-doc';
import * as StellarBase from 'stellar-base';
import * as Eth from 'ethjs'
import * as EthAbi from 'ethjs-abi'
import * as EthSign from 'ethjs-signer'
import * as sha256 from 'sha256'

import { getNetwork } from 'sv-lib/lib/const'
import { ed25519DelegationIsValid, createEd25519DelegationTransaction, initializeSvLight } from 'sv-lib/lib/light';
// import { toEthHex } from 'sv-lib/lib/utils';
// import * as API from 'sv-lib/lib/api';
import { verifySignedBallotForProxy } from 'sv-lib/lib/ballotBox';
// import { t.string, t.string, Bytes64RT } from 'sv-lib/lib/runtimeTypes';
const btoa = require('btoa')
const axios = require('axios')



const ProxyVoteInputRT = t.type({
    democHash: t.string,
    extra: t.string,
    proxyReq: t.tuple([t.string, t.string, t.string, t.string, t.string]),
    ballotId: t.string
});
type ProxyVoteInput = t.TypeOf<typeof ProxyVoteInputRT>

const submitProxyVoteInner = async (event: ProxyVoteInput, context) => {
    const {verified, address} = verifySignedBallotForProxy(event)

    // sanity check vote
    // - is the voter someone we expect? (note: need to account for delegates)
    // - are the ballotId and democHash compatible?
    // - will the tx succeed?

    return resp200({txid: '0x-not-done-yet', address})
}
export const submitProxyVote: Handler = mkAsyncH(submitProxyVoteInner, ProxyVoteInputRT)


const Ed25519DelegationReqRT = t.type({
    signature: t.string,
    publickey: t.string,
    packed: t.string,
    subgroupVersion: t.Integer
})
type Ed25519DelegationReq = t.TypeOf<typeof Ed25519DelegationReqRT>

const submitEd25519DelegationInner = async (event: Ed25519DelegationReq, context) => {
    // Testing variables - These will live seperately in the future
    const networkId = 42;
    const chainId = 1;
    const testingPrivateKey = '0x6c992d3a3738114b53a06c57499b4710257c6f4cac531bdbb06afb54334d248d';
    const testingAddress = '0x1233832f5Ba901205474A0b2F407da6666aBfb08';
    const testingGasPrice = 20000000000;

    const svConfig = await getNetwork(networkId, chainId);
    const { signature, publickey, packed } = event
    console.log('signature :', signature);
    console.log('publickey :', publickey);
    console.log('packed :', packed);


    const isValidPublicKey = StellarBase.StrKey.isValidEd25519PublicKey(publickey)
    if (!isValidPublicKey) {
        return errResp('Not a valid public key');
    }

    // Validate delegation is valid
    const isValidSignature = ed25519DelegationIsValid(packed, publickey, signature);
    if (!isValidSignature) {
        return errResp('Signature is not valid');
    }

    // Get the hex of the public key
    const kp = StellarBase.Keypair.fromPublicKey(publickey)
    const rawPubKey = kp.rawPublicKey()
    const hexPubKey = '0x' + rawPubKey.toString('hex');

    // Split the 64 bytes of the signature into an array containging 2x t.string
    const sig1 = signature.substring(0, 66)
    const sig2 = `0x${signature.substring(66)}`

    // Use the API snippet to generate the function bytecode
    const addUntrustedSelfDelegationABI = [{ constant: false, inputs: [{ name: 'dlgtRequest', type: 't.string' }, { name: 'pubKey', type: 't.string' }, { name: 'signature', type: 't.string[2]' }], name: 'addUntrustedSelfDelegation', outputs: [], payable: false, stateMutability: 'nonpayable', type: 'function' }];
    const inputByteCode = EthAbi.encodeMethod(addUntrustedSelfDelegationABI[0], [packed, hexPubKey, [sig1, sig2]])

    console.log('packed :', packed);
    console.log('hexPubKey :', hexPubKey);
    console.log('sig1 :', sig1);
    console.log('sig2 :', sig2);

    // Create an instance of eth-js
    const { httpProvider, unsafeEd25519DelegationAddr } = svConfig;
    const eth = new Eth(new Eth.HttpProvider(httpProvider));
    const sign = EthSign.sign

    // Get the nonce - This needs to be improved to prevent race conditions...
    const ethTxCount = await eth.getTransactionCount(testingAddress).catch(e => {
        return errResp(e);
    });
    const dynamoDb = new doc.DynamoDB();

    const getDbNonceData = (address: string) => {
        return new Promise((resolve, reject) => {
            const params = {
                TableName: 'address_nonces',
                KeyConditionExpression: 'publicAddress = :publicAddress',
                ConsistentRead: true,
                ExpressionAttributeValues: {
                    ':publicAddress': address,
                },
                ScanIndexForward: false,
                Limit: 10
            }
            dynamoDb.query(params, function (err, data) {
                if (err) {
                    console.log('err :', err);
                    reject(err);
                } else {
                    console.log('Query succeeded.', data);
                    resolve(data);
                }
            });
        });
    }

    const putDbItem = async (itemToPut: any) => {
        dynamoDb.putItem(itemToPut, function(err, data) {
            if (err) {
                console.log('Got error putting item')
                return err;
            } else {
                return 'success'
            }
        });
    }

    const reserveNonceAndSendTx = async (nonce: number) => {
        const signedTx = sign({ to: unsafeEd25519DelegationAddr, gas: 300000, gasPrice: testingGasPrice, nonce: nonce, data: inputByteCode }, testingPrivateKey);
        const reserveNonceParams = {
            TableName: 'address_nonces',
            Item: {
                publicAddress: testingAddress,
                nonce: nonce,
                txHash: 'reserved',
                packed: packed,
                signature: signature,
                publicKey: publickey,
                signedTx: signedTx
            }
        };
        const _reserveNonce:any = await putDbItem(reserveNonceParams);
        if (_reserveNonce instanceof Error) {
            return _reserveNonce;
        }
        const txHash = await eth.sendRawTransaction(signedTx);
        reserveNonceParams.Item.txHash = txHash;
        const _updateNonce:any = await putDbItem(reserveNonceParams);
        if (_updateNonce instanceof Error) {
            return _updateNonce;
        }

        return txHash;
    }

    // Get the info from the database
    const dbData:any = await getDbNonceData(testingAddress)
    if (dbData instanceof Error) {
        return errResp('Failed to check nonce in database');
    }

    const highestNonceItem:any = dbData.Items[0];
    console.log(`Highest nonce recorded in DB is ${highestNonceItem.nonce}, ethTxCount is ${ethTxCount}`)

    const ethNonce = ethTxCount.toNumber();
    const _nextNonce = highestNonceItem.nonce + 1
    const nonceToUse = _nextNonce < ethNonce ? ethNonce : _nextNonce

    const txHash = await reserveNonceAndSendTx(nonceToUse).catch(e => errResp('Error reserving nonce and sending TX'));

    return resp200({ txid: txHash, from: publickey, to: packed });
}
export const submitEd25519Delegation: Handler = mkAsyncH(submitEd25519DelegationInner, Ed25519DelegationReqRT)


const ProxyProposalInputRT = t.type({
    ballotSpec: t.string,
    democHash: t.string,
    startTime: t.Integer,
    endTime: t.Integer,
    networkId: t.string
})
type ProxyProposalInput = t.TypeOf<typeof ProxyProposalInputRT>


const submitProxyProposalInner = async (event: ProxyProposalInput, context) => {
    // Check contents of ballot
    const { ballotSpec, democHash, startTime, endTime, networkId } = event;
    console.log(ballotSpec, democHash, startTime, endTime, networkId);

    const ballotHash = `0x${sha256(ballotSpec)}`
    const ballotBase64 = btoa(unescape(encodeURIComponent(ballotSpec)))
    const archivePushUrl = 'https://archive.test.push.secure.vote/';

    const { data } = axios.post(
        archivePushUrl,
        {
            ballotBase64: ballotBase64, assertSpecHash: ballotHash
        },
        {
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': 'UmNrB7cifZ2N1LlnyM4RXK1xuK2VpIQaamgmlSBb'
            }
        }
    ).catch(error => console.log(error))

    if (data !== ballotHash) {
        return errResp('Invalid response from ballot archive');
    }


    // Get additional data + etc


    // Sign TX


    // Send tx

    return resp200({ ballotHash: ballotHash });
}
export const submitProxyProposal: Handler = mkAsyncH(submitProxyProposalInner, ProxyProposalInputRT)