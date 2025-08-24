import { useState, useCallback, useRef, useEffect } from "react";
import { supabase } from "@/lib/supabase-client";
import {
  Message,
  ToolCall,
  MessageContent,
  HumanApprovalResponse,
  Plan,
  Reflection,
} from "@/lib/types";
import { extractSourcesFromTool } from "@/lib/sources";

// Normalize URLs for deduping sources regardless of host casing, trailing slash, or gmail search params
const normalize = (u?: string): string | undefined => {
  if (!u) return u;
  try {
    const url = new URL(u);
    const hostLower = url.hostname.toLowerCase();
    if (/mail\.google\.com$/i.test(hostLower)) {
      url.search = "";
    } else {
      url.hash = "";
    }
    url.hostname = hostLower;
    return url.toString().replace(/\/$/, "");
  } catch {
    return u;
  }
};

export interface UseAIChatReturn {
  messages: Message[];
  isLoading: boolean;
  error: string | null;
  sendMessage: (
    message: string,
    extras?: {
      personaOverrideContent?: string;
      references?: Array<{
        app: string;
        type?: string;
        id: string;
        name?: string;
      }>;
    },
  ) => Promise<void>;
  clearMessages: () => void;
  cancelRequest: () => void;
  approveToolCall: (
    threadId: string,
    toolCallId: string,
    type: "approve" | "reject",
    editedArgs?: any,
  ) => Promise<void>;
  pendingApproval: ToolCall | null;
  pendingHumanInput: {
    threadId: string;
    interruptId: string;
    prompt: string;
    context?: string;
    expected?: string;
    choices?: string[];
    initial_value?: string;
    allow_empty?: boolean;
  } | null;
  submitHumanInput: (
    threadId: string,
    interruptId: string,
    value: string,
  ) => Promise<void>;
}

