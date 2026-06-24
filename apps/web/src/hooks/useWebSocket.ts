"use client";



import {

  createContext,

  createElement,

  useContext,

  useEffect,

  useRef,

  useState,

  type ReactNode,

} from "react";

import { API_BASE } from "@/lib/api";

import { getWsToken, onWsTokenReady } from "@/lib/ws-token";



/**

 * Multiplexed WebSocket — one connection per dashboard session.

 * See plan section 7 for topic subscribe/unsubscribe semantics.

 */



export type WsStatus = "connecting" | "open" | "closed" | "error";

export type TopicHandler<T = unknown> = (payload: T) => void;



interface OutgoingFrame {

  event: "subscribe" | "unsubscribe";

  topic: string;

}



interface IncomingFrame {

  topic: string;

  payload: unknown;

}



/** Optional direct WS URL (bypasses Next.js). Defaults to same-origin /api/control/ws. */

function toWsUrl(): string {

  if (typeof window === "undefined") return "";



  const explicit = process.env.NEXT_PUBLIC_WS_URL;

  if (explicit) {

    const token = getWsToken();

    return token

      ? `${explicit}${explicit.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`

      : explicit;

  }



  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";

  const path = API_BASE.startsWith("http")

    ? `${API_BASE.replace(/^http/i, proto)}/ws`

    : `${proto}//${window.location.host}${API_BASE}/ws`;

  const token = getWsToken();

  if (!token) return path;

  return `${path}?token=${encodeURIComponent(token)}`;

}



const MIN_BACKOFF_MS = 2_000;

const MAX_BACKOFF_MS = 60_000;

const TOKEN_WAIT_MS = 400;



class WebSocketManager {

  private ws: WebSocket | null = null;

  private status: WsStatus = "closed";

  private readonly topics = new Map<string, Set<TopicHandler>>();

  private readonly statusListeners = new Set<(s: WsStatus) => void>();

  private reconnectAttempts = 0;

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private tokenWaitTimer: ReturnType<typeof setTimeout> | null = null;

  private intentionalClose = false;

  private connecting = false;

  /** Bumps when a socket is replaced so late onclose handlers are ignored. */

  private socketGeneration = 0;



  constructor() {
    onWsTokenReady(() => this.onTokenReady());
  }

  getStatus(): WsStatus {

    return this.status;

  }



  onStatus(listener: (s: WsStatus) => void): () => void {

    this.statusListeners.add(listener);

    return () => this.statusListeners.delete(listener);

  }



  /** Called by SessionSync when a JWT becomes available. */

  onTokenReady(): void {

    if (this.topics.size === 0) return;

    if (this.ws?.readyState === WebSocket.OPEN) return;

    this.clearReconnectTimer();

    this.scheduleConnect(0);

  }



  private setStatus(next: WsStatus) {

    if (this.status === next) return;

    this.status = next;

    this.statusListeners.forEach((l) => l(next));

  }



  private clearReconnectTimer() {

    if (this.reconnectTimer) {

      clearTimeout(this.reconnectTimer);

      this.reconnectTimer = null;

    }

  }



  private clearTokenWaitTimer() {

    if (this.tokenWaitTimer) {

      clearTimeout(this.tokenWaitTimer);

      this.tokenWaitTimer = null;

    }

  }



  private ensureConnection() {

    if (typeof window === "undefined") return;

    if (this.ws?.readyState === WebSocket.OPEN) return;

    if (this.connecting || this.ws?.readyState === WebSocket.CONNECTING) return;

    this.scheduleConnect(0);

  }



  private scheduleConnect(delayMs: number) {

    if (this.reconnectTimer) return;

    this.reconnectTimer = setTimeout(() => {

      this.reconnectTimer = null;

      this.connect();

    }, delayMs);

  }



  private scheduleReconnect() {

    if (this.reconnectTimer) return;

    const delay = Math.min(

      MAX_BACKOFF_MS,

      MIN_BACKOFF_MS * 2 ** this.reconnectAttempts,

    );

    const jitter = Math.random() * 500;

    this.reconnectAttempts += 1;

    this.scheduleConnect(delay + jitter);

  }



  private scheduleTokenWait() {

    if (this.tokenWaitTimer) return;

    this.tokenWaitTimer = setTimeout(() => {

      this.tokenWaitTimer = null;

      if (this.topics.size > 0) this.scheduleConnect(0);

    }, TOKEN_WAIT_MS);

  }



  private teardownSocket(ws: WebSocket) {

    ws.onopen = null;

    ws.onmessage = null;

    ws.onerror = null;

    ws.onclose = null;

    try {

      ws.close();

    } catch {

      /* ignore */

    }

  }



