// Removed import for McpEnv as it cannot be found.
// Defining Env locally based on error messages.

export interface Props {
  accessToken: string;
  email: string;
  [key: string]: any; // Adding index signature to satisfy Record<string, unknown> constraint
}

// Defining Env locally, making MCP_OBJECT and ASSETS required as per error messages.
export interface Env {
  MCP_OBJECT: any; // Placeholder, actual type might be needed
  ASSETS: any; // Placeholder, actual type might be needed
}

// Global declaration for pending tool calls storage
declare global {
  var pendingToolCalls:
    | {
        [toolCallId: string]: {
          name: string;
          args: any;
          func: (...args: any[]) => Promise<any>;
        };
      }
    | undefined;
}
