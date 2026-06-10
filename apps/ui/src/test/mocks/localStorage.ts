/**
 * In-memory localStorage stand-in for tests.
 *
 * The Node test runtime exposes an uninitialized experimental webstorage
 * global whose methods throw (`Cannot initialize local storage without a
 * --localstorage-file path`), so tests that exercise persistence need a
 * working implementation stubbed in via `vi.stubGlobal`.
 */
export function createMemoryLocalStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
  };
}
