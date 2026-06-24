let wsToken: string | null = null;
const readyListeners = new Set<() => void>();

export function getWsToken(): string | null {
  return wsToken;
}

export function setWsToken(token: string | null): void {
  wsToken = token;
  if (token) {
    readyListeners.forEach((listener) => listener());
  }
}

export function onWsTokenReady(listener: () => void): () => void {
  readyListeners.add(listener);
  return () => readyListeners.delete(listener);
}