  private connect() {

    if (typeof window === "undefined") return;

    if (this.intentionalClose || this.topics.size === 0) return;

    if (this.connecting) return;

    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {

      return;

    }



    if (!getWsToken()) {

      this.scheduleTokenWait();

      return;

    }



    this.clearTokenWaitTimer();

    this.intentionalClose = false;

    this.connecting = true;

    this.setStatus("connecting");



    // Ensure we never leak sockets — Chrome fails with "Insufficient resources"

    // after ~255 concurrent connections from one reconnect storm.

    if (this.ws) {

      this.teardownSocket(this.ws);

      this.ws = null;

    }



    const generation = ++this.socketGeneration;

    const url = toWsUrl();



    let ws: WebSocket;

    try {

      ws = new WebSocket(url);

    } catch {

      this.connecting = false;

      this.setStatus("error");

      this.scheduleReconnect();

      return;

    }

    this.ws = ws;



    ws.onopen = () => {

      if (generation !== this.socketGeneration) return;

      this.connecting = false;

      this.reconnectAttempts = 0;

      this.setStatus("open");

      for (const topic of this.topics.keys()) {

        this.sendFrame({ event: "subscribe", topic });

      }

    };



    ws.onmessage = (event) => {

      if (generation !== this.socketGeneration) return;

      let frame: IncomingFrame;

      try {

        frame = JSON.parse(event.data as string) as IncomingFrame;

      } catch {

        return;

      }

      if (!frame || typeof frame.topic !== "string") return;

      const handlers = this.topics.get(frame.topic);

      if (!handlers) return;

      handlers.forEach((handler) => {

        try {

          handler(frame.payload);

        } catch {

          /* subscriber error */

        }

      });

    };



    ws.onerror = () => {

      if (generation !== this.socketGeneration) return;

      this.setStatus("error");

    };



    ws.onclose = () => {

      if (generation !== this.socketGeneration) return;

      this.connecting = false;

      this.ws = null;

      this.setStatus("closed");

      if (!this.intentionalClose && this.topics.size > 0) {

        this.scheduleReconnect();

      }

    };

  }



  private sendFrame(frame: OutgoingFrame) {

    if (this.ws?.readyState === WebSocket.OPEN) {

      this.ws.send(JSON.stringify(frame));

    }

  }



  sendRaw(frame: object): void {

    this.ensureConnection();

    if (this.ws?.readyState === WebSocket.OPEN) {

      this.ws.send(JSON.stringify(frame));

    }

  }



  subscribe<T = unknown>(topic: string, handler: TopicHandler<T>): () => void {

    let handlers = this.topics.get(topic);

    const isNewTopic = !handlers;

    if (!handlers) {

      handlers = new Set();

      this.topics.set(topic, handlers);

    }

    handlers.add(handler as TopicHandler);



    this.ensureConnection();

    if (isNewTopic && this.ws?.readyState === WebSocket.OPEN) {

      this.sendFrame({ event: "subscribe", topic });

    }



    return () => this.unsubscribe(topic, handler);

  }



  unsubscribe<T = unknown>(topic: string, handler: TopicHandler<T>): void {

    const handlers = this.topics.get(topic);

    if (!handlers) return;

    handlers.delete(handler as TopicHandler);

    if (handlers.size === 0) {

      this.topics.delete(topic);

      this.sendFrame({ event: "unsubscribe", topic });

      if (this.topics.size === 0) {

        this.intentionalClose = true;

        this.clearReconnectTimer();

        this.clearTokenWaitTimer();

        if (this.ws) {

          this.teardownSocket(this.ws);

          this.ws = null;

        }

        this.connecting = false;

        this.setStatus("closed");

      }

    }

  }

}



let singleton: WebSocketManager | null = null;



export function getWebSocketManager(): WebSocketManager {

  if (!singleton) {

    singleton = new WebSocketManager();

  }

  return singleton;

}



/** SessionSync calls this when the JWT is first obtained or refreshed. */

export function notifyWebSocketTokenReady(): void {

  getWebSocketManager().onTokenReady();

}



interface WsContextValue {

  status: WsStatus;

  subscribe: <T = unknown>(topic: string, handler: TopicHandler<T>) => () => void;

  unsubscribe: <T = unknown>(topic: string, handler: TopicHandler<T>) => void;

  sendRaw: (frame: object) => void;

}



const WebSocketContext = createContext<WsContextValue | null>(null);



export function WebSocketProvider({ children }: { children: ReactNode }) {

  const managerRef = useRef<WebSocketManager | null>(null);

  if (!managerRef.current) {

    managerRef.current = getWebSocketManager();

  }

  const manager = managerRef.current;

  const [status, setStatus] = useState<WsStatus>(() => manager.getStatus());



  useEffect(() => {

    setStatus(manager.getStatus());

    return manager.onStatus(setStatus);

  }, [manager]);



  const value: WsContextValue = {

    status,

    subscribe: (topic, handler) => manager.subscribe(topic, handler),

    unsubscribe: (topic, handler) => manager.unsubscribe(topic, handler),

    sendRaw: (frame) => manager.sendRaw(frame),

  };



  return createElement(WebSocketContext.Provider, { value }, children);

}



export function useWebSocket(): WsContextValue {

  const ctx = useContext(WebSocketContext);

  if (!ctx) {

    throw new Error("useWebSocket must be used within a <WebSocketProvider>");

  }

  return ctx;

}



export function useTopic<T = unknown>(

  topic: string | null | undefined,

  handler: TopicHandler<T>,

  enabled = true,

): void {

  const { subscribe } = useWebSocket();

  const handlerRef = useRef(handler);

  handlerRef.current = handler;



  useEffect(() => {

    if (!topic || !enabled) return;

    const unsubscribe = subscribe<T>(topic, (payload) => handlerRef.current(payload));

    return unsubscribe;

  }, [topic, enabled, subscribe]);

}


