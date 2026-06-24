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
import { getWsToken } from "@/components/session-sync";

/**
 * ============================================================================
 * Multiplexed WebSocket (plan section 7)
 * ============================================================================
 * ONE WebSocket connection per dashboard session. Components subscribe to
 * logical topics (e.g. "service:abc:console", "service:abc:metrics"); the
 * manager ref-counts subscribers per topic and only emits a single
 * { event: "subscribe", topic } frame when the first subscriber for a topic
 * arrives, and { event: "unsubscribe", topic } when the last one leaves.
 *
 * Incoming frames are shaped { topic, payload } and routed to every handler
 * registered for that topic. The connection reconnects with exponential
 * backoff and re-subscribes all active topics on reopen, so consumers never
 * manage sockets themselves.
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

function toWsUrl(): string {
  if (typeof window === "undefined") {
    return "";
  }
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  const path = API_BASE.startsWith("http")
    ? `${API_BASE.replace(/^http/i, proto)}/ws`
    : `${proto}//${window.location.host}${API_BASE}/ws`;
  const token = getWsToken();
  if (!token) return path;
  return `${path}?token=${encodeURIComponent(token)}`;
}

const MAX_BACKOFF_MS = 30_000;

class WebSocketManager {
  private url: string;
  private ws: WebSocket | null = null;
  private status: WsStatus = "closed";
  private readonly topics = new Map<string, Set<TopicHandler>>();
  private readonly statusListeners = new Set<(s: WsStatus) => void>();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionalClose = false;

  constructor(url: string) {
    this.url = url;
  }

  getStatus(): WsStatus {
    return this.status;
  }

  onStatus(listener: (s: WsStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  private setStatus(next: WsStatus) {
    if (this.status === next) return;
    this.status = next;
    this.statusListeners.forEach((l) => l(next));
  }

  private ensureConnection() {
    if (typeof window === "undefined") return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.connect();
  }

  private connect() {
    if (typeof window === "undefined") return;
    this.intentionalClose = false;
    this.setStatus("connecting");

    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.setStatus("error");
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.setStatus("open");
      // Re-subscribe every active topic on (re)connect.
      for (const topic of this.topics.keys()) {
        this.sendFrame({ event: "subscribe", topic });
      }
    };

    ws.onmessage = (event) => {
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
          /* a misbehaving subscriber must not break the fan-out */
        }
      });
    };

    ws.onerror = () => {
      this.setStatus("error");
    };

    ws.onclose = () => {
      this.ws = null;
      this.setStatus("closed");
      if (!this.intentionalClose && this.topics.size > 0) {
        this.scheduleReconnect();
      }
    };
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    const delay = Math.min(
      MAX_BACKOFF_MS,
      1000 * 2 ** this.reconnectAttempts,
    );
    const jitter = Math.random() * 400;
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.ensureConnection();
    }, delay + jitter);
  }

  private sendFrame(frame: OutgoingFrame) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(frame));
    }
    // If not open yet, onopen will resubscribe all topics from the map.
  }

  /** Send a raw control frame (terminal_input, terminal_resize, etc.). */
  sendRaw(frame: object): void {
    this.ensureConnection();
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
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
    if (isNewTopic) {
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
      if (this.topics.size === 0 && this.ws) {
        // No more interest: close the socket and stop reconnecting.
        this.intentionalClose = true;
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
        this.ws.close();
      }
    }
  }
}

/* Module-level singleton: guarantees one connection per browser session even
   across React remounts / fast refresh. Keyed by URL so env changes rebuild. */
let singleton: { url: string; manager: WebSocketManager } | null = null;

export function getWebSocketManager(): WebSocketManager {
  const url = toWsUrl();
  if (!singleton || singleton.url !== url) {
    singleton = { url, manager: new WebSocketManager(url) };
  }
  return singleton.manager;
}

/* ----------------------------- React bindings ----------------------------- */

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

/** Access connection status + imperative subscribe/unsubscribe. */
export function useWebSocket(): WsContextValue {
  const ctx = useContext(WebSocketContext);
  if (!ctx) {
    throw new Error("useWebSocket must be used within a <WebSocketProvider>");
  }
  return ctx;
}

/**
 * Declarative per-topic subscription. The handler is stored in a ref so callers
 * don't need to memoize it; the effect only re-runs when the topic (or enabled
 * flag) changes.
 */
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
