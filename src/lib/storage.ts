import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Local storage.
 *
 *  - `kv`: small non-sensitive values (a pending invite code, a wizard draft
 *    in progress). Final submissions are never trusted from here; they need
 *    server acknowledgement.
 *  - `sessionStorage`: where the auth session lives. On iOS/Android it is the
 *    platform keychain/keystore (expo-secure-store), split into chunks because
 *    a session is larger than one secure item should be. On web it is
 *    localStorage, as browsers offer nothing stronger.
 */

export const kv = {
  async get(key: string): Promise<string | null> {
    try {
      return await AsyncStorage.getItem(key);
    } catch {
      return null;
    }
  },
  async set(key: string, value: string): Promise<void> {
    try {
      await AsyncStorage.setItem(key, value);
    } catch {
      // Losing a convenience value is never fatal.
    }
  },
  async remove(key: string): Promise<void> {
    try {
      await AsyncStorage.removeItem(key);
    } catch {
      // ignore
    }
  },
  /** Removes every user-scoped value on sign-out. */
  async clearUserScoped(): Promise<void> {
    try {
      const keys = await AsyncStorage.getAllKeys();
      await AsyncStorage.multiRemove(keys.filter((k) => k.startsWith('uplift.user.')));
    } catch {
      // ignore
    }
  },
};

const CHUNK = 1800;
const safeKey = (key: string) => key.replace(/[^A-Za-z0-9._-]/g, '_');

async function secureRemove(key: string): Promise<void> {
  const base = safeKey(key);
  const count = Number((await SecureStore.getItemAsync(`${base}.n`)) ?? 0);
  for (let i = 0; i < count; i += 1) await SecureStore.deleteItemAsync(`${base}.${i}`);
  await SecureStore.deleteItemAsync(`${base}.n`);
}

export const sessionStorage = {
  async getItem(key: string): Promise<string | null> {
    if (Platform.OS === 'web') {
      return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
    }
    const base = safeKey(key);
    const count = Number((await SecureStore.getItemAsync(`${base}.n`)) ?? 0);
    if (!count) return null;
    let out = '';
    for (let i = 0; i < count; i += 1) {
      const part = await SecureStore.getItemAsync(`${base}.${i}`);
      if (part == null) return null;
      out += part;
    }
    return out;
  },
  async setItem(key: string, value: string): Promise<void> {
    if (Platform.OS === 'web') {
      if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
      return;
    }
    await secureRemove(key);
    const base = safeKey(key);
    const count = Math.ceil(value.length / CHUNK);
    for (let i = 0; i < count; i += 1) await SecureStore.setItemAsync(`${base}.${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK));
    await SecureStore.setItemAsync(`${base}.n`, String(count));
  },
  async removeItem(key: string): Promise<void> {
    if (Platform.OS === 'web') {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
      return;
    }
    await secureRemove(key);
  },
};
