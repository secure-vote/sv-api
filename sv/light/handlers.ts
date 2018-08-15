import { APIGatewayEvent, Callback, Context, Handler } from 'aws-lambda';
import { mkAsyncH, errResp, toJ, resp200, assertHaveParams, SvHandler, GenericResponse } from './helpers';
import * as t from 'io-ts'
import * as doc from 'dynamodb-doc';
import * as StellarBase from 'stellar-base';
import * as Eth from 'ethjs'

import { cleanEthHex } from 'sv-lib/lib/utils';
import { getNetwork } from 'sv-lib/lib/const'
import { ed25519DelegationIsValid, createEd25519DelegationTransaction, initializeSvLight, getSingularCleanAbi, isEd25519SignedBallotValid, checkBallotHashGBallot } from 'sv-lib/lib/light';
import { verifySignedBallotForProxy, mkPacked, mkSubmissionBits, flags, deployBallotSpec } from 'sv-lib/lib/ballotBox';
import { Bytes32, HexString, Bytes64, Bytes32RT, HexStringRT, Bytes64RT } from 'sv-lib/lib/runtimeTypes';
const Web3 = require('web3')

import * as websocket from 'websocket'  //workaround for build issue https://github.com/serverless-heaven/serverless-webpack/issues/223
import 'source-map-support/register'  // as above
import { SIGBREAK } from 'constants';

let nonceReserveTime;
let nonceUpdateTime;

/**
 * Takes a transaction object, determines the correct nonce to use and reserves it in the nonce DB
 * @param web3 instance
 * @param dynamoDb
 * @param tx
 * @param publishAddress
 * @returns {object} txWithNonce
 */
const determineAndReserveNonce = async (web3, dynamoDb, tx, publishAddress, nonceDbName) => {
    nonceReserveTime = new Date().getTime();
    console.log('Reserving the nonce', nonceReserveTime);
    const dbReqParams = {
        TableName: nonceDbName,
        KeyConditionExpression: 'publicAddress = :publicAddress',
        ConsistentRead: true,
        ExpressionAttributeValues: {
            ':publicAddress': publishAddress,
        },
        ScanIndexForward: false,
        Limit: 10
    }

    const dbData = await dynamoDb.query(dbReqParams).promise();
    console.log('dbData :', dbData);

    let nonceToUse;

    const ethNonce = await web3.eth.getTransactionCount(publishAddress);
    console.log('ethNonce :', ethNonce);

    if (dbData.Items.length != 0) {
        const highestDbNonce = dbData.Items[0];
        const _nextNonce = highestDbNonce.nonce + 1;
        nonceToUse = parseInt(_nextNonce < ethNonce ? ethNonce : _nextNonce)
        console.log('nonceToUse :', nonceToUse);
    } else {
        nonceToUse = ethNonce;
    }

    const txWithNonce = tx
    txWithNonce.nonce = nonceToUse

    const reserveNonceParams = {
        TableName: nonceDbName,
        Item: {
            publicAddress: publishAddress,
            nonce: nonceToUse,
            txHash: 'reserved',
            tx: txWithNonce
        }
    };
    const _reserveNonce = await dynamoDb.putItem(reserveNonceParams).promise();

    return txWithNonce
}

const updateNonceTxHash = async (dynamoDb, tx, signedTx, txHash, publishAddress, dbNonceName ) => {
    const { nonce } = tx
    console.log('Updating nonce tx hash', typeof nonce, nonce)
    const reserveNonceParams = {
        TableName: dbNonceName,
        Item: {
            publicAddress: publishAddress,
            nonce: parseInt(nonce),
            txHash: txHash,
            tx: tx,
            signedTx: signedTx
        }
    };

    const _updatedNonce = await dynamoDb.putItem(reserveNonceParams).promise();
    nonceUpdateTime = new Date().getTime();
    console.log('Updated the nonce', nonceUpdateTime);
    console.log(`Time between reserving and updating nonce is: ${(nonceUpdateTime - nonceReserveTime) / 1000} seconds `);
    return _updatedNonce;
}