export function useAIChat(initialMessages: Message[] = []): UseAIChatReturn {
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState<ToolCall | null>(null);
  const [pendingHumanInput, setPendingHumanInput] = useState<{
    threadId: string;
    interruptId: string;
    prompt: string;
    context?: string;
    expected?: string;
    choices?: string[];
    initial_value?: string;
    allow_empty?: boolean;
  } | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeEventSourcesRef = useRef<Map<string, EventSource>>(new Map());
  const pendingApprovalsRef = useRef<Set<string>>(new Set());
  const lastProcessedContentRef = useRef<string | null>(null);

  // Ensure we never append non-strings to message content or surface [object Object]
  const toSafeString = (v: unknown, fallback = ""): string => {
    if (typeof v === "string") return v;
    if (v == null) return fallback;
    try {
      const s = JSON.stringify(v);
      return s === "[object Object]" ? fallback : s;
    } catch {
      return fallback;
    }
  };

  // Cleanup function for EventSource connections
  const cleanupEventSources = useCallback(() => {
    console.log("🧹 Cleaning up all active EventSource connections");
    activeEventSourcesRef.current.forEach((eventSource, toolCallId) => {
      console.log("🧹 Closing EventSource for toolCallId:", toolCallId);
      eventSource.close();
    });
    activeEventSourcesRef.current.clear();
    pendingApprovalsRef.current.clear();
  }, []);

  // Replace any tool_call parts with the latest toolCall objects by id
  const mergeStructuredPartsWithLatestToolStatuses = useCallback(
    (parts: MessageContent[] = [], latestToolCalls: ToolCall[] = []) => {
      if (!parts.length || !latestToolCalls.length) return parts;
      const statusPriority: Record<string, number> = {
        completed: 6,
        parallel_completed: 6,
        rejected: 5,
        error: 5,
        pending_approval: 4,
        running: 3,
        parallel_executing: 3,
        approved: 2,
        starting: 1,
      };
      const byId = new Map<string, ToolCall>();
      for (const tc of latestToolCalls) {
        const existing = byId.get(tc.id);
        if (!existing) {
          byId.set(tc.id, tc);
        } else {
          const a = statusPriority[existing.status] || 0;
          const b = statusPriority[tc.status] || 0;
          byId.set(tc.id, b >= a ? tc : existing);
        }
      }
      return parts.map((p) => {
        if (p.type === "tool_call" && p.toolCall && byId.has(p.toolCall.id)) {
          return { ...p, toolCall: byId.get(p.toolCall.id)! };
        }
        return p;
      });
    },
    [],
  );

  // Upsert a toolCall into a list, deduping by id and keeping the higher-priority status
  const upsertToolCall = useCallback(
    (list: ToolCall[] = [], incoming: ToolCall): ToolCall[] => {
      const statusPriority: Record<string, number> = {
        completed: 6,
        parallel_completed: 6,
        rejected: 5,
        error: 5,
        pending_approval: 4,
        running: 3,
        parallel_executing: 3,
        approved: 2,
        starting: 1,
      };
      let replaced = false;
      const next = list.map((tc) => {
        if (tc.id !== incoming.id) return tc;
        replaced = true;
        const a = statusPriority[tc.status] || 0;
        const b = statusPriority[incoming.status] || 0;
        return b >= a ? incoming : tc;
      });
      return replaced ? next : [...list, incoming];
    },
    [],
  );

  // Centralized handler to apply a tool_result update to UI (completion + attach sources)
  const applyToolResultUpdate = useCallback(
    (completedId?: string, result?: any) => {
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (
          last?.role === "assistant" &&
          last.toolCalls &&
          last.toolCalls.length > 0
        ) {
          // Find the completed tool to get its name
          const completedToolCall = last.toolCalls.find((tc) =>
            completedId ? tc.id === completedId : true,
          );
          const toolName = completedToolCall?.name;

          const updatedContent = last.content;

          // Mark tools as completed (targeted if id provided, otherwise all running ones)
          const updatedToolCalls = last.toolCalls.map((tc) => {
            const shouldComplete =
              (completedId ? tc.id === completedId : true) &&
              [
                "starting",
                "running",
                "approved",
                "parallel_executing",
                "pending_approval",
              ].includes(tc.status);
            return shouldComplete
              ? { ...tc, status: "completed" as const }
              : tc;
          });

          // Reflect completion in structuredContent
          const updatedStructured = (last.structuredContent || []).map(
            (part) =>
              part.type === "tool_call" && part.toolCall
                ? {
                    ...part,
                    toolCall:
                      updatedToolCalls.find(
                        (tc) => tc.id === part.toolCall!.id,
                      ) || part.toolCall,
                  }
                : part,
          );

          // Attach sources from tool output directly for all tools
          try {
            if (toolName) {
              // URL normalizer used for deduping sources across different branches below
              const normalize = (u?: string) => {
                if (!u) return u;
                try {
                  const url = new URL(u);
                  const hostLower = url.hostname.toLowerCase();
                  if (/mail\.google\.com$/i.test(hostLower)) {
                    url.search = "";
                  } else {
                    url.hash = "";
                  }
                  url.hostname = hostLower;
                  return url.toString().replace(/\/$/, "");
                } catch {
                  return u;
                }
              };
              const newSources = extractSourcesFromTool(
                toolName,
                completedToolCall?.args,
                result,
              );
              if (newSources && newSources.length > 0) {
                const existing = last.sources || [];
                const byUrl = new Map<string, any>();
                for (const s of existing)
                  if (s.url) byUrl.set(normalize(s.url)!, s);
                for (const s of newSources)
                  if (s.url) {
                    const key = normalize(s.url)!;
                    if (!byUrl.has(key))
                      byUrl.set(key, { ...s, id: key, url: key });
                  }
                const mergedSources = Array.from(byUrl.values());
                const newMessage = {
                  ...last,
                  content: updatedContent,
                  toolCalls: updatedToolCalls,
                  structuredContent: updatedStructured,
                  sources: mergedSources,
                };
                return [...prev.slice(0, -1), newMessage];
              }

              // If this is a parallel executor output, try extracting sources from embedded parallel results
              if (
                typeof result === "string" &&
                /parallel/.test(toolName.toLowerCase())
              ) {
                try {
                  const m = (result as string).match(
                    /<parallel_results>([\s\S]*?)<\/parallel_results>/,
                  );
                  if (m && m[1]) {
                    const parsed = JSON.parse(m[1]);
                    const entries = Array.isArray(parsed?.results)
                      ? parsed.results
                      : [];
                    const mergedByUrl = new Map<string, any>();
                    for (const s of last.sources || [])
                      if (s?.url) mergedByUrl.set(s.url, s);
                    for (const entry of entries) {
                      const subName = String(entry?.toolName || "");
                      const subResult = entry?.result;
                      const inferred = extractSourcesFromTool(
                        subName,
                        {},
                        subResult,
                      );
                      for (const s of inferred)
                        if (s?.url) {
                          const key = normalize(s.url)!;
                          if (!mergedByUrl.has(key))
                            mergedByUrl.set(key, { ...s, id: key, url: key });
                        }
                    }
                    const mergedSources = Array.from(mergedByUrl.values());
                    if (mergedSources.length > (last.sources?.length || 0)) {
                      const newMessage = {
                        ...last,
                        content: updatedContent,
                        toolCalls: updatedToolCalls,
                        structuredContent: updatedStructured,
                        sources: mergedSources,
                      };
                      return [...prev.slice(0, -1), newMessage];
                    }
                  }
                } catch {}
              }
            }
          } catch {}

          const newMessage = {
            ...last,
            content: updatedContent,
            toolCalls: updatedToolCalls,
            structuredContent: updatedStructured,
          };
          return [...prev.slice(0, -1), newMessage];
        }
        return prev;
      });
    },
    [setMessages],
  );

  const cancelRequest = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsLoading(false);

      // Clean up any active EventSource connections
      cleanupEventSources();

      // Remove any partial assistant message
      setMessages((prev) => {
        const lastMessage = prev[prev.length - 1];
        if (
          lastMessage?.role === "assistant" &&
          (lastMessage.content === "thinking..." || !lastMessage.content.trim())
        ) {
          return prev.slice(0, -1);
        }
        return prev;
      });
    }
  }, [cleanupEventSources]);

  // Cleanup on component unmount
  useEffect(() => {
    return () => {
      cleanupEventSources();
    };
  }, [cleanupEventSources]);

  const submitHumanInput = useCallback(
    async (threadId: string, interruptId: string, value: string) => {
      try {
        // Update inline blockquote (Q/A) inside the last assistant message (idempotent)
        // AND insert the human input as a proper user message in history (before the assistant message)
        setMessages((prev) => {
          const next = [...prev];
          if (next.length === 0) {
            return [
              { id: Date.now().toString(), role: "user", content: value },
            ];
          }

          const lastIndex = next.length - 1;
          const last = next[lastIndex];

          // Prepare updated assistant with inline Q/A blockquote
          let updatedAssistant = last;
          if (last && last.role === "assistant") {
            const parts = [...(last.structuredContent || [])];
            const promptText = pendingHumanInput?.prompt || "Question";
            const existingIndex = parts.findIndex(
              (p) =>
                p.type === "text" && p.content.startsWith(`> ${promptText}`),
            );
            const qaContent = `> ${promptText}\n> ${value}`;
            if (existingIndex >= 0) {
              parts[existingIndex] = {
                ...parts[existingIndex],
                content: qaContent,
              };
            } else {
              const segment = parts.length;
              parts.push({
                type: "text",
                content: qaContent,
                segment,
                conversationRound: 1,
              });
            }
            updatedAssistant = { ...last, structuredContent: parts };
          }

          const userMsg = {
            id: (Date.now() + 1).toString(),
            role: "user" as const,
            content: value,
            hidden: true,
          };

          // If last is assistant, insert user message before it to keep assistant last for streaming updaters
          if (last && last.role === "assistant") {
            return [...next.slice(0, -1), userMsg, updatedAssistant];
          }

          // Otherwise, append user message at end and keep any non-assistant last item
          return [...next, userMsg];
        });

        // Start a resume stream with human_input action
        const params = new URLSearchParams({
          resumeWorkflow: "true",
          toolCallId: interruptId,
          threadId,
          action: "human_input",
          value,
        });
        const eventSourceUrl = `/api/chat?${params.toString()}`;
        const eventSource = new EventSource(eventSourceUrl);

        let resumeParallelGroupId: string | null = null;
        activeEventSourcesRef.current.set(interruptId, eventSource);
        setIsLoading(true);
        setPendingHumanInput(null);

        // Simple content streaming after human input
        eventSource.addEventListener("content", (event) => {
          const data = JSON.parse((event as MessageEvent).data);
          if (typeof data.content === "string" && data.content.trim()) {
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last?.role === "assistant") {
                // If message has structured content, add new content as a text part
                if (
                  last.structuredContent &&
                  last.structuredContent.length > 0
                ) {
                  const maxSegment = Math.max(
                    0,
                    ...last.structuredContent.map((p) => p.segment),
                  );

                  // Check if last part is text and can be appended to
                  const lastPart =
                    last.structuredContent[last.structuredContent.length - 1];
                  if (
                    lastPart &&
                    lastPart.type === "text" &&
                    !String(lastPart.content).trimStart().startsWith("> ")
                  ) {
                    // Append to existing text part
                    const updatedParts = [...last.structuredContent];
                    updatedParts[updatedParts.length - 1] = {
                      ...lastPart,
                      content: lastPart.content + data.content,
                    };
                    return [
                      ...prev.slice(0, -1),
                      {
                        ...last,
                        structuredContent: updatedParts,
                      },
                    ];
                  } else {
                    // Add new text part
                    const newPart: MessageContent = {
                      type: "text",
                      content: data.content,
                      segment: maxSegment + 1,
                      conversationRound: 1,
                    };
                    return [
                      ...prev.slice(0, -1),
                      {
                        ...last,
                        structuredContent: [...last.structuredContent, newPart],
                      },
                    ];
                  }
                } else {
                  // No structured content, just append to regular content
                  const newContent = last.content === "thinking..." ? data.content : (last.content || "") + data.content;
                  return [
                    ...prev.slice(0, -1),
                    {
                      ...last,
                      content: newContent,
                    },
                  ];
                }
              }
              return [
                ...prev,
                {
                  id: Date.now().toString(),
                  role: "assistant",
                  content: data.content,
                },
              ];
            });
          }
        });

        // Capture parallel start to tag subsequent tools in a group
        eventSource.addEventListener("parallel_execution_start", (event) => {
          resumeParallelGroupId = `pg_${Date.now()}`;
        });

        // Handle new tool calls
        eventSource.addEventListener("tool_call", (event) => {
          const data = JSON.parse((event as MessageEvent).data);
          const safeName = data.name || "Tool";
          const toolCallId = data.id || `tool_${Date.now()}`;

          const toolCall: ToolCall = {
            id: toolCallId,
            name: safeName,
            status: "starting",
            message: `Using ${safeName}...`,
            segment: data.segment || 0,
            args: data.args,
            parallelGroup: resumeParallelGroupId || undefined,
          };

          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (last?.role === "assistant") {
              const maxSegment = last.structuredContent
                ? Math.max(0, ...last.structuredContent.map((p) => p.segment))
                : 0;

              const newToolPart: MessageContent = {
                type: "tool_call",
                content: "",
                segment: maxSegment + 1,
                toolCall: toolCall,
              };

              return [
                ...prev.slice(0, -1),
                {
                  ...last,
                  toolCalls: [...(last.toolCalls || []), toolCall],
                  structuredContent: [
                    ...(last.structuredContent || []),
                    newToolPart,
                  ],
                },
              ];
            }
            return prev;
          });
        });

        // Handle tool results - mark tools as completed and attach sources
        eventSource.addEventListener("tool_result", (event) => {
          try {
            const parsed = JSON.parse((event as MessageEvent).data);
            const completedId: string | undefined =
              parsed?.id || parsed?.toolCallId;
            const result = parsed?.result;
            applyToolResultUpdate(completedId, result);
          } catch {}
        });

        // Listen for done events
        eventSource.addEventListener("done", (event) => {
          console.log("[EventSource] Stream completed");
          try {
            const data = JSON.parse((event as MessageEvent).data || "{}");
            if (
              data &&
              Array.isArray(data.sources) &&
              data.sources.length > 0
            ) {
              setMessages((prev) => {
                const last = prev[prev.length - 1];
                if (last?.role !== "assistant") return prev;
                const existing = last.sources || [];
                const byUrl = new Map<string, any>();
                const normalize = (u?: string) => {
                  if (!u) return u;
                  try {
                    const url = new URL(u);
                    const host = url.hostname.toLowerCase();
                    if (/mail\.google\.com$/i.test(host)) {
                      url.search = "";
                    } else {
                      url.hash = "";
                      url.hostname = host;
                    }
                    url.hostname = host;
                    return url.toString().replace(/\/$/, "");
                  } catch {
                    return u;
                  }
                };
                for (const s of existing)
                  if (s.url) byUrl.set(normalize(s.url)!, s);
                for (const s of data.sources)
                  if (s.url) {
                    const key = normalize(s.url)!;
                    if (!byUrl.has(key))
                      byUrl.set(key, { ...s, id: key, url: key });
                  }
                const mergedSources = Array.from(byUrl.values());
                return [
                  ...prev.slice(0, -1),
                  { ...last, sources: mergedSources },
                ];
              });
            }
          } catch {}

          // Fallback: parse embedded <parallel_results> in the final assistant content
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            if (!last || last.role !== "assistant") return prev;
            try {
              const content = String(last.content || "");
              const m = content.match(
                /<parallel_results>([\s\S]*?)<\/parallel_results>/,
              );
              if (m && m[1]) {
                const parsed = JSON.parse(m[1]);
                const entries = Array.isArray(parsed?.results)
                  ? parsed.results
                  : [];
                const mergedByUrl = new Map<string, any>();
                const normalize = (u?: string) => {
                  if (!u) return u;
                  try {
                    const url = new URL(u);
                    const host = url.hostname.toLowerCase();
                    if (/mail\.google\.com$/i.test(host)) {
                      url.search = "";
                    } else {
                      url.hash = "";
                      url.hostname = host;
                    }
                    url.hostname = host;
                    return url.toString().replace(/\/$/, "");
                  } catch {
                    return u;
                  }
                };
                for (const s of last.sources || [])
                  if (s?.url) mergedByUrl.set(normalize(s.url)!, s);
                for (const entry of entries) {
                  const subName = String(entry?.toolName || "");
                  const subResult = entry?.result;
                  const inferred = extractSourcesFromTool(
                    subName,
                    {},
                    subResult,
                  );
                  for (const s of inferred)
                    if (s?.url) {
                      const key = normalize(s.url)!;
                      if (!mergedByUrl.has(key))
                        mergedByUrl.set(key, { ...s, id: key, url: key });
                    }
                }
                const mergedSources = Array.from(mergedByUrl.values());
                if (mergedSources.length > (last.sources?.length || 0)) {
                  return [
                    ...prev.slice(0, -1),
                    { ...last, sources: mergedSources },
                  ];
                }
              }
            } catch {}
            return prev;
          });

          // Mark all tools as completed when workflow is done
          setMessages((prev) =>
            prev.map((msg) => {
              if (msg.role === "assistant" && msg.toolCalls) {
                const updatedToolCalls = msg.toolCalls.map((tc) => ({
                  ...tc,
                  status: "completed" as const,
                }));
                const updatedStructured = (msg.structuredContent || []).map(
                  (part) =>
                    part.type === "tool_call" && part.toolCall
                      ? {
                          ...part,
                          toolCall: {
                            ...part.toolCall,
                            status: "completed" as const,
                          },
                        }
                      : part,
                );
                return {
                  ...msg,
                  toolCalls: updatedToolCalls,
                  structuredContent: updatedStructured,
                };
              }
              return msg;
            }),
          );

          // No special cleanup required for resume parallel grouping

          eventSource.close();
          activeEventSourcesRef.current.delete(interruptId);
          pendingApprovalsRef.current.delete(interruptId);
          // Keep loading state active until all EventSources are done
          if (activeEventSourcesRef.current.size === 0) {
            setIsLoading(false);
          }
        });

        

        eventSource.addEventListener("error", () => {
          eventSource.close();
          activeEventSourcesRef.current.delete(interruptId);
          if (activeEventSourcesRef.current.size === 0) setIsLoading(false);
        });
      } catch (e) {
        console.error("Failed to submit human input", e);
      }
    },
    [pendingHumanInput?.prompt],
  );

  const approveToolCall = useCallback(
    async (
      threadId: string,
      toolCallId: string,
      type: "approve" | "reject",
      editedArgs?: any,
    ) => {
      console.log(`[Tool Approval] ${type} ${toolCallId}`);

      // Immediately update the UI state for tool tile without duplicating entries
      setMessages((prev) =>
        prev.map((msg) => {
          if (
            msg.role === "assistant" &&
            msg.toolCalls?.some((tc) => tc.id === toolCallId)
          ) {
            const updatedToolCalls = (msg.toolCalls || []).map((tc) => {
              if (tc.id !== toolCallId) return tc;
              if (type === "reject") {
                return {
                  ...tc,
                  status: "rejected" as const,
                  message: `${tc.name} was rejected`,
                };
              }
              // Approve -> normalize to running
              return {
                ...tc,
                status: "running" as const,
                message: `Using ${tc.name}...`,
                args: editedArgs ?? tc.args,
              };
            });

            // Update matching structuredContent tool_call in-place; do not insert a new one
            const updatedStructured =
              (msg.structuredContent || []).map((part) => {
                if (
                  part.type === "tool_call" &&
                  part.toolCall?.id === toolCallId
                ) {
                  const updated = updatedToolCalls.find(
                    (t) => t.id === toolCallId,
                  );
                  return {
                    ...part,
                    toolCall: updated,
                  };
                }
                return part;
              }) || msg.structuredContent;

            return {
              ...msg,
              toolCalls: updatedToolCalls,
              structuredContent: updatedStructured,
            };
          }
          return msg;
        }),
      );

      if (!threadId) {
        console.error("❌ No thread ID provided for approval");
        return;
      }

      // Prevent multiple concurrent requests for the same toolCallId
      if (pendingApprovalsRef.current.has(toolCallId)) {
        console.log(
          "⚠️ Request already in progress for toolCallId:",
          toolCallId,
        );
        return;
      }

      // Mark this toolCallId as being processed
      pendingApprovalsRef.current.add(toolCallId);

      const existingEventSource = activeEventSourcesRef.current.get(toolCallId);
      if (existingEventSource) {
        console.log(
          "🔄 Closing existing EventSource for toolCallId:",
          toolCallId,
        );
        existingEventSource.close();
        activeEventSourcesRef.current.delete(toolCallId);
      }

      setIsLoading(true);
      setPendingApproval(null);
      setError(null);

      try {
        // Create EventSource URL for resume workflow
        const params = new URLSearchParams({
          resumeWorkflow: "true",
          toolCallId,
          threadId,
          action: type,
        });
        if (type === "approve" && editedArgs) {
          try {
            params.set("args", JSON.stringify(editedArgs));
          } catch {}
        }
        const eventSourceUrl = `/api/chat?${params.toString()}`;

        console.log(
          `[EventSource] Connecting for tool approval: ${toolCallId}`,
        );
        const eventSource = new EventSource(eventSourceUrl);
        activeEventSourcesRef.current.set(toolCallId, eventSource);
        let contentBuffer = "";

        // Connection opened
        eventSource.onopen = () => {
          console.log(`[EventSource] Connected: ${toolCallId}`);
        };

        // Content streaming after approval
        eventSource.addEventListener("content", (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.content && typeof data.content === "string") {
              contentBuffer += data.content;

              setMessages((prev) => {
                const last = prev[prev.length - 1];
                if (last?.role === "assistant") {
                  // If message has structured content, add new content as a text part
                  if (
                    last.structuredContent &&
                    last.structuredContent.length > 0
                  ) {
                    const maxSegment = Math.max(
                      0,
                      ...last.structuredContent.map((p) => p.segment),
                    );

                    // Check if last part is text and can be appended to
                    const lastPart =
                      last.structuredContent[last.structuredContent.length - 1];
                    if (lastPart && lastPart.type === "text") {
                      // Append to existing text part
                      const updatedParts = [...last.structuredContent];
                      updatedParts[updatedParts.length - 1] = {
                        ...lastPart,
                        content: lastPart.content + data.content,
                      };
                      return [
                        ...prev.slice(0, -1),
                        {
                          ...last,
                          structuredContent: updatedParts,
                        },
                      ];
                    } else {
                      // Add new text part
                      const newPart: MessageContent = {
                        type: "text",
                        content: data.content,
                        segment: maxSegment + 1,
                        conversationRound: 1,
                      };
                      return [
                        ...prev.slice(0, -1),
                        {
                          ...last,
                          structuredContent: [
                            ...last.structuredContent,
                            newPart,
                          ],
                        },
                      ];
                    }
                  } else {
                    // No structured content, just append to regular content
                    const newContent = last.content === "thinking..." ? data.content : (last.content || "") + data.content;
                    return [
                      ...prev.slice(0, -1),
                      {
                        ...last,
                        content: newContent,
                      },
                    ];
                  }
                }
                return prev;
              });
            }
          } catch (error) {
            console.error("❌ Error parsing content event:", error);
          }
        });

        // Capture parallel start to tag subsequent tools in a group (approval flow)
        eventSource.addEventListener("parallel_execution_start", () => {
          // Parallel execution started
        });

        // Handle new tool calls after approval
        eventSource.addEventListener("tool_call", (event) => {
          try {
            const data = JSON.parse(event.data);
            const safeName = data.name || "Tool";
            const newToolCallId = data.id || `tool_${Date.now()}`;

            // If this was a reject action, ignore any tool_call events from this resume stream
            // to prevent creation of a new tool tile after rejection.
            if (type === "reject") {
              return;
            }

            const toolCall: ToolCall = {
              id: newToolCallId,
              name: safeName,
              // If this matches the approved id, treat as running to avoid flicker
              status:
                newToolCallId === toolCallId
                  ? ("running" as const)
                  : ("starting" as const),
              message: `Using ${safeName}...`,
              segment: data.segment || 0,
              args: data.args,
              parallelGroup: undefined,
            };

            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last?.role === "assistant") {
                // If this tool_call is for the same tool we just approved,
                // update the existing entry instead of inserting a duplicate
                const isSameAsApproved = newToolCallId === toolCallId;

                // Also guard against duplicates by ID if already present
                const alreadyExistsById = (last.toolCalls || []).some(
                  (tc) => tc.id === newToolCallId,
                );

                if (isSameAsApproved || alreadyExistsById) {
                  const updatedToolCalls = (last.toolCalls || []).map((tc) =>
                    tc.id === newToolCallId
                      ? {
                          ...tc,
                          // Preserve requiresApproval flag if it existed
                          requiresApproval:
                            tc.requiresApproval ?? toolCall.requiresApproval,
                          status: "running" as const,
                          message: `Using ${safeName}...`,
                          args: toolCall.args ?? tc.args,
                        }
                      : tc,
                  );

                  const updatedStructured = (last.structuredContent || []).map(
                    (part) => {
                      if (
                        part.type === "tool_call" &&
                        part.toolCall?.id === newToolCallId
                      ) {
                        const updated = updatedToolCalls.find(
                          (t) => t.id === newToolCallId,
                        );
                        return { ...part, toolCall: updated } as MessageContent;
                      }
                      return part;
                    },
                  );

                  return [
                    ...prev.slice(0, -1),
                    {
                      ...last,
                      toolCalls: updatedToolCalls,
                      structuredContent: updatedStructured,
                    },
                  ];
                }

                // Strong reconciliation: if we're in approve flow and the server
                // sent a different id/name, adopt the new id onto the approved tile
                const approvedIndexById = (last.toolCalls || []).findIndex(
                  (tc) => tc.id === toolCallId,
                );
                if (approvedIndexById >= 0) {
                  const prevTool = last.toolCalls![approvedIndexById];
                  const adoptedName =
                    safeName && safeName !== "Tool" ? safeName : prevTool.name;

                  const updatedToolCalls = (last.toolCalls || []).map(
                    (tc, i) =>
                      i === approvedIndexById
                        ? {
                            ...tc,
                            id: newToolCallId, // adopt server id for future results
                            name: adoptedName,
                            status: "running" as const,
                            message: `Using ${adoptedName}...`,
                            args: toolCall.args ?? tc.args,
                          }
                        : tc,
                  );

                  const updatedStructured = (last.structuredContent || []).map(
                    (part) => {
                      if (
                        part.type === "tool_call" &&
                        part.toolCall?.id === toolCallId
                      ) {
                        const updated = updatedToolCalls[approvedIndexById];
                        return { ...part, toolCall: updated } as MessageContent;
                      }
                      return part;
                    },
                  );

                  return [
                    ...prev.slice(0, -1),
                    {
                      ...last,
                      toolCalls: updatedToolCalls,
                      structuredContent: updatedStructured,
                    },
                  ];
                }

                // Fallback: try to reconcile by name if the server sent a different id
                const existingIndexByName = (last.toolCalls || []).findIndex(
                  (tc) =>
                    (tc.name || "").toLowerCase() === safeName.toLowerCase() &&
                    ["pending_approval", "starting", "running"].includes(
                      tc.status as string,
                    ),
                );
                if (existingIndexByName >= 0) {
                  const oldId = last.toolCalls![existingIndexByName].id;
                  const updatedToolCalls = (last.toolCalls || []).map(
                    (tc, i) =>
                      i === existingIndexByName
                        ? {
                            ...tc,
                            id: newToolCallId, // adopt server id for future results
                            status: "running" as const,
                            message: `Using ${safeName}...`,
                            args: toolCall.args ?? tc.args,
                          }
                        : tc,
                  );

                  const updatedStructured = (last.structuredContent || []).map(
                    (part) => {
                      if (
                        part.type === "tool_call" &&
                        part.toolCall?.id === oldId
                      ) {
                        const updated = updatedToolCalls[existingIndexByName];
                        return { ...part, toolCall: updated } as MessageContent;
                      }
                      return part;
                    },
                  );

                  return [
                    ...prev.slice(0, -1),
                    {
                      ...last,
                      toolCalls: updatedToolCalls,
                      structuredContent: updatedStructured,
                    },
                  ];
                }

                // Otherwise, append as a brand new tool_call
                const maxSegment = last.structuredContent
                  ? Math.max(0, ...last.structuredContent.map((p) => p.segment))
                  : 0;

                const newToolPart: MessageContent = {
                  type: "tool_call",
                  content: "",
                  segment: maxSegment + 1,
                  toolCall: toolCall,
                };

                return [
                  ...prev.slice(0, -1),
                  {
                    ...last,
                    toolCalls: [...(last.toolCalls || []), toolCall],
                    structuredContent: [
                      ...(last.structuredContent || []),
                      newToolPart,
                    ],
                  },
                ];
              }
              return prev;
            });
          } catch (error) {
            console.error("❌ Error parsing tool_call event:", error);
          }
        });

        // Handle tool results in approval flow as well
        eventSource.addEventListener("tool_result", (event) => {
          try {
            const parsed = JSON.parse(event.data);
            const completedId: string | undefined =
              parsed?.id || parsed?.toolCallId;
            const result = parsed?.result;
            // Attach sources immediately (approval flow)
            setMessages((prev) => {
              const last = prev[prev.length - 1];
              if (last?.role !== "assistant" || !last.toolCalls?.length)
                return prev;
              const completedToolCall = last.toolCalls.find((tc) =>
                completedId ? tc.id === completedId : true,
              );
              const toolName = completedToolCall?.name;
              if (!toolName) return prev;
              try {
                const newSources = extractSourcesFromTool(
                  toolName,
                  completedToolCall?.args,
                  result,
                );
                if (!newSources || newSources.length === 0) return prev;
                const existing = last.sources || [];
                const byUrl = new Map<string, any>();
                const normalize = (u?: string) => {
                  if (!u) return u;
                  try {
                    const url = new URL(u);
                    const hostLower = url.hostname.toLowerCase();
                    if (/mail\.google\.com$/i.test(hostLower)) {
                      url.search = "";
                    } else {
                      url.hash = "";
                    }
                    url.hostname = hostLower;
                    return url.toString().replace(/\/$/, "");
                  } catch {
                    return u;
                  }
                };
                for (const s of existing)
                  if (s.url) byUrl.set(normalize(s.url)!, s);
                for (const s of newSources)
                  if (s.url) {
                    const key = normalize(s.url)!;
                    if (!byUrl.has(key))
                      byUrl.set(key, { ...s, id: key, url: key });
                  }
                const mergedSources = Array.from(byUrl.values());
                const merged = { ...last, sources: mergedSources };
                return [...prev.slice(0, -1), merged];
              } catch {
                return prev;
              }
            });

            applyToolResultUpdate(completedId, result);
          } catch {}
        });

        

        // Connection error
        eventSource.onerror = (error) => {
          console.error(`[EventSource] Error: ${eventSource.readyState}`);
          if (eventSource.readyState === EventSource.CLOSED) {
            eventSource.close();
            activeEventSourcesRef.current.delete(toolCallId);
            pendingApprovalsRef.current.delete(toolCallId);
            // Keep loading state active until all EventSources are done
            if (activeEventSourcesRef.current.size === 0) {
              setIsLoading(false);
            }
          }
        };

        // Cleanup after timeout
        setTimeout(() => {
          if (eventSource.readyState !== EventSource.CLOSED) {
            console.log("[EventSource] Timeout, closing connection");
            eventSource.close();
            activeEventSourcesRef.current.delete(toolCallId);
            pendingApprovalsRef.current.delete(toolCallId);
            // Keep loading state active until all EventSources are done
            if (activeEventSourcesRef.current.size === 0) {
              setIsLoading(false);
            }
          }
        }, 30000);
      } catch (error) {
        console.error("[Tool Approval] Error:", error);
        setError(
          error instanceof Error
            ? error.message
            : "Failed to approve tool call",
        );
        // Cleanup the failed EventSource connection
        activeEventSourcesRef.current.delete(toolCallId);
        pendingApprovalsRef.current.delete(toolCallId);
      } finally {
        // Only set loading to false if no EventSources are active
        if (activeEventSourcesRef.current.size === 0) {
          setIsLoading(false);
        }
      }
    },
    [setMessages],
  );

  const sendMessage = useCallback(
    async (
      message: string,
      extras?: {
        personaOverrideContent?: string;
        references?: Array<{
          app: string;
          type?: string;
          id: string;
          name?: string;
        }>;
      },
    ) => {
      console.log(`[Send Message] "${message.substring(0, 50)}..."`);

      if (!message.trim()) return;

      // Message is used directly now that auto-rendering handles email/docs UI
      const processedMessage = message;

      // Cancel any existing request and cleanup EventSource connections
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      cleanupEventSources();

      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      setIsLoading(true);
      setError(null);
      // Reset any stale, previous interrupts from other threads / earlier messages
      setPendingApproval(null);
      setPendingHumanInput(null);

      // Add user message to the UI immediately (use original message for display)
      const contentWithAttachments =
        extras?.references &&
        Array.isArray(extras.references) &&
        extras.references.length > 0
          ? `${message} [attachments]${JSON.stringify(extras.references)}[/attachments]`
          : message;
      const userMessage: Message = {
        id: Date.now().toString(),
        role: "user",
        content: contentWithAttachments,
      };
      const assistantMessageId = Date.now().toString() + "_assistant";
      setMessages((prev) => [
        ...prev,
        userMessage,
        {
          id: assistantMessageId,
          role: "assistant",
          content: "thinking...",
          structuredContent: [],
          toolCalls: [],
        },
      ]);

      try {
        // Get current user
        console.log("👤 Getting current user from Supabase...");
        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        console.log("  - User error:", userError);
        console.log("  - User found:", !!user);
        console.log("  - User ID:", user?.id);
        console.log("  - User email:", user?.email);

        const userId = user?.id;
        const generatedThreadId = `thread_${userId}_${Date.now()}`;
        console.log(`[Chat] Starting conversation: ${generatedThreadId}`);

        const requestBody: any = {
          message: processedMessage,
          history: messages,
          user_id: userId,
          threadId: generatedThreadId,
        };
        if (extras?.personaOverrideContent) {
          requestBody.personaOverrideContent = extras.personaOverrideContent;
        }
        if (extras?.references && Array.isArray(extras.references)) {
          requestBody.references = extras.references;
        }

        console.log(`[Chat] Starting stream: ${messages.length} messages`);

        const response = await fetch("/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
          signal: abortController.signal,
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error("[Chat] Response error:", errorText);
          throw new Error("Failed to get response from AI");
        }

        // Parse SSE stream
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        if (!reader) throw new Error("No response body");

        let buffer = "";
        let aiContent = "";
        let hasStartedContent = false;
        const activeToolCalls = new Map<string, ToolCall>();
        const contentParts: MessageContent[] = [];
        let currentTextPart: MessageContent | null = null;
        const currentConversationRound = 1;
        // Track an active parallel group so the UI can collapse items under a dropdown
        let currentParallelGroupId: string | null = null;

        // Email/docs tag suppression state
        let insideEmailDocTags = false;
        let tagBuffer = "";
        let currentTag = "";

        // Start SSE stream processing
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });

          // Process complete SSE messages
          const lines = buffer.split("\n");
          buffer = lines.pop() || ""; // Keep incomplete line in buffer

          let currentEventType = "content"; // Default event type
          for (const line of lines) {
            if (line.startsWith("event: ")) {
              currentEventType = line.slice(7).trim();
              continue;
            }

            if (line.startsWith("data: ")) {
              const dataStr = line.slice(6);
              if (dataStr.trim() === "") continue;

              try {
                const data = JSON.parse(dataStr);

                // Handle tool_call events from backend
                if (currentEventType === "tool_call") {
                  const safeName = toSafeString(data.name, "Tool");
                  const toolCallId = data.id || `tool_${Date.now()}`;

                  // Check if tool call already exists
                  const existingToolCall = activeToolCalls.get(toolCallId);

                  if (!existingToolCall) {
                    // Attempt strong reconciliation with any existing non-completed tile
                    // to avoid creating a duplicate tile after approval/resume
                    let adoptedOntoExisting = false;
                    const candidateName = (safeName || "").toLowerCase();
                    const adoptableStatuses = new Set([
                      "pending_approval",
                      "approved",
                      "starting",
                      "running",
                    ]);
                    let adoptIndex = -1;
                    for (let k = contentParts.length - 1; k >= 0; k--) {
                      const part = contentParts[k];
                      if (part.type !== "tool_call" || !part.toolCall) continue;
                      const st = String(part.toolCall.status || "");
                      if (!adoptableStatuses.has(st as any)) continue;
                      const partName = (part.toolCall.name || "").toLowerCase();
                      const namesMatch =
                        candidateName !== "tool" && partName === candidateName;
                      // Prefer last adoptable; accept name match or when incoming name is generic
                      if (namesMatch || candidateName === "tool") {
                        adoptIndex = k;
                        break;
                      }
                    }
                    if (adoptIndex >= 0) {
                      const part = contentParts[adoptIndex]!;
                      part.toolCall = {
                        ...part.toolCall!,
                        id: toolCallId,
                        name:
                          safeName !== "Tool" ? safeName : part.toolCall!.name,
                        status: "running",
                        message: `Using ${safeName !== "Tool" ? safeName : part.toolCall!.name}...`,
                        args: data.args ?? part.toolCall!.args,
                        parallelGroup:
                          currentParallelGroupId ||
                          part.toolCall!.parallelGroup,
                      } as ToolCall;
                      adoptedOntoExisting = true;
                    }
                    if (adoptedOntoExisting) {
                      // Reflect in activeToolCalls map as well
                      activeToolCalls.set(toolCallId, {
                        id: toolCallId,
                        name: safeName,
                        status: "running",
                        message: `Using ${safeName}...`,
                        segment: data.segment || 0,
                        args: data.args,
                        parallelGroup: currentParallelGroupId || undefined,
                      } as ToolCall);

                      // Update UI in place, do not append a new tool_call part
                      setMessages((prev) => {
                        const last = prev[prev.length - 1];
                        if (last?.role === "assistant") {
                          // Find best candidate tile to adopt in UI
                          const adoptableStatusesArr = [
                            "pending_approval",
                            "approved",
                            "starting",
                            "running",
                          ];
                          let pendingIndex = -1;
                          // Prefer name match; else last adoptable
                          const lowerName = (safeName || "").toLowerCase();
                          for (
                            let i = (last.toolCalls || []).length - 1;
                            i >= 0;
                            i--
                          ) {
                            const tc = (last.toolCalls || [])[i];
                            if (!tc) continue;
                            if (
                              !adoptableStatusesArr.includes(
                                tc.status as string,
                              )
                            )
                              continue;
                            const tn = (tc.name || "").toLowerCase();
                            if (lowerName !== "tool" && tn === lowerName) {
                              pendingIndex = i;
                              break;
                            }
                            if (pendingIndex < 0) pendingIndex = i;
                          }
                          if (pendingIndex >= 0) {
                            const prevTool = last.toolCalls![pendingIndex];
                            const adoptedName =
                              safeName && safeName !== "Tool"
                                ? safeName
                                : prevTool.name;
                            const updatedToolCalls = (last.toolCalls || []).map(
                              (tc, i) =>
                                i === pendingIndex
                                  ? {
                                      ...tc,
                                      id: toolCallId,
                                      name: adoptedName,
                                      status: "running" as const,
                                      message: `Using ${adoptedName}...`,
                                      args: data.args ?? tc.args,
                                    }
                                  : tc,
                            );
                            const updatedStructured = (
                              last.structuredContent || []
                            ).map((p) =>
                              p.type === "tool_call" &&
                              p.toolCall &&
                              (p.toolCall.id === prevTool.id ||
                                adoptableStatuses.has(p.toolCall.status as any))
                                ? {
                                    ...p,
                                    toolCall: updatedToolCalls[pendingIndex],
                                  }
                                : p,
                            );
                            return [
                              ...prev.slice(0, -1),
                              {
                                ...last,
                                toolCalls: updatedToolCalls,
                                structuredContent: updatedStructured,
                              },
                            ];
                          }
                        }
                        return prev;
                      });
                      continue; // Skip normal insertion logic
                    }

                    // Determine if we should group this call with an active group or create one
                    const startingCalls = Array.from(
                      activeToolCalls.values(),
                    ).filter(
                      (tc) => tc.status === "starting" && !tc.parallelGroup,
                    );
                    if (!currentParallelGroupId && startingCalls.length >= 1) {
                      currentParallelGroupId = `pg_${Date.now()}`;
                    }

                    // Create new tool call
                    const toolCall: ToolCall = {
                      id: toolCallId,
                      name: safeName,
                      status: "starting",
                      message: `Using ${safeName}...`,
                      segment: data.segment || 0,
                      args: data.args,
                      parallelGroup: currentParallelGroupId || undefined,
                    };

                    activeToolCalls.set(toolCall.id, toolCall);

                    // If a new group was created, retroactively tag prior starting calls
                    if (currentParallelGroupId && startingCalls.length >= 1) {
                      startingCalls.forEach((tc) => {
                        tc.parallelGroup = currentParallelGroupId as string;
                        activeToolCalls.set(tc.id, { ...tc });
                      });
                    }

                    // End current text part and add tool call
                    currentTextPart = null;
                    contentParts.push({
                      type: "tool_call",
                      content: "",
                      segment: toolCall.segment,
                      toolCall: toolCall,
                    });

                    setMessages((prev) => {
                      const lastMessage = prev[prev.length - 1];
                      if (
                        lastMessage?.role === "assistant" &&
                        lastMessage.id === assistantMessageId
                      ) {
                        // If we assigned a group, also update any prior starting tool calls in the UI
                        let updatedToolCalls = [
                          ...(lastMessage.toolCalls || []),
                        ];
                        if (
                          currentParallelGroupId &&
                          startingCalls.length >= 1
                        ) {
                          updatedToolCalls = updatedToolCalls.map((tc) =>
                            startingCalls.some((sc) => sc.id === tc.id)
                              ? {
                                  ...tc,
                                  parallelGroup:
                                    currentParallelGroupId as string,
                                }
                              : tc,
                          );
                        }

                        updatedToolCalls = [...updatedToolCalls, toolCall];

                        return [
                          ...prev.slice(0, -1),
                          {
                            ...lastMessage,
                            toolCalls: updatedToolCalls,
                            structuredContent:
                              mergeStructuredPartsWithLatestToolStatuses(
                                contentParts,
                                updatedToolCalls,
                              ),
                          },
                        ];
                      }
                      return prev;
                    });
                  }
                }

                // Handle human_input_required events - this creates the approval UI
                else if (currentEventType === "human_input_required") {
                  const kind = data.kind || data.type;
                  const interruptId = data.interruptId;

                  // Ignore stray interrupts from other threads
                  if (data.threadId && data.threadId !== generatedThreadId) {
                    continue;
                  }

                  if (kind === "human_input") {
                    const promptText = toSafeString(
                      data.data?.prompt,
                      "Please provide input",
                    );

                    setPendingHumanInput({
                      threadId: data.threadId,
                      interruptId,
                      prompt: promptText,
                      context: toSafeString(data.data?.context, ""),
                      expected: toSafeString(data.data?.expected, "text"),
                      choices: Array.isArray(data.data?.choices)
                        ? data.data.choices.map((c: any) => toSafeString(c, ""))
                        : undefined,
                      initial_value: toSafeString(data.data?.initial_value, ""),
                      allow_empty: !!data.data?.allow_empty,
                    });

                    // Inline blockquote prompt in assistant message (deduplicated)
                    setMessages((prev) => {
                      const next = [...prev];
                      const last = next[next.length - 1];
                      if (last && last.role === "assistant") {
                        const parts = [...(last.structuredContent || [])];
                        const alreadyExists = parts.some(
                          (p) =>
                            p.type === "text" &&
                            p.content === `> ${promptText}`,
                        );
                        if (!alreadyExists) {
                          const segment = parts.length;
                          parts.push({
                            type: "text",
                            content: `> ${promptText}`,
                            segment,
                            conversationRound: 1,
                          });
                          next[next.length - 1] = {
                            ...last,
                            structuredContent: parts,
                          };
                        }
                      }
                      return next;
                    });
                  } else {
                    const candidateName =
                      (data.data &&
                        (data.data.name ||
                          data.data.toolName ||
                          data.data.action)) ||
                      undefined;
                    const safeName = toSafeString(candidateName, "Tool");

                    // Find existing tool call or create new one
                    let toolCall =
                      activeToolCalls.get(interruptId) ||
                      Array.from(activeToolCalls.values()).find(
                        (tc) => tc.name === safeName,
                      );

                    if (!toolCall) {
                      toolCall = {
                        id: interruptId || `tool_${Date.now()}`,
                        name: safeName,
                        status: "pending_approval",
                        message: `Approve ${safeName}?`,
                        segment: 0,
                        args: data.data?.args,
                        threadId: data.threadId,
                        interruptId: interruptId,
                      };
                      activeToolCalls.set(toolCall.id, toolCall);
                    } else {
                      // Update existing
                      toolCall.status = "pending_approval";
                      toolCall.message = `Approve ${safeName}?`;
                      toolCall.threadId = data.threadId;
                      toolCall.interruptId = interruptId;
                      toolCall.args = data.data?.args || toolCall.args;
                    }

                    setPendingApproval(toolCall);

                    // Add to UI - end current text part first
                    currentTextPart = null;

                    // Only add if not already in contentParts
                    const existsInParts = contentParts.some(
                      (p) =>
                        p.type === "tool_call" &&
                        p.toolCall?.id === toolCall.id,
                    );
                    if (!existsInParts) {
                      contentParts.push({
                        type: "tool_call",
                        content: "",
                        segment: toolCall.segment,
                        toolCall: toolCall,
                      });
                    }

                    setMessages((prev) => {
                      const lastMessage = prev[prev.length - 1];
                      if (
                        lastMessage?.role === "assistant" &&
                        lastMessage.id === assistantMessageId
                      ) {
                        // Update or add tool call
                        const updatedToolCalls = [
                          ...(lastMessage.toolCalls || []),
                        ];
                        const existingIndex = updatedToolCalls.findIndex(
                          (tc) => tc.id === toolCall.id,
                        );
                        if (existingIndex >= 0) {
                          updatedToolCalls[existingIndex] = toolCall;
                        } else {
                          updatedToolCalls.push(toolCall);
                        }

                        return [
                          ...prev.slice(0, -1),
                          {
                            ...lastMessage,
                            toolCalls: updatedToolCalls,
                            structuredContent:
                              mergeStructuredPartsWithLatestToolStatuses(
                                contentParts,
                                updatedToolCalls,
                              ),
                          },
                        ];
                      }
                      return prev;
                    });
                  }
                }

                // Handle tool_result events (handled by main tool_result listener above)
                else if (currentEventType === "tool_result") {
                  try {
                    const completedId: string | undefined =
                      data?.id || data?.toolCallId;
                    const result = data?.result;
                    applyToolResultUpdate(completedId, result);
                  } catch {}
                }

                // Handle parallel execution events
                else if (currentEventType === "parallel_execution_detected") {
                  console.log("🚀 Parallel execution detected:", data);

                  // Add parallel execution indicator to the UI
                  if (currentTextPart) {
                    currentTextPart.content += `\n\n🚀 *Detected ${data.toolNames?.length || "multiple"} tools - evaluating for parallel execution...*\n`;
                  } else {
                    currentTextPart = {
                      type: "text",
                      content: `\n\n🚀 *Detected ${data.toolNames?.length || "multiple"} tools - evaluating for parallel execution...*\n`,
                      segment: contentParts.length,
                    };
                    contentParts.push(currentTextPart);
                  }

                  setMessages((prev) => {
                    const lastMessage = prev[prev.length - 1];
                    if (
                      lastMessage?.role === "assistant" &&
                      lastMessage.id === assistantMessageId
                    ) {
                      return [
                        ...prev.slice(0, -1),
                        {
                          ...lastMessage,
                          structuredContent:
                            mergeStructuredPartsWithLatestToolStatuses(
                              contentParts,
                              lastMessage.toolCalls || [],
                            ),
                        },
                      ];
                    }
                    return prev;
                  });
                }

                // Handle parallel execution start
                else if (currentEventType === "parallel_execution_start") {
                  console.log("⚡ Parallel execution starting:", data);

                  if (currentTextPart) {
                    // Avoid appending to Q/A blockquotes
                    const canAppend =
                      currentTextPart.type === "text" &&
                      !String(currentTextPart.content)
                        .trimStart()
                        .startsWith("> ");
                    if (canAppend) {
                      currentTextPart.content += `\n⚡ *Starting parallel execution of ${data.toolNames?.length || "multiple"} tools...*\n`;
                    } else {
                      currentTextPart = {
                        type: "text",
                        content: `\n⚡ *Starting parallel execution of ${data.toolNames?.length || "multiple"} tools...*\n`,
                        segment: contentParts.length,
                      };
                      contentParts.push(currentTextPart);
                    }
                  } else {
                    currentTextPart = {
                      type: "text",
                      content: `\n⚡ *Starting parallel execution of ${data.toolNames?.length || "multiple"} tools...*\n`,
                      segment: contentParts.length,
                    };
                    contentParts.push(currentTextPart);
                  }

                  // If server provides tool names, start a new parallel group and wait for those tools
                  if (
                    Array.isArray(data.toolNames) &&
                    data.toolNames.length > 0
                  ) {
                    currentParallelGroupId = `pg_${Date.now()}`;
                  }

                  setMessages((prev) => {
                    const lastMessage = prev[prev.length - 1];
                    if (
                      lastMessage?.role === "assistant" &&
                      lastMessage.id === assistantMessageId
                    ) {
                      return [
                        ...prev.slice(0, -1),
                        {
                          ...lastMessage,
                          structuredContent:
                            mergeStructuredPartsWithLatestToolStatuses(
                              contentParts,
                              lastMessage.toolCalls || [],
                            ),
                        },
                      ];
                    }
                    return prev;
                  });
                }

                // Handle parallel execution completion - clear grouping
                else if (currentEventType === "parallel_execution_complete") {
                  console.log("🏁 Parallel execution completed:", data);
                  currentParallelGroupId = null;
                }

                // Handle plan_start events
                else if (currentEventType === "plan_start") {
                  console.log("🧠 Planning started");
                  setMessages((prev) => {
                    const lastMessage = prev[prev.length - 1];
                    if (
                      lastMessage?.role === "assistant" &&
                      lastMessage.id === assistantMessageId
                    ) {
                      return [
                        ...prev.slice(0, -1),
                        {
                          ...lastMessage,
                          plan: { steps: [], status: "planning" },
                        },
                      ];
                    }
                    return prev;
                  });
                }

                // Handle plan events
                else if (currentEventType === "plan") {
                  console.log("📝 Plan content received:", data.content);
                  try {
                    const content = data.content
                      .replace(/^```json\s*/, "")
                      .replace(/```$/, "");
                    const planData = JSON.parse(content);
                    setMessages((prev) => {
                      const lastMessage = prev[prev.length - 1];
                      if (
                        lastMessage?.role === "assistant" &&
                        lastMessage.id === assistantMessageId
                      ) {
                        return [
                          ...prev.slice(0, -1),
                          {
                            ...lastMessage,
                            plan: {
                              steps: planData.steps || [],
                              status: "complete",
                            },
                          },
                        ];
                      }
                      return prev;
                    });
                  } catch (e) {
                    console.error("Failed to parse plan data", e);
                  }
                }

                // Handle reflection_start events
                else if (currentEventType === "reflection_start") {
                  console.log("🔍 Reflection started");
                  setMessages((prev) => {
                    const lastMessage = prev[prev.length - 1];
                    if (
                      lastMessage?.role === "assistant" &&
                      lastMessage.id === assistantMessageId
                    ) {
                      return [
                        ...prev.slice(0, -1),
                        {
                          ...lastMessage,
                          reflection: { content: "", status: "reflecting" },
                        },
                      ];
                    }
                    return prev;
                  });
                }

                // Handle reflection events
                else if (currentEventType === "reflection") {
                  console.log(
                    "🔍 Reflection content received:",
                    `${data.content?.substring(0, 100)}...`,
                  );
                  setMessages((prev) => {
                    const lastMessage = prev[prev.length - 1];
                    if (
                      lastMessage?.role === "assistant" &&
                      lastMessage.id === assistantMessageId
                    ) {
                      return [
                        ...prev.slice(0, -1),
                        {
                          ...lastMessage,
                          reflection: {
                            content: data.content || "",
                            status: "complete",
                          },
                        },
                      ];
                    }
                    return prev;
                  });
                }

                // Handle sequential execution required
                else if (currentEventType === "sequential_execution_required") {
                  console.log("🔒 Sequential execution required:", data);

                  if (currentTextPart) {
                    const canAppend =
                      currentTextPart.type === "text" &&
                      !String(currentTextPart.content)
                        .trimStart()
                        .startsWith("> ");
                    if (canAppend) {
                      currentTextPart.content += `\n🔒 *Sequential execution required: ${data.message}*\n`;
                    } else {
                      currentTextPart = {
                        type: "text",
                        content: `\n🔒 *Sequential execution required: ${data.message}*\n`,
                        segment: contentParts.length,
                      };
                      contentParts.push(currentTextPart);
                    }
                  } else {
                    currentTextPart = {
                      type: "text",
                      content: `\n🔒 *Sequential execution required: ${data.message}*\n`,
                      segment: contentParts.length,
                    };
                    contentParts.push(currentTextPart);
                  }

                  setMessages((prev) => {
                    const lastMessage = prev[prev.length - 1];
                    if (
                      lastMessage?.role === "assistant" &&
                      lastMessage.id === assistantMessageId
                    ) {
                      return [
                        ...prev.slice(0, -1),
                        {
                          ...lastMessage,
                          structuredContent:
                            mergeStructuredPartsWithLatestToolStatuses(
                              contentParts,
                              lastMessage.toolCalls || [],
                            ),
                        },
                      ];
                    }
                    return prev;
                  });

                  // Explicitly end any active parallel grouping to prevent
                  // subsequent sequential tools from nesting under it
                  currentParallelGroupId = null;
                }

                // Legacy event handling for backwards compatibility
                else if (
                  typeof data.toolName === "string" &&
                  typeof data.message === "string" &&
                  data.message.includes("execute")
                ) {
                  console.log("🛑 Tool approval required:", data.toolName);

                  const safeName = toSafeString(data.toolName, "Tool");
                  const incomingId: string | undefined = data.toolCallId;

                  // Guard 1: If this approval is already in-flight (or has a live stream), skip
                  if (
                    (incomingId &&
                      activeEventSourcesRef.current.has(incomingId)) ||
                    (incomingId && pendingApprovalsRef.current.has(incomingId))
                  ) {
                    console.log(
                      "↩️ Skipping legacy approval tile: already in-flight",
                      incomingId,
                    );
                    continue;
                  }

                  // Guard 2: If a matching non-completed tool already exists, skip creating another
                  const adoptable = new Set([
                    "pending_approval",
                    "approved",
                    "starting",
                    "running",
                  ]);
                  const lowerName = (safeName || "").toLowerCase();

                  const existsInParts = contentParts.some(
                    (p) =>
                      p.type === "tool_call" &&
                      p.toolCall &&
                      (p.toolCall.id === incomingId ||
                        (adoptable.has(p.toolCall.status as any) &&
                          (p.toolCall.name || "").toLowerCase() === lowerName)),
                  );
                  if (existsInParts) {
                    console.log(
                      "↩️ Skipping legacy approval tile: already represented in parts",
                    );
                    continue;
                  }

                  // Guard 3: Check existing UI message toolCalls
                  let existsInUI = false;
                  const lastMessageGuard = messages[messages.length - 1];
                  if (lastMessageGuard?.role === "assistant") {
                    existsInUI = (lastMessageGuard.toolCalls || []).some(
                      (tc) =>
                        tc.id === incomingId ||
                        (adoptable.has(tc.status as any) &&
                          (tc.name || "").toLowerCase() === lowerName),
                    );
                  }
                  if (existsInUI) {
                    console.log(
                      "↩️ Skipping legacy approval tile: already represented in UI",
                    );
                    continue;
                  }

                  const toolCall: ToolCall = {
                    id: incomingId || `tool_${Date.now()}`,
                    name: safeName,
                    status: "pending_approval",
                    message: toSafeString(data.message, `Approve ${safeName}?`),
                    segment: data.segment || 0,
                    args: data.toolArgs,
                    threadId: data.threadId,
                    interruptId: data.toolCallId,
                  };

                  // Set pending approval
                  setPendingApproval(toolCall);

                  // End current text part and add tool call
                  currentTextPart = null;
                  contentParts.push({
                    type: "tool_call",
                    content: "",
                    segment: toolCall.segment,
                    toolCall: toolCall,
                  });

                  setMessages((prev) => {
                    const lastMessage = prev[prev.length - 1];
                    if (
                      lastMessage?.role === "assistant" &&
                      lastMessage.id === assistantMessageId
                    ) {
                      const updatedToolCalls = upsertToolCall(
                        lastMessage.toolCalls || [],
                        toolCall,
                      );
                      return [
                        ...prev.slice(0, -1),
                        {
                          ...lastMessage,
                          toolCalls: updatedToolCalls,
                          structuredContent:
                            mergeStructuredPartsWithLatestToolStatuses(
                              contentParts,
                              updatedToolCalls,
                            ),
                        },
                      ];
                    }
                    return prev;
                  });
                }

                // Handle tool_start events (for approved tools)
                else if (
                  data.id &&
                  typeof data.name === "string" &&
                  typeof data.message === "string" &&
                  data.message.includes("Using")
                ) {
                  console.log("🛠️ Tool started:", data.name);

                  const safeName = toSafeString(data.name, "Tool");
                  const toolCall: ToolCall = {
                    id: data.id,
                    name: safeName,
                    status: data.canRunInParallel
                      ? "parallel_executing"
                      : "starting",
                    message: toSafeString(data.message, `Using ${safeName}...`),
                    segment: data.segment || 0,
                    canRunInParallel: data.canRunInParallel || false,
                    requiresApproval: data.requiresApproval || false,
                    parallelGroup: currentParallelGroupId || undefined,
                  };

                  activeToolCalls.set(data.id, toolCall);

                  // Reconcile with any non-completed tile before adding a new one
                  let adoptedStart = false;
                  const adoptableStatuses2 = new Set([
                    "pending_approval",
                    "approved",
                    "starting",
                    "running",
                  ]);
                  for (let k = contentParts.length - 1; k >= 0; k--) {
                    const part = contentParts[k];
                    if (part.type !== "tool_call" || !part.toolCall) continue;
                    if (!adoptableStatuses2.has(part.toolCall.status as any))
                      continue;
                    const prevName = (part.toolCall.name || "").toLowerCase();
                    const newName = (safeName || "").toLowerCase();
                    if (prevName === newName || newName === "tool") {
                      part.toolCall = {
                        ...part.toolCall,
                        id: toolCall.id,
                        name:
                          safeName !== "Tool" ? safeName : part.toolCall.name,
                        status: toolCall.status,
                        message: toolCall.message,
                        args: toolCall.args ?? part.toolCall.args,
                        parallelGroup: toolCall.parallelGroup,
                      } as ToolCall;
                      adoptedStart = true;
                      break;
                    }
                  }

                  if (!adoptedStart) {
                    // End current text part and add tool call
                    currentTextPart = null;
                    contentParts.push({
                      type: "tool_call",
                      content: "",
                      segment: toolCall.segment,
                      toolCall: toolCall,
                    });
                  }

                  setMessages((prev) => {
                    const lastMessage = prev[prev.length - 1];
                    if (
                      lastMessage?.role === "assistant" &&
                      lastMessage.id === assistantMessageId
                    ) {
                      // If we adopted onto an existing tile, update in place
                      let updatedToolCalls: ToolCall[] = [];
                      if (adoptedStart) {
                        const adoptable = [
                          "pending_approval",
                          "approved",
                          "starting",
                          "running",
                        ];
                        let pendingIndex = -1;
                        const lowerName = (safeName || "").toLowerCase();
                        for (
                          let i = (lastMessage.toolCalls || []).length - 1;
                          i >= 0;
                          i--
                        ) {
                          const tc = (lastMessage.toolCalls || [])[i];
                          if (!tc) continue;
                          if (!adoptable.includes(tc.status as string))
                            continue;
                          const tn = (tc.name || "").toLowerCase();
                          if (lowerName !== "tool" && tn === lowerName) {
                            pendingIndex = i;
                            break;
                          }
                          if (pendingIndex < 0) pendingIndex = i;
                        }
                        if (pendingIndex >= 0) {
                          updatedToolCalls = (lastMessage.toolCalls || []).map(
                            (tc, i) =>
                              i === pendingIndex
                                ? {
                                    ...tc,
                                    id: toolCall.id,
                                    name:
                                      safeName !== "Tool" ? safeName : tc.name,
                                    status: toolCall.status,
                                    message: toolCall.message,
                                    args: toolCall.args ?? tc.args,
                                    parallelGroup: toolCall.parallelGroup,
                                  }
                                : tc,
                          );
                        } else {
                          updatedToolCalls = upsertToolCall(
                            lastMessage.toolCalls || [],
                            toolCall,
                          );
                        }
                      } else {
                        updatedToolCalls = upsertToolCall(
                          lastMessage.toolCalls || [],
                          toolCall,
                        );
                      }
                      return [
                        ...prev.slice(0, -1),
                        {
                          ...lastMessage,
                          toolCalls: updatedToolCalls,
                          structuredContent:
                            mergeStructuredPartsWithLatestToolStatuses(
                              contentParts,
                              updatedToolCalls,
                            ),
                        },
                      ];
                    }
                    return prev;
                  });
                }

                // Handle tool_complete events
                else if (
                  typeof data.name === "string" &&
                  typeof data.message === "string" &&
                  data.message.includes("completed")
                ) {
                  console.log("✅ Tool completed:", data.name);

                  // Find and update the tool call
                  const toolCall = Array.from(activeToolCalls.values()).find(
                    (tc) => tc.name === data.name,
                  );
                  if (toolCall) {
                    toolCall.status = "completed";
                    toolCall.message = `${toolCall.name} completed`;
                    // Persist update in active map so group checks are accurate
                    activeToolCalls.set(toolCall.id, toolCall);

                    setMessages((prev) => {
                      const lastMessage = prev[prev.length - 1];
                      if (
                        lastMessage?.role === "assistant" &&
                        lastMessage.id === assistantMessageId
                      ) {
                        const updatedToolCalls = (
                          lastMessage.toolCalls || []
                        ).map((tc) => (tc.id === toolCall.id ? toolCall : tc));

                        // Update the tool call in content parts
                        const updatedContentParts = contentParts.map((part) =>
                          part.toolCall?.id === toolCall.id
                            ? { ...part, toolCall: toolCall }
                            : part,
                        );

                        // Reset current text part for new content after tool completion
                        currentTextPart = null;

                        return [
                          ...prev.slice(0, -1),
                          {
                            ...lastMessage,
                            toolCalls: updatedToolCalls,
                            structuredContent: updatedContentParts,
                          },
                        ];
                      }
                      return prev;
                    });

                    // If this tool was part of the current parallel group,
                    // and no other tools in that group are still active,
                    // end the group to avoid nesting future sequential tools
                    const justCompletedGroup = toolCall.parallelGroup;
                    if (
                      justCompletedGroup &&
                      currentParallelGroupId === justCompletedGroup
                    ) {
                      const anyActiveInGroup = Array.from(
                        activeToolCalls.values(),
                      ).some(
                        (tc) =>
                          tc.parallelGroup === justCompletedGroup &&
                          [
                            "starting",
                            "running",
                            "parallel_executing",
                            "pending_approval",
                            "approved",
                          ].includes(tc.status as string),
                      );
                      if (!anyActiveInGroup) {
                        currentParallelGroupId = null;
                      }
                    }
                  }
                }

                // Handle content events - simple content accumulation
                else if (
                  typeof data.content === "string" &&
                  data.content.trim() !== "" &&
                  data.content !== "[object Object]" &&
                  !data.content.includes("[object Object]")
                ) {
                  // Guard: do NOT stream agent text into the inline human_input panel.
                  // We only update assistant content here; the panel is rendered separately.
                  if (!hasStartedContent) {
                    hasStartedContent = true;
                    setMessages((prev) => {
                      const lastMessage = prev[prev.length - 1];
                      if (
                        lastMessage?.role === "assistant" &&
                        lastMessage.id === assistantMessageId
                      ) {
                        return [
                          ...prev.slice(0, -1),
                          { ...lastMessage, content: "" },
                        ];
                      }
                      return prev;
                    });
                    aiContent = "";
                  }

                  const cleanedChunk = data.content.replace(
                    /\[object Object\]/g,
                    "",
                  );

                  // Check for email/docs tag start
                  if (
                    !insideEmailDocTags &&
                    /<(gmail|docs|sheets|calendar|documents|emails)>/.test(
                      cleanedChunk,
                    )
                  ) {
                    insideEmailDocTags = true;
                    const tagMatch = cleanedChunk.match(
                      /<(gmail|docs|sheets|calendar|documents|emails)>/,
                    );
                    currentTag = tagMatch ? tagMatch[1] : "";
                    tagBuffer = cleanedChunk;
                    console.log(
                      "🤐 SUPPRESSING EMAIL/DOCS STREAMING - Tag detected:",
                      currentTag,
                    );
                    return; // Don't update UI during tag content
                  }

                  // If inside tags, buffer content and check for end
                  if (insideEmailDocTags) {
                    tagBuffer += cleanedChunk;

                    // Check if tag is complete
                    const endTagPattern = new RegExp(`</${currentTag}>`);
                    if (endTagPattern.test(tagBuffer)) {
                      console.log(
                        "✅ EMAIL/DOCS TAG COMPLETE - Showing UI now",
                      );

                      // Add the complete tag content
                      aiContent += tagBuffer;

                      // Simple text part handling for complete tag
                      const targetSegment = data.segment || 0;
                      if (
                        currentTextPart &&
                        currentTextPart.segment === targetSegment
                      ) {
                        currentTextPart.content += tagBuffer;
                      } else {
                        currentTextPart = {
                          type: "text",
                          content: tagBuffer,
                          segment: targetSegment,
                          conversationRound:
                            data.conversationRound || currentConversationRound,
                        };
                        contentParts.push(currentTextPart);
                      }

                      // Reset tag state
                      insideEmailDocTags = false;
                      tagBuffer = "";
                      currentTag = "";
                    } else {
                      return; // Still inside tag, don't update UI
                    }
                  } else {
                    // Normal content - stream as usual
                    aiContent += cleanedChunk;

                    // Simple text part handling
                    const targetSegment = data.segment || 0;
                    if (
                      currentTextPart &&
                      currentTextPart.segment === targetSegment
                    ) {
                      currentTextPart.content += cleanedChunk;
                    } else {
                      currentTextPart = {
                        type: "text",
                        content: cleanedChunk,
                        segment: targetSegment,
                        conversationRound:
                          data.conversationRound || currentConversationRound,
                      };
                      contentParts.push(currentTextPart);
                    }
                  }

                  setMessages((prev) => {
                    const lastMessage = prev[prev.length - 1];
                    if (
                      lastMessage?.role === "assistant" &&
                      lastMessage.id === assistantMessageId
                    ) {
                      return [
                        ...prev.slice(0, -1),
                        {
                          ...lastMessage,
                          content: aiContent,
                          structuredContent:
                            mergeStructuredPartsWithLatestToolStatuses(
                              contentParts,
                              lastMessage.toolCalls || [],
                            ),
                        },
                      ];
                    }
                    return prev;
                  });
                }
              } catch (e) {
                console.warn("Failed to parse SSE data:", dataStr);
              }
            }
          }
        }

        // Final cleanup: ensure content is a clean string and not [object Object]
        setMessages((prev) => {
          return prev.map((msg) => {
            if (msg.role === "assistant" && msg.id === assistantMessageId) {
              let finalContent = "";

              if (typeof msg.content === "string") {
                const cleaned = msg.content.replace(/\[object Object\]/g, "");
                // Only block thinking state and empty content
                if (cleaned.trim() !== "thinking..." && cleaned.trim() !== "") {
                  finalContent = cleaned;
                }
              } else {
                finalContent = "";
              }

              return {
                ...msg,
                content: finalContent,
              };
            }
            return msg;
          });
        });
      } catch (err) {
        // Don't show error if the request was aborted
        if (err instanceof Error && err.name !== "AbortError") {
          console.error("❌ Error sending message:", err);
          console.error("  - Error name:", err.name);
          console.error("  - Error message:", err.message);
          setError(err.message || "Failed to send message");

          // Remove thinking message on error
          setMessages((prev) => {
            const lastMessage = prev[prev.length - 1];
            if (
              lastMessage?.role === "assistant" &&
              lastMessage.content === "thinking..."
            ) {
              return prev.slice(0, -1);
            }
            return prev;
          });
        }
      } finally {
        if (abortControllerRef.current === abortController) {
          abortControllerRef.current = null;
          setIsLoading(false);
        }
      }
    },
    [messages, cleanupEventSources],
  );

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
    cleanupEventSources();
  }, [cleanupEventSources]);

  return {
    messages,
    isLoading,
    error,
    sendMessage,
    clearMessages,
    cancelRequest,
    approveToolCall,
    pendingApproval,
    pendingHumanInput,
    submitHumanInput,
  };
}
