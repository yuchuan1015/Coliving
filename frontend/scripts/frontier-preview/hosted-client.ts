// Compile-time replacement; no Axios instance, auth tokens or requests.
const unavailable = async (): Promise<never> => { throw new Error("此導覽預覽不連接 API。"); };
export default { get: unavailable, post: unavailable, patch: unavailable, delete: unavailable, request: unavailable };
