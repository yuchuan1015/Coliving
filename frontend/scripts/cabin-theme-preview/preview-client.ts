// Public preview transport. No production token interceptors or storage access.
import axios from "axios";

const api = axios.create();
api.defaults.adapter = async () => { throw new Error("Preview transport is closed until fixtures are installed."); };
export const getAccessToken = () => null;
export function clearTokens() {}
export function setTokens(_access: string, _refresh: string): never { throw new Error("The preview cannot create a session."); }
export default api;