const ProxyVoteInputRT = t.type({
    democHash: Bytes32RT,
    extra: HexStringRT,
    proxyReq: t.tuple([Bytes32RT, Bytes32RT, Bytes32RT, Bytes32RT, Bytes32RT]),
    ballotId: Bytes32RT,
    netConf: t.any
});
type ProxyVoteInput = t.TypeOf<typeof ProxyVoteInputRT>;

const submitProxyVoteInner = async (event: ProxyVoteInput, context) => {
    const testingPrivateKey = '0x6c992d3a3738114b53a06c57499b4710257c6f4cac531bdbb06afb54334d248d';
    const testingAddress = '0x1233832f5Ba901205474A0b2F407da6666aBfb08';

    // Destructure the variables that we need from the request
    const { extra, proxyReq, ballotId, netConf } = event
    const { httpProvider, unsafeEd25519DelegationAddr } = netConf;
    const svNetwork = await initializeSvLight(netConf, {useWebsockets: false})
    const { web3, index } = svNetwork
    console.log('proxyReq :', typeof proxyReq, proxyReq);
    console.log('extra :', extra);

    // Verify the signed ballot
    const {verified, address} = verifySignedBallotForProxy(event)
    if (!verified) { return errResp('Signed ballot cannot be verified') }

    // Initialise web3 and check for delegations
    // const getAllForAddressABI = getSingularCleanAbi('UnsafeEd25519DelegationAbi', 'getAllDelegatedToAddr'); // TODO once delegation abi is in this sv-lib method
    const getAllForAddressABI = [{"constant": true,"inputs": [{ "name": "delAddress", "type": "address" }],"name": "getAllDelegatedToAddr","outputs": [{ "name": "pubKeys", "type": "bytes32[]" }],"payable": false,"stateMutability": "view","type": "function"}]
    const delegationCheck = new web3.eth.Contract(getAllForAddressABI, unsafeEd25519DelegationAddr);
    const delegations = await delegationCheck.methods.getAllDelegatedToAddr(address).call()
    const delegationsExist = (delegations.length > 0)

    // If no delegations exist, return error response
    if (!delegationsExist) {
        return errResp(`No delegations exist for this address :${address}`);
    }

    // Get bbFarmAddress from namespace
    // const getBBFarmABI = [{ "constant": true, "inputs": [{ "name": "bbFarmId", "type": "uint8" }], "name": "getBBFarm", "outputs": [{ "name": "", "type": "address" }], "payable": false, "stateMutability": "view", "type": "function" }]
    // const indexAddress = '0xcad76eE606FB794dD1DA2c7E3C8663F648ba431d'; // TODO - svNetwork in sv-lib will make this redundant
    // const indexContract = new web3.eth.Contract(getBBFarmABI, indexAddress)
    const bbFarmNamespace = cleanEthHex(ballotId).slice(0, 8);
    console.log('bbFarmNamespace :', bbFarmNamespace);
    // const bbFarmAddress = await indexContract.methods.getBBFarm(`0x${bbFarmNamespace}`).call()
    const bbFarmAddress = await index.methods.getBBFarm(`0x${bbFarmNamespace}`).call()
    console.log('bbFarmAddress :', bbFarmAddress);

    // Get the voting network
    // TODO, get this from sv-lib
    const getVotingNetABI = [{"constant":true,"inputs":[],"name":"getVotingNetworkDetails","outputs":[{"name":"","type":"bytes32"}],"payable":false,"stateMutability":"view","type":"function"}]
    const bbFarmContract = new web3.eth.Contract(getVotingNetABI, bbFarmAddress);
    const networkDetails = await bbFarmContract.methods.getVotingNetworkDetails().call();

    // Explode foriegn network details
    // TODO - use sv-lib for this
    const chainId = parseInt(networkDetails.slice(10,18));
    const networkId = parseInt(networkDetails.slice(18, 26));
    const remoteBBFarmAddress = '0x' + networkDetails.slice(26);

    // Get the net conf and initialize variables of the bbfarm address
    const remoteNetConf = getNetwork(chainId, networkId);
    const remoteHttpProvider = remoteNetConf.httpProvider
    const remoteNetworkName = remoteNetConf.name
    const remoteWeb3 = new Web3(remoteHttpProvider)

    // Set up the contract to submit the proxy vote
    // TODO - make this more robust with sv-lib
    const submitProxyVoteABI = [{ constant: false, inputs: [{ name: 'proxyReq', type: 'bytes32[5]' }, { name: 'extra', type: 'bytes' }], name: 'submitProxyVote', outputs: [], payable: false, stateMutability: 'nonpayable', type: 'function' }];
    const remoteBBFarmContract = new remoteWeb3.eth.Contract(submitProxyVoteABI, remoteBBFarmAddress);
    const submitProxyVote = remoteBBFarmContract.methods.submitProxyVote(proxyReq, extra);
    const gasEstimate = await submitProxyVote.estimateGas()
    if (gasEstimate instanceof Error) {
        return errResp('Unable to estimate gas, this means the transaction will fail')
    }

    // Create the transaction object
    const tx = { to: remoteBBFarmAddress, gas: gasEstimate, data: submitProxyVote.encodeABI() };
    console.log('tx :', tx);

    // Check the nonce to use and reserve it
    const dynamoDb = new doc.DynamoDB();
    const nonceTrackerDB = `${remoteNetworkName}_${testingAddress}`;
    const txWithNonce = await determineAndReserveNonce(remoteWeb3, dynamoDb, tx, testingAddress, nonceTrackerDB);
    console.log('txWithNonce :', txWithNonce);

    // Sign the transaction
    const signedTx: any = await remoteWeb3.eth.accounts.signTransaction(txWithNonce, testingPrivateKey);
    console.log('signedTx :', signedTx);
    const { rawTransaction } = signedTx;

    // Send raw transaction with Eth-js (Ethjs is being used in favor of web3 here due to ethjs async call being resolved as soon as txId is returned)
    const eth = new Eth(new Eth.HttpProvider(remoteHttpProvider));
    const txId = await eth.sendRawTransaction(rawTransaction);
    const txLink = `${remoteNetConf.etherscanLink}tx/${txId}`;
    console.log('txId :', txId);

    // Update the nonce DB with the txId and transaction information
    await updateNonceTxHash(dynamoDb, tx, signedTx, txId, testingAddress, nonceTrackerDB)

    // Return the txId and etherscan link
    return resp200({txId, txLink, networkId, chainId})
}
export const submitProxyVote: Handler = mkAsyncH(submitProxyVoteInner, ProxyVoteInputRT)

