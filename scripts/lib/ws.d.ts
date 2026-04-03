declare module 'ws' {
  export class WebSocket {
    constructor(address: string, options?: unknown);
    close(code?: number, reason?: string): void;
    send(data: unknown): void;
    addEventListener(event: string, listener: (...args: unknown[]) => void): void;
    removeEventListener(event: string, listener: (...args: unknown[]) => void): void;
    readonly readyState: number;
    readonly CONNECTING: number;
    readonly OPEN: number;
    readonly CLOSING: number;
    readonly CLOSED: number;
  }
  export default WebSocket;
}
