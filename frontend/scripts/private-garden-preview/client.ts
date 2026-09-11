// Every production HTTP import resolves here. No transport, credentials or token storage.
const unavailable = async (): Promise<never> => { throw Error("Isolated private garden: real API disabled"); };
export default { get: unavailable, post: unavailable, patch: unavailable, delete: unavailable, request: unavailable };