const Ed25519DelegationReqRT = t.type({
    signature: Bytes64RT,
    publickey: t.string,
    packed: Bytes32RT,
    networkName: t.string,
    subgroupVersion: t.Integer
})
type Ed25519DelegationReq = t.TypeOf<typeof Ed25519DelegationReqRT>

const submitEd25519DelegationInner = async (event: Ed25519DelegationReq, context) => {
    // Testing variables - These will live seperately in the future
    const testingPrivateKey = '0x6c992d3a3738114b53a06c57499b4710257c6f4cac531bdbb06afb54334d248d';
    const testingAddress = '0x1233832f5Ba901205474A0b2F407da6666aBfb08';
    // Unpack what we need - TODO update this so it is based on a networkName
    const { signature, publickey, packed, networkName } = event

    const network = networkName === 'mainnet'
        ? { networkId: 1, chainId: 1 }
        : { networkId: 42, chainId: 42 }
    console.log('network :', network);
    const netConf = getNetwork(network.networkId, network.chainId)



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
    console.log(`packed: ${packed}, hexPubKey: ${hexPubKey}, sig1: ${sig1}, sig2: ${sig2}`);

    // Use the API snippet to generate the function bytecode
    const { httpProvider, unsafeEd25519DelegationAddr, etherscanLink, name } = netConf;
    const addUntrustedSelfDelegationABI = [{ constant: false, inputs: [{ name: 'dlgtRequest', type: 'bytes32' }, { name: 'pubKey', type: 'bytes32' }, { name: 'signature', type: 'bytes32[2]' }], name: 'addUntrustedSelfDelegation', outputs: [], payable: false, stateMutability: 'nonpayable', type: 'function' }];
    // const inputByteCode = EthAbi.encodeMethod(addUntrustedSelfDelegationABI[0], [packed, hexPubKey, [sig1, sig2]]) // This was the method used when using Ethjs - keeping until web3 version is working

    const web3 = new Web3(httpProvider);
    const delegationContract = new web3.eth.Contract(addUntrustedSelfDelegationABI, unsafeEd25519DelegationAddr)
    const addUntrustedSelfDelegation = delegationContract.methods.addUntrustedSelfDelegation(packed, hexPubKey, [sig1, sig2])

    // const tx = prepareTransaction(addUntrustedSelfDelegation, unsafeEd25519DelegationAddr)
    const gasEstimate = await addUntrustedSelfDelegation.estimateGas();
    if (gasEstimate instanceof Error) {
        return errResp('Unable to estimate gas, this means the transaction will fail')
    }

    const tx = { to: unsafeEd25519DelegationAddr, gas: gasEstimate, data: addUntrustedSelfDelegation.encodeABI() };
    console.log('tx :', tx);

    const nonceTableName = `${name}_${testingAddress}`
    console.log('nonceTableName :', nonceTableName);
    const dynamoDb = new doc.DynamoDB();
    const txWithNonce = await determineAndReserveNonce(web3, dynamoDb, tx, testingAddress, nonceTableName);
    console.log('txWithNonce :', txWithNonce);

    // Sign and send TX
    const signedTx: any = await web3.eth.accounts.signTransaction(txWithNonce, testingPrivateKey);
    const { rawTransaction } = signedTx;
    console.log('rawTransaction :', rawTransaction);

    // Send raw transaction with Eth-js (Ethjs is being used in favor of web3 here due to ethjs async call being resolved as soon as txId is returned)
    const eth = new Eth(new Eth.HttpProvider(httpProvider));
    const txId = await eth.sendRawTransaction(rawTransaction);
    console.log('txId :', txId);

    await updateNonceTxHash(dynamoDb, tx, signedTx, txId, testingAddress, nonceTableName);
    const txLink = `${etherscanLink}tx/${txId}`;

    return resp200({ txId, txLink, from: publickey, to: packed, ...network });
}
export const submitEd25519Delegation: Handler = mkAsyncH(submitEd25519DelegationInner, Ed25519DelegationReqRT)


