import { createStore, del, get, set } from 'idb-keyval';

const store = createStore('alouna-auth-cache-v1', 'last-account');
/** Offline identity is a device cache hint only; the server always rechecks JWT + membership. */
export const lastAccount = {
  read: (url: string) => get<string>(url, store),
  write: (url: string, id: string) => set(url, id, store),
  clear: (url: string) => del(url, store),
};
