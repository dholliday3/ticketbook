/** WebSocket protocol types for the terminal emulator, shared between server and client. */

// Client → Server
export type ClientMessage =
  | { type: "init"; cols: number; rows: number }
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number };

// Server → Client
export type ServerMessage =
  | { type: "output"; data: string }
  | { type: "replay"; data: string }
  | { type: "ready" };
