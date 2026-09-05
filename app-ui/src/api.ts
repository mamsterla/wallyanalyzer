import { accessToken } from './auth.js';
import { apiBaseUrl } from './runtimeConfig.js';
export async function request<T>(path:string,init?:RequestInit):Promise<T>{const token=await accessToken();const r=await fetch(`${apiBaseUrl}${path}`,{...init,headers:{...init?.headers,authorization:`Bearer ${token}`,'content-type':'application/json'}});if(!r.ok)throw Error((await r.json().catch(()=>({}))).message??'Request failed.');return r.status===204?undefined as T:r.json()}
