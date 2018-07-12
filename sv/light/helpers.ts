import { Callback } from "../../node_modules/@types/aws-lambda";

export const mkAsync = async (f: () => Promise<string | number | boolean | object>, cb: Callback) =>
    f().then(v => cb(null, v)).catch(e => cb(e))
