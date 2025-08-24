import { BaseMessage } from "@langchain/core/messages";

// ================================================================================================
// 🎯 AGENT STATE - Extended with Task Management
// ================================================================================================

/**
 * Represents a single task in the to-do list.
 */
export interface Task {
  id: string;
  description: string;
  status: "completed" | "incomplete";
}

/**
 * The complete state of the agent, including message history and the to-do list.
 */
export interface AgentState {
  messages: BaseMessage[];
  tasks: Task[];
}
