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

    return resp200({txid: '0x-not-done-yet', address})
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

    // Split the 64 bytes of the signature into an array containging 2x bytes32
    const sig1 = signature.substring(0, 66)
    const sig2 = `0x${signature.substring(66)}`

    // Use the API snippet to generate the function bytecode
    const addUntrustedSelfDelegationABI = [{ constant: false, inputs: [{ name: 'dlgtRequest', type: 'bytes32' }, { name: 'pubKey', type: 'bytes32' }, { name: 'signature', type: 'bytes32[2]' }], name: 'addUntrustedSelfDelegation', outputs: [], payable: false, stateMutability: 'nonpayable', type: 'function' }];
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

    const getDbNonceData = async (address: string) => {
        return new Promise((resolve, reject) => {
            // Get from the DB
            const params = {
                TableName: 'address_nonces',
                KeyConditionExpression: 'publicAddress = :publicAddress',
                ConsistentRead: true,
                ExpressionAttributeValues: {
                    ':publicAddress': address,
                },
                ScanIndexForward: false,
                Limit: 1
            }
            let respData = {}
            dynamoDb.query(params, function (err, data) {
                if (err) {
                    console.log('err :', err);
                    reject(err)
                } else {
                    console.log('Query succeeded.', data);
                    resolve(data)
                }
            });
        });
    }

    const putDbItem = async (itemToPut: any) => {
        return new Promise((resolve, reject) => {
            dynamoDb.putItem(itemToPut, function(err, data) {
                if (err) {
                    reject(err);
                } else {
                    resolve('success');
                }
            });
        });
    }

    // Get the info from the database
    const dbData:any = await getDbNonceData(testingAddress)
    if (dbData instanceof Error) {
        return errResp('Failed to check nonce in database');
    }

    const highestNonceItem:any = dbData.Items[0];
    console.log(`Highest nonce recorded in DB is ${highestNonceItem.nonce}, ethTxCount is ${ethTxCount}`)

    const ethNonce = ethTxCount.toNumber();
    const dbNonce = highestNonceItem.nonce
    console.log('ethNonce :', ethNonce);
    console.log('typeof', typeof ethNonce, typeof dbNonce);

    switch (true) {
        case dbNonce + 1 == ethNonce: // Expected case, the last recorded nonce in the DB should be 1 less than the ethNonce
            // Reserve the nonce in the DB
            const putItemParams = { Item: { publicAddress: testingAddress, nonce: ethNonce, txHash: 'reserved' }, TableName: 'address_nonces' };
            const putItem = await putDbItem(putItemParams);
            if (putItem instanceof Error) {
                return errResp('Failed to put pending tx into database');
            }

            const txHash = await eth.sendRawTransaction(sign({ to: unsafeEd25519DelegationAddr, gas: 300000, gasPrice: testingGasPrice, nonce: ethNonce, data: inputByteCode }, testingPrivateKey)).catch(e => {
                return errResp(e);
            });

            // Update the putItemParams with the txHash and put it back in the DB
            putItemParams.Item.txHash = txHash
            const putUpdatedItem = await putDbItem(putItemParams);

            // Once it's updated, return with 200 response
            if (putUpdatedItem == 'success') {
                return resp200({ txid: txHash, from: publickey, to: packed });
            }
            break;
        case dbNonce >= ethNonce: // This case should occur when there are pending transactions, or transactions have failed
            // Needs the most interrogation
            const highestTxHash = highestNonceItem.txHash
            if (highestTxHash == 'pending') { // Transaction has been recorded as pending - Need to assume this is the case and that the transaction will go through...

            } else if (highestTxHash.length == 66 && highestTxHash.slice(0, 2) == '0x') { // Check to see how it ended up?
                // Todo..
                const tx = await eth.getTransactionSuccess(highestTxHash)
                console.log('TX Successs...', tx)

                switch (true) {
                    case tx.status == '0x0':
                    break;
                    case tx.status == '0x1':
                    break;
                    default:
                    break;
                }
            } else {
                return errResp('Seems to be invalid transactons');
            }
            break;
        case dbNonce < ethNonce: // This case shouldn't really occur - only if the address has made some other transactions
            // Reserve the nonce in the db according to
            return errResp('DB nonce and recorded eth transactions in an invalid state. This error should not occur.');
            //

            break;
        default:
            return errResp('DB nonce and recorded eth transactions in an invalid state. This error should not occur.');
            break;
    }


    return resp200(dbData)

    // const highestDbNonce = 'tbc'

    // // Compare and assign appropriate value



    // console.log('nonce :', nonce);


}
export const submitEd25519Delegation: Handler = mkAsyncH(submitEd25519DelegationInner, Ed25519DelegationReqRT)
