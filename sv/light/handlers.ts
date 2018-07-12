import { APIGatewayEvent, Callback, Context, Handler } from 'aws-lambda';
import { mkAsync } from './helpers';

export const submitProxyVote: Handler = (event: APIGatewayEvent, context: Context, cb: Callback) => {
    mkAsync(async () => {

        return {
            statusCode: 200,
            body: JSON.stringify({message: 'hi', event, context})
        }
    }, cb)
}
