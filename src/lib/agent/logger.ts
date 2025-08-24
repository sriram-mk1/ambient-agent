// ================================================================================================
// 🎯 AI AGENT LOGGER - Clean, Structured Logging
// ================================================================================================

interface ConversationContext {
  conversationId: string;
  messageNumber: number;
  userMessage: string;
  userId: string;
}

interface LogEntry {
  timestamp: string;
  level: 'INFO' | 'WARN' | 'ERROR' | 'FLOW';
  context?: ConversationContext;
  message: string;
  data?: any;
}

class AgentLogger {
  private static instance: AgentLogger;
  private enabled: boolean = true;
  private currentContext: ConversationContext | null = null;

  private constructor() {}

  static getInstance(): AgentLogger {
    if (!AgentLogger.instance) {
      AgentLogger.instance = new AgentLogger();
    }
    return AgentLogger.instance;
  }

  setContext(context: ConversationContext) {
    this.currentContext = context;
  }

  clearContext() {
    this.currentContext = null;
  }

  private formatMessage(level: string, message: string, data?: any): string {
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];

    if (this.currentContext) {
      const { conversationId, messageNumber, userMessage, userId } = this.currentContext;
      const shortUserId = userId === 'anonymous' ? 'anon' : userId.slice(-6);
      const shortUserMessage = userMessage.length > 50
        ? userMessage.substring(0, 47) + '...'
        : userMessage;

      return `[${timestamp}] ${level} #${messageNumber} (${shortUserId}) "${shortUserMessage}" | ${message}`;
    }

    return `[${timestamp}] ${level} | ${message}`;
  }

  private log(level: 'INFO' | 'WARN' | 'ERROR' | 'FLOW', message: string, data?: any) {
    if (!this.enabled) return;

    const formatted = this.formatMessage(level, message, data);

    switch (level) {
      case 'ERROR':
        console.error(formatted);
        if (data) console.error(data);
        break;
      case 'WARN':
        console.warn(formatted);
        if (data) console.warn(data);
        break;
      case 'FLOW':
        console.log(`🔄 ${formatted}`);
        if (data) console.log(data);
        break;
      default:
        console.log(formatted);
        if (data) console.log(data);
    }
  }

  // Main workflow events
  startConversation(context: ConversationContext, isResume: boolean = false) {
    this.setContext(context);
    const action = isResume ? 'RESUMING' : 'STARTING';
    console.log('\n' + '='.repeat(80));
    console.log(`🤖 AI AGENT ${action} - Conversation #${context.messageNumber}`);
    console.log(`👤 User: ${context.userId === 'anonymous' ? 'Anonymous' : context.userId}`);
    console.log(`💬 Message: "${context.userMessage}"`);
    console.log('='.repeat(80));
  }

  agentNode(messageCount: number, hasContent: boolean, hasToolCalls: boolean, toolNames?: string[]) {
    const tools = toolNames && toolNames.length > 0 ? ` → Tools: ${toolNames.join(', ')}` : '';
    this.log('FLOW', `[Agent Node] ${messageCount} messages processed${hasContent ? ' → Generated content' : ''}${hasToolCalls ? tools : ' → No tools'}`);
  }

  toolNode(toolName: string, status: 'executing' | 'completed' | 'approved' | 'rejected') {
    const emoji = status === 'completed' ? '✅' : status === 'approved' ? '👍' : status === 'rejected' ? '❌' : '⚙️';
    this.log('FLOW', `[Tool Node] ${emoji} ${toolName} ${status}`);
  }

  decision(decision: 'tools' | 'end', toolCount?: number) {
    if (decision === 'tools') {
      this.log('FLOW', `[Decision] → Tools (${toolCount} calls)`);
    } else {
      this.log('FLOW', `[Decision] → End conversation`);
    }
  }

  humanApproval(toolName: string, toolCallId: string) {
    this.log('FLOW', `[Human Approval] Waiting for approval: ${toolName} (${toolCallId})`);
  }

  streaming(phase: 'start' | 'content' | 'tool_result' | 'done', details?: string) {
    switch (phase) {
      case 'start':
        this.log('INFO', '[Streaming] Started');
        break;
      case 'content':
        this.log('INFO', `[Streaming] Content: ${details}`);
        break;
      case 'tool_result':
        this.log('INFO', `[Streaming] Tool result: ${details}`);
        break;
      case 'done':
        this.log('INFO', '[Streaming] Completed');
        break;
    }
  }

  // Messages
  info(message: string, data?: any) {
    this.log('INFO', message, data);
  }

  warn(message: string, data?: any) {
    this.log('WARN', message, data);
  }

  error(message: string, data?: any) {
    this.log('ERROR', message, data);
  }

  // Show full messages (not chunks)
  fullMessage(role: 'user' | 'assistant' | 'tool', content: string, metadata?: any) {
    const emoji = role === 'user' ? '👤' : role === 'assistant' ? '🤖' : '🛠️';
    const preview = content.length > 200 ? content.substring(0, 197) + '...' : content;
    this.log('INFO', `${emoji} ${role.toUpperCase()}: "${preview}"`);
    if (metadata) {
      this.log('INFO', `   Metadata:`, metadata);
    }
  }

  // Configuration
  enable() {
    this.enabled = true;
  }

  disable() {
    this.enabled = false;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  // Completion
  endConversation(totalChunks?: number, duration?: number) {
    const stats = totalChunks ? ` | ${totalChunks} chunks` : '';
    const time = duration ? ` | ${duration}ms` : '';
    this.log('INFO', `🏁 Conversation completed${stats}${time}`);
    console.log('='.repeat(80) + '\n');
    this.clearContext();
  }
}

// Export singleton instance
export const agentLogger = AgentLogger.getInstance();

// Export types for external use
export type { ConversationContext };