const ProxyProposalInputRT = t.type({
    ballotSpec: t.string,
    democHash: t.string,
    startTime: t.Integer,
    endTime: t.Integer,
    networkName: t.string
})
type ProxyProposalInput = t.TypeOf<typeof ProxyProposalInputRT>


const submitProxyProposalInner = async (event: ProxyProposalInput, context) => {
    // Testing variables
    const testingPrivateKey = '0x6c992d3a3738114b53a06c57499b4710257c6f4cac531bdbb06afb54334d248d';
    const testingAddress = '0x1233832f5Ba901205474A0b2F407da6666aBfb08';

    // Destructure what we need from the request
    const { ballotSpec, democHash, startTime, endTime, networkName } = event;
    console.log(ballotSpec, democHash, startTime, endTime, networkName);

    // First, we check the ballot spec to ensure the delegation is valid
    if (!isEd25519SignedBallotValid(ballotSpec)) {
        return errResp('Signature is not valid');
    }

    // Setup the network variables we need for testnet vs mainnet
    // This is hard coded at the moment, we will use the test net for anything that isn't declared as mainnet
    const network = networkName === 'mainnet'
        ? { networkId: 1, chainId: 1 }
        : { networkId: 42, chainId: 42 }
    const netConf = getNetwork(network.networkId, network.chainId)
    const { httpProvider, archivePushUrl, etherscanLink } = netConf;

    // Deploy the ballotspec to IPFS and S3 backup
    const ballotHash = await deployBallotSpec(archivePushUrl, ballotSpec);
    console.log('ballotHash :', ballotHash);

    // TODO - simplify this once sv-lib is updated... const { index } = svNetwork
    const web3: any = new Web3(httpProvider);
    const indexAddress = '0xcad76ee606fb794dd1da2c7e3c8663f648ba431d';
    const deployBallotABI = getSingularCleanAbi('IndexAbi', 'dDeployBallot');
    console.log('deployBallotABI :', deployBallotABI);

    const _deployBallotABI = [{ constant: false, inputs: [{ name: 'democHash', type: 'bytes32' }, { name: 'specHash', type: 'bytes32' }, { name: 'extraData', type: 'bytes32' }, { name: 'packed', type: 'uint256' }], name: 'dDeployBallot', outputs: [], payable: true, stateMutability: 'payable', type: 'function' }];
    const index = new web3.eth.Contract(_deployBallotABI, indexAddress);

    // Prepare deploy ballot function arguments
    const { USE_ETH, USE_SIGNED, USE_NO_ENC, USE_ENC, IS_BINDING, IS_OFFICIAL, USE_TESTING } = flags;
    const submissionBits = mkSubmissionBits(USE_ETH, USE_NO_ENC);
    const packed = mkPacked(startTime, endTime, submissionBits).toString()
    console.log(`Submission bits: ${submissionBits}. Start time: ${startTime}. End time: ${endTime}.... Packed ${packed}`);

    // Using the first byte of extra data to use this BB farm ID
    // TODO - Do this based on api call inputs?
    const extraData = '0x01'

    // Set up the method and encode the tx data
    const dDeployBallot = index.methods.dDeployBallot(democHash, ballotHash, extraData, packed);
    const txData = dDeployBallot.encodeABI();

    // const gasEstimate = await dDeployBallot.estimateGas().then(gas => { return gas; }).catch(error => { return error; });
    // if (gasEstimate instanceof Error) {
    //     return errResp('Unable to estimate gas');
    // }

    const tx = {
        to: indexAddress,
        gas: 500000, // Adding gas manually right now because the estimate gas function seems to revert (possibly on the onlyDemocEditor?)
        data: txData
    };
    console.log('tx :', tx);

    const dynamoDb = new doc.DynamoDB();
    const nonceTrackerDB = `${netConf.name}_${testingAddress}`;
    const txWithNonce = await determineAndReserveNonce(web3, dynamoDb, tx, testingAddress, nonceTrackerDB);
    console.log('txWithNonce :', txWithNonce);

    // Sign and send TX
    const signedTx: any = await web3.eth.accounts.signTransaction(txWithNonce, testingPrivateKey);
    const { rawTransaction } = signedTx;
    console.log('rawTransaction :', rawTransaction);

    // return await web3.eth.sendSignedTransaction(rawTransaction)
    //     .then(r => {
    //         console.log('Sending signed transaction was successful. Response:', r)
    //         return resp200(r.transactionHash)
    //     })
    //     // .once('transactionHash', hash => { return resp200(hash) })
    //     // .on('error', e => { return errResp(e) })
    //     .catch(e => { return errResp(e) });

    // // Send raw transaction with Eth-js (Ethjs is being used in favor of web3 here due to ethjs async call being resolved as soon as txId is returned)
    const eth = new Eth(new Eth.HttpProvider(httpProvider));
    const txId = await eth.sendRawTransaction(rawTransaction);
    const txLink = `${etherscanLink}tx/${txId}`

    await updateNonceTxHash(dynamoDb, txWithNonce, signedTx, txId, testingAddress, nonceTrackerDB);

    return resp200({ txId, txLink, ...network });
};
export const submitProxyProposal: Handler = mkAsyncH(submitProxyProposalInner, ProxyProposalInputRT)
