import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Env, Props } from "./types";
import { homeContent, layout } from "./utils";
import { Hono } from "hono";
import { z } from "zod"; // Import zod

const app = new Hono<{
	Bindings: Env;
}>();

export class MyMCP extends McpAgent<Env, Record<string, never>, Props> {
	server = new McpServer({
		name: "Gmail MCP Server",
		version: "1.0.0",
	});

	async init() {
		// Helper function to decode base64url
		function decodeBase64Url(str: string): string {
			// Replace URL-safe characters and add padding
			str = str.replace(/-/g, '+').replace(/_/g, '/');
			while (str.length % 4) {
				str += '=';
			}
			
			try {
				return atob(str);
			} catch (e) {
				return str; // Return original if decoding fails
			}
		}

		// Helper function to make Gmail API calls
		async function makeGmailApiCall(
			endpoint: string, 
			bearerToken: string,
			options: RequestInit = {}
		): Promise<Response> {
			const url = `https://gmail.googleapis.com/gmail/v1${endpoint}`;
			
			return fetch(url, {
				...options,
				headers: {
					'Authorization': `${bearerToken}`,
					'Content-Type': 'application/json',
					...options.headers,
				},
			});
		}

		// Gmail tool schemas
		const ListEmailsSchema = {
			maxResults: z
				.number()
				.optional()
				.default(10)
				.describe("Maximum number of emails to retrieve (default: 10, max: 100)"),
			query: z
				.string()
				.optional()
				.describe("Gmail search query (e.g., 'is:unread', 'from:example@gmail.com', 'subject:meeting')")
		};

		const GetEmailSchema = {
			messageId: z
				.string()
				.min(1, "Message ID cannot be empty")
				.describe("Gmail message ID to retrieve")
		};

		const SendEmailSchema = {
			to: z
				.string()
				.describe("Recipient email address"),
			subject: z
				.string()
				.min(1, "Subject cannot be empty")
				.describe("Email subject"),
			body: z
				.string()
				.min(1, "Email body cannot be empty")
				.describe("Email body content (HTML or plain text)")
		};

		const GetInboxStatsSchema = {};

		const ModifyEmailLabelSchema = {
			messageId: z
				.string()
				.min(1, "Message ID cannot be empty")
				.describe("The ID of the message to modify."),
			addLabelIds: z
				.array(z.string())
				.optional()
				.describe("Array of label IDs to add to the message."),
			removeLabelIds: z
				.array(z.string())
				.optional()
				.describe("Array of label IDs to remove from the message.")
		};

		const MoveEmailSchema = {
			messageId: z
				.string()
				.min(1, "Message ID cannot be empty")
				.describe("The ID of the message to move."),
			targetLabelId: z
				.string()
				.min(1, "Target label ID cannot be empty")
				.describe("The ID of the label to move the message to.")
		};

		const DeleteEmailSchema = {
			messageId: z
				.string()
				.min(1, "Message ID cannot be empty")
				.describe("The ID of the message to delete.")
		};

		const ListLabelsSchema = {};

		// Additional schemas
		const ListThreadsSchema = {
			maxResults: z.number().optional().default(10).describe("Max threads to list (default 10, max 100)"),
			query: z.string().optional().describe("Gmail search query applied to threads"),
			pageToken: z.string().optional().describe("Pagination token from previous response"),
		};

		const GetThreadSchema = {
			threadId: z.string().min(1, "Thread ID cannot be empty").describe("Gmail thread ID to retrieve"),
			format: z.enum(["full","metadata","minimal","raw"]).optional().default("metadata"),
			metadataHeaders: z.array(z.string()).optional().default(["Subject","From","To","Cc","Bcc","Date","Message-Id"]),
		};

		const GetAttachmentSchema = {
			messageId: z.string().min(1).describe("Message ID that contains the attachment"),
			attachmentId: z.string().min(1).describe("Attachment ID from the message payload"),
			decode: z.boolean().optional().default(false).describe("Attempt to decode as UTF-8 text and include preview"),
			previewMaxChars: z.number().optional().default(20000).describe("Max decoded characters to include in preview"),
		};

		const CreateLabelSchema = {
			name: z.string().min(1).describe("Label name"),
			labelListVisibility: z.enum(["labelShow","labelShowIfUnread","labelHide"]).optional(),
			messageListVisibility: z.enum(["show","hide"]).optional(),
		};

		const UpdateLabelSchema = {
			labelId: z.string().min(1),
			name: z.string().optional(),
			labelListVisibility: z.enum(["labelShow","labelShowIfUnread","labelHide"]).optional(),
			messageListVisibility: z.enum(["show","hide"]).optional(),
		};

		const DeleteLabelSchema = {
			labelId: z.string().min(1),
		};

		const CreateDraftSchema = {
			to: z.string(),
			cc: z.string().optional(),
			bcc: z.string().optional(),
			subject: z.string().min(1),
			body: z.string().min(1),
			isHtml: z.boolean().optional().default(false),
		};

		const SendDraftSchema = {
			draftId: z.string().min(1),
		};

		const ReplyEmailSchema = {
			messageId: z.string().min(1).describe("Message ID to reply to"),
			body: z.string().min(1),
			isHtml: z.boolean().optional().default(false),
		};

		const BatchIdsSchema = {
			messageIds: z.array(z.string().min(1)).min(1, "Provide at least one messageId"),
		};

		const BatchMoveToLabelSchema = {
			messageIds: z.array(z.string().min(1)).min(1),
			targetLabelId: z.string().min(1),
			removeFromInbox: z.boolean().optional().default(true),
		};

		// Tool 1: List Emails
		this.server.tool(
			"listEmails",
			"Retrieve a list of emails from Gmail. Supports Gmail search queries like 'is:unread', 'from:example@gmail.com', etc.",
			ListEmailsSchema,
			async ({ maxResults = 10, query = "" }) => {
				try {
					const clampedMaxResults = Math.min(Math.max(1, maxResults), 100);
					
					let endpoint = `/users/me/messages?maxResults=${clampedMaxResults}`;
					if (query) {
						endpoint += `&q=${encodeURIComponent(query)}`;
					}
					
					const response = await makeGmailApiCall(endpoint, this.props.bearerToken);
					
					if (!response.ok) {
						const error = await response.text();
						return {
							content: [{
								type: "text",
								text: `**Error**\n\nGmail API error: ${response.status} ${response.statusText}\n\n**Details:**\n${error}`,
								isError: true
							}]
						};
					}
					
					const data = await response.json() as any;
					const messages = data.messages || [];
					
					if (messages.length === 0) {
						return {
							content: [{
								type: "text",
								text: "**Gmail Emails**\n\nNo emails found matching the query."
							}]
						};
					}
					
					// Get detailed info for each message
					const emailDetails = await Promise.all(
						messages.slice(0, clampedMaxResults).map(async (message: any) => {
							const detailResponse = await makeGmailApiCall(
								`/users/me/messages/${message.id}`, 
								this.props.bearerToken
							);
							
							if (!detailResponse.ok) {
								return { id: message.id, error: "Failed to fetch details" };
							}
							
							const detail = await detailResponse.json() as any;
							const headers = detail.payload?.headers || [];
							
							const getHeader = (name: string) => 
								headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || "";
							
							return {
								id: message.id,
								threadId: message.threadId,
								subject: getHeader("Subject"),
								from: getHeader("From"),
								to: getHeader("To"),
								date: getHeader("Date"),
								snippet: detail.snippet || "",
								labelIds: detail.labelIds || [],
								isUnread: detail.labelIds?.includes("UNREAD") || false,
							};
						})
					);
					
					return {
						content: [{
							type: "text",
							text: `**Gmail Emails**\n\nFound ${emailDetails.length} emails${query ? ` matching query: "${query}"` : ""}\n\n**Results:**\n\`\`\`json\n${JSON.stringify(emailDetails, null, 2)}\n\`\`\``
						}]
					};
					
				} catch (error) {
					console.error('listEmails error:', error);
					return {
						content: [{
							type: "text",
							text: `**Error**\n\nError retrieving emails: ${error}`,
							isError: true
						}]
					};
				}
			}
		);
		
		// Tool 2: Get Email Details
		this.server.tool(
			"getEmail",
			"Retrieve full details of a specific email by message ID, including the body content.",
			GetEmailSchema,
			async ({ messageId }) => {
				try {
					const response = await makeGmailApiCall(
						`/users/me/messages/${messageId}?format=full`, 
						this.props.bearerToken
					);
					
					if (!response.ok) {
						const error = await response.text();
						return {
							content: [{
								type: "text",
								text: `**Error**\n\nGmail API error: ${response.status} ${response.statusText}\n\n**Details:**\n${error}`,
								isError: true
							}]
						};
					}
					
					const data = await response.json() as any;
					const headers = data.payload?.headers || [];
					
					const getHeader = (name: string) => 
						headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || "";
					
					// Extract email body
					let bodyText = "";
					let bodyHtml = "";
					
					function extractBody(payload: any) {
						if (payload.parts) {
							// Multipart message
							for (const part of payload.parts) {
								if (part.mimeType === "text/plain" && part.body?.data) {
									bodyText = decodeBase64Url(part.body.data);
								} else if (part.mimeType === "text/html" && part.body?.data) {
									bodyHtml = decodeBase64Url(part.body.data);
								} else if (part.parts) {
									extractBody(part); // Recursive for nested parts
								}
							}
						} else if (payload.body?.data) {
							// Single part message
							if (payload.mimeType === "text/plain") {
								bodyText = decodeBase64Url(payload.body.data);
							} else if (payload.mimeType === "text/html") {
								bodyHtml = decodeBase64Url(payload.body.data);
							}
						}
					}
					
					extractBody(data.payload);
					
					const emailDetails = {
						id: data.id,
						threadId: data.threadId,
						subject: getHeader("Subject"),
						from: getHeader("From"),
						to: getHeader("To"),
						cc: getHeader("Cc"),
						bcc: getHeader("Bcc"),
						date: getHeader("Date"),
						snippet: data.snippet || "",
						bodyText,
						bodyHtml,
						labelIds: data.labelIds || [],
						isUnread: data.labelIds?.includes("UNREAD") || false,
						attachments: data.payload?.parts?.filter((part: any) => 
							part.filename && part.body?.attachmentId
						).map((part: any) => ({
							filename: part.filename,
							mimeType: part.mimeType,
							size: part.body?.size,
							attachmentId: part.body?.attachmentId,
						})) || [],
					};
					
					return {
						content: [{
							type: "text",
							text: `**Gmail Email Details**\n\nEmail retrieved successfully\n\n**Details:**\n\`\`\`json\n${JSON.stringify(emailDetails, null, 2)}\n\`\`\``
						}]
					};
					
				} catch (error) {
					console.error('getEmail error:', error);
					return {
						content: [{
							type: "text",
							text: `**Error**\n\nError retrieving email: ${error}`,
							isError: true
						}]
					};
				}
			}
		);
		
		// Tool 3: Send Email
		this.server.tool(
			"sendEmail",
			"Send an email through Gmail. Requires Gmail send permissions.",
			SendEmailSchema,
			async ({ to, subject, body }) => {
				try {
					// Create email in RFC 2822 format
					const emailContent = [
						`To: ${to}`,
						`Subject: ${subject}`,
						`From: ${this.props.email}`,
						``,
						body
					].join('\r\n');
					
					// Encode email content in base64url
					const encodedEmail = btoa(emailContent)
						.replace(/\+/g, '-')
						.replace(/\//g, '_')
						.replace(/=+$/, '');
					
					const response = await makeGmailApiCall(
						`/users/me/messages/send`,
						this.props.bearerToken,
						{
							method: 'POST',
							body: JSON.stringify({
								raw: encodedEmail
							})
						}
					);
					
					if (!response.ok) {
						const error = await response.text();
						return {
							content: [{
								type: "text",
								text: `**Error**\n\nGmail API error: ${response.status} ${response.statusText}\n\n**Details:**\n${error}`,
								isError: true
							}]
						};
					}
					
					const data = await response.json() as any;
					
					const result = {
						messageId: data.id,
						threadId: data.threadId,
						to,
						subject,
						from: this.props.email
					};
					
					return {
						content: [{
							type: "text",
							text: `**Email Sent Successfully**\n\nEmail sent to ${to}\n\n**Details:**\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``
						}]
					};
					
				} catch (error) {
					console.error('sendEmail error:', error);
					return {
						content: [{
							type: "text",
							text: `**Error**\n\nError sending email: ${error}`,
							isError: true
						}]
					};
				}
			}
		);
		
		// Tool 4: Get Inbox Statistics
		this.server.tool(
			"getInboxStats",
			"Get statistics about the Gmail inbox including unread count, total messages, and label information.",
			GetInboxStatsSchema,
			async () => {
				try {
					// Get profile info
					const profileResponse = await makeGmailApiCall(`/users/me/profile`, this.props.bearerToken);
					
					if (!profileResponse.ok) {
						const error = await profileResponse.text();
						return {
							content: [{
								type: "text",
								text: `**Error**\n\nGmail API error: ${profileResponse.status} ${profileResponse.statusText}\n\n**Details:**\n${error}`,
								isError: true
							}]
						};
					}
					
					const profile = await profileResponse.json() as any;
					
					// Get labels for additional stats
					const labelsResponse = await makeGmailApiCall(`/users/me/labels`, this.props.bearerToken);
					let labelStats = {};
					
					if (labelsResponse.ok) {
						const labelsData = await labelsResponse.json() as any;
						const systemLabels = labelsData.labels?.filter((label: any) => 
							['INBOX', 'SENT', 'DRAFT', 'UNREAD', 'SPAM', 'TRASH'].includes(label.id)
						) || [];
						
						labelStats = systemLabels.reduce((acc: any, label: any) => {
							acc[label.id] = {
								name: label.name,
								messagesTotal: label.messagesTotal || 0,
								messagesUnread: label.messagesUnread || 0,
								threadsTotal: label.threadsTotal || 0,
								threadsUnread: label.threadsUnread || 0,
							};
							return acc;
						}, {});
					}
					
					const stats = {
						emailAddress: profile.emailAddress,
						messagesTotal: profile.messagesTotal || 0,
						threadsTotal: profile.threadsTotal || 0,
						historyId: profile.historyId,
						labelStats
					};
					
					return {
						content: [{
							type: "text",
							text: `**Gmail Inbox Statistics**\n\nInbox statistics retrieved successfully\n\n**Statistics:**\n\`\`\`json\n${JSON.stringify(stats, null, 2)}\n\`\`\``
						}]
					};
					
				} catch (error) {
					console.error('getInboxStats error:', error);
					return {
						content: [{
							type: "text",
							text: `**Error**\n\nError retrieving inbox stats: ${error}`,
							isError: true
						}]
					};
				}
			}
		);

		// Tool 5: Mark Email as Read
		this.server.tool(
			"markEmailAsRead",
			"Marks a specific email as read by removing the UNREAD label.",
			ModifyEmailLabelSchema,
			async ({ messageId }) => {
				try {
					const response = await makeGmailApiCall(
						`/users/me/messages/${messageId}`,
						this.props.bearerToken,
						{
							method: 'PATCH',
							body: JSON.stringify({
								removeLabelIds: ["UNREAD"]
							})
						}
					);

					if (!response.ok) {
						const error = await response.text();
						return {
							content: [{
								type: "text",
								text: `**Error**\n\nGmail API error: ${response.status} ${response.statusText}\n\n**Details:**\n${error}`,
								isError: true
							}]
						};
					}

					return {
						content: [{
							type: "text",
							text: `**Email Marked as Read**\n\nEmail with ID "${messageId}" has been marked as read.`
						}]
					};
				} catch (error) {
					console.error('markEmailAsRead error:', error);
					return {
						content: [{
							type: "text",
							text: `**Error**\n\nError marking email as read: ${error}`,
							isError: true
						}]
					};
				}
			}
		);

		// Tool 6: Mark Email as Unread
		this.server.tool(
			"markEmailAsUnread",
			"Marks a specific email as unread by adding the UNREAD label.",
			ModifyEmailLabelSchema,
			async ({ messageId }) => {
				try {
					const response = await makeGmailApiCall(
						`/users/me/messages/${messageId}`,
						this.props.bearerToken,
						{
							method: 'PATCH',
							body: JSON.stringify({
								addLabelIds: ["UNREAD"]
							})
						}
					);

					if (!response.ok) {
						const error = await response.text();
						return {
							content: [{
								type: "text",
								text: `**Error**\n\nGmail API error: ${response.status} ${response.statusText}\n\n**Details:**\n${error}`,
								isError: true
							}]
						};
					}

					return {
						content: [{
							type: "text",
							text: `**Email Marked as Unread**\n\nEmail with ID "${messageId}" has been marked as unread.`
						}]
					};
				} catch (error) {
					console.error('markEmailAsUnread error:', error);
					return {
						content: [{
							type: "text",
							text: `**Error**\n\nError marking email as unread: ${error}`,
							isError: true
						}]
					};
				}
			}
		);

		// Tool 7: Move Email to Label
		this.server.tool(
			"moveEmailToLabel",
			"Moves an email to a specified label. This typically involves adding the target label and removing it from other labels like 'INBOX'.",
			MoveEmailSchema,
			async ({ messageId, targetLabelId }) => {
				try {
					const response = await makeGmailApiCall(
						`/users/me/messages/${messageId}`,
						this.props.bearerToken,
						{
							method: 'PATCH',
							body: JSON.stringify({
								addLabelIds: [targetLabelId],
								removeLabelIds: ["INBOX"] // Example: remove from inbox when moving to another label
							})
						}
					);

					if (!response.ok) {
						const error = await response.text();
						return {
							content: [{
								type: "text",
								text: `**Error**\n\nGmail API error: ${response.status} ${response.statusText}\n\n**Details:**\n${error}`,
								isError: true
							}]
						};
					}

					return {
						content: [{
							type: "text",
							text: `**Email Moved**\n\nEmail with ID "${messageId}" has been moved to label "${targetLabelId}".`
						}]
					};
				} catch (error) {
					console.error('moveEmailToLabel error:', error);
					return {
						content: [{
							type: "text",
							text: `**Error**\n\nError moving email: ${error}`,
							isError: true
						}]
					};
				}
			}
		);

		// Tool 8: Delete Email
		this.server.tool(
			"deleteEmail",
			"Deletes a specific email by moving it to the trash.",
			DeleteEmailSchema,
			async ({ messageId }) => {
				try {
					const response = await makeGmailApiCall(
						`/users/me/messages/${messageId}`,
						this.props.bearerToken,
						{
							method: 'DELETE'
						}
					);

					if (!response.ok) {
						const error = await response.text();
						return {
							content: [{
								type: "text",
								text: `**Error**\n\nGmail API error: ${response.status} ${response.statusText}\n\n**Details:**\n${error}`,
								isError: true
							}]
						};
					}

					return {
						content: [{
							type: "text",
							text: `**Email Deleted**\n\nEmail with ID "${messageId}" has been moved to trash.`
						}]
					};
				} catch (error) {
					console.error('deleteEmail error:', error);
					return {
						content: [{
							type: "text",
							text: `**Error**\n\nError deleting email: ${error}`,
							isError: true
						}]
					};
				}
			}
		);

		// Tool 9: List Labels
		this.server.tool(
			"listLabels",
			"Retrieves a list of all labels in the Gmail account.",
			ListLabelsSchema,
			async () => {
				try {
					const response = await makeGmailApiCall(
						`/users/me/labels`,
						this.props.bearerToken	
					);
					
					if (!response.ok) {
						const error = await response.text();
						return {
							content: [{
								type: "text",
								text: `**Error**\n\nGmail API error: ${response.status} ${response.statusText}\n\n**Details:**\n${error}`,
								isError: true
							}]
						};
					}

					const data = await response.json() as any;
					const labels = data.labels || [];

					const formattedLabels = labels.map((label: any) => ({
						id: label.id,
						name: label.name,
						type: label.type,
						messageListVisibility: label.messageListVisibility,
						labelListVisibility: label.labelListVisibility,
					}));

					return {
						content: [{
							type: "text",
							text: `**Gmail Labels**\n\nFound ${formattedLabels.length} labels:\n\n\`\`\`json\n${JSON.stringify(formattedLabels, null, 2)}\n\`\`\``
						}]
					};
				} catch (error) {
					console.error('listLabels error:', error);
					return {
						content: [{
							type: "text",
							text: `**Error**\n\nError listing labels: ${error}`,
							isError: true
						}]
					};
				}
			}
		);

		// Tool 10: List Threads
		this.server.tool(
			"listThreads",
			"List conversation threads matching an optional Gmail query.",
			ListThreadsSchema,
			async ({ maxResults = 10, query = "", pageToken }) => {
				try {
					const clampedMaxResults = Math.min(Math.max(1, maxResults), 100);
					const params = new URLSearchParams({ maxResults: String(clampedMaxResults) });
					if (query) params.set("q", query);
					if (pageToken) params.set("pageToken", pageToken);
					params.set("fields", "threads(id),nextPageToken,resultSizeEstimate");
					const res = await makeGmailApiCall(`/users/me/threads?${params.toString()}`, this.props.bearerToken);
					if (!res.ok) {
						return { content: [{ type: "text", text: `Error listing threads: ${res.status} ${res.statusText}\n${await res.text()}`, isError: true }] };
					}
					const data = await res.json() as any;
					return { content: [{ type: "text", text: `Threads${data.nextPageToken ? `\n\nnextPageToken: ${data.nextPageToken}` : ""}\n\n\`\`\`json\n${JSON.stringify(data.threads || [], null, 2)}\n\`\`\`` }] };
				} catch (e) {
					return { content: [{ type: "text", text: `Error: ${e}`, isError: true }] };
				}
			}
		);

		// Tool 11: Get Thread
		this.server.tool(
			"getThread",
			"Get a conversation thread with messages and headers.",
			GetThreadSchema,
			async ({ threadId, format = "metadata", metadataHeaders = ["Subject","From","To","Cc","Bcc","Date","Message-Id"] }) => {
				try {
					const params = new URLSearchParams({ format });
					if (format === "metadata") for (const h of metadataHeaders) params.append("metadataHeaders", h);
					const res = await makeGmailApiCall(`/users/me/threads/${threadId}?${params.toString()}`, this.props.bearerToken);
					if (!res.ok) {
						return { content: [{ type: "text", text: `Error getting thread: ${res.status} ${res.statusText}\n${await res.text()}`, isError: true }] };
					}
					const thread = await res.json() as any;
					return { content: [{ type: "text", text: `Thread\n\n\`\`\`json\n${JSON.stringify(thread, null, 2)}\n\`\`\`` }] };
				} catch (e) {
					return { content: [{ type: "text", text: `Error: ${e}`, isError: true }] };
				}
			}
		);

		// Tool 12: Get Attachment
		this.server.tool(
			"getAttachment",
			"Retrieve a message attachment and optionally decode a text preview.",
			GetAttachmentSchema,
			async ({ messageId, attachmentId, decode = false, previewMaxChars = 20000 }) => {
				try {
					const res = await makeGmailApiCall(`/users/me/messages/${messageId}/attachments/${attachmentId}`, this.props.bearerToken);
					if (!res.ok) {
						return { content: [{ type: "text", text: `Error getting attachment: ${res.status} ${res.statusText}\n${await res.text()}`, isError: true }] };
					}
					const data = await res.json() as any; // { data: base64url, size }
					let preview: string | undefined;
					if (decode && data.data) {
						let normalized = String(data.data).replace(/-/g, '+').replace(/_/g, '/');
						while (normalized.length % 4) normalized += '=';
						try {
							const bytes = Uint8Array.from(atob(normalized), c => c.charCodeAt(0));
							preview = new TextDecoder().decode(bytes).slice(0, previewMaxChars);
						} catch {}
					}
					return { content: [{ type: "text", text: `Attachment\n\n\`\`\`json\n${JSON.stringify({ size: data.size, hasData: Boolean(data.data), preview }, null, 2)}\n\`\`\`` }] };
				} catch (e) {
					return { content: [{ type: "text", text: `Error: ${e}`, isError: true }] };
				}
			}
		);

		// Tool 13: Create Label
		this.server.tool(
			"createLabel",
			"Create a new Gmail label.",
			CreateLabelSchema,
			async ({ name, labelListVisibility, messageListVisibility }) => {
				try {
					const res = await makeGmailApiCall(`/users/me/labels`, this.props.bearerToken, { method: 'POST', body: JSON.stringify({ name, labelListVisibility, messageListVisibility }) });
					if (!res.ok) return { content: [{ type: 'text', text: `Error creating label: ${res.status} ${res.statusText}\n${await res.text()}`, isError: true }] };
					return { content: [{ type: 'text', text: `Label created\n\n\`\`\`json\n${JSON.stringify(await res.json(), null, 2)}\n\`\`\`` }] };
				} catch (e) { return { content: [{ type: 'text', text: String(e), isError: true }] }; }
			}
		);

		// Tool 14: Update Label
		this.server.tool(
			"updateLabel",
			"Update an existing Gmail label's properties.",
			UpdateLabelSchema,
			async ({ labelId, name, labelListVisibility, messageListVisibility }) => {
				try {
					const res = await makeGmailApiCall(`/users/me/labels/${labelId}`, this.props.bearerToken, { method: 'PATCH', body: JSON.stringify({ name, labelListVisibility, messageListVisibility }) });
					if (!res.ok) return { content: [{ type: 'text', text: `Error updating label: ${res.status} ${res.statusText}\n${await res.text()}`, isError: true }] };
					return { content: [{ type: 'text', text: `Label updated\n\n\`\`\`json\n${JSON.stringify(await res.json(), null, 2)}\n\`\`\`` }] };
				} catch (e) { return { content: [{ type: 'text', text: String(e), isError: true }] }; }
			}
		);

		// Tool 15: Delete Label
		this.server.tool(
			"deleteLabel",
			"Delete a Gmail label.",
			DeleteLabelSchema,
			async ({ labelId }) => {
				try {
					const res = await makeGmailApiCall(`/users/me/labels/${labelId}`, this.props.bearerToken, { method: 'DELETE' });
					if (!res.ok) return { content: [{ type: 'text', text: `Error deleting label: ${res.status} ${res.statusText}\n${await res.text()}`, isError: true }] };
					return { content: [{ type: 'text', text: `Label deleted: ${labelId}` }] };
				} catch (e) { return { content: [{ type: 'text', text: String(e), isError: true }] }; }
			}
		);

		// Tool 16: Create Draft
		this.server.tool(
			"createDraft",
			"Create a draft email.",
			CreateDraftSchema,
			async ({ to, cc, bcc, subject, body, isHtml = false }) => {
				try {
					const headers: string[] = [`To: ${to}`, `Subject: ${subject}`, 'MIME-Version: 1.0'];
					if (cc) headers.push(`Cc: ${cc}`);
					if (bcc) headers.push(`Bcc: ${bcc}`);
					headers.push(isHtml ? 'Content-Type: text/html; charset="UTF-8"' : 'Content-Type: text/plain; charset="UTF-8"');
					const raw = btoa([...headers, '', body].join('\r\n')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
					const res = await makeGmailApiCall(`/users/me/drafts`, this.props.bearerToken, { method: 'POST', body: JSON.stringify({ message: { raw } }) });
					if (!res.ok) return { content: [{ type: 'text', text: `Error creating draft: ${res.status} ${res.statusText}\n${await res.text()}`, isError: true }] };
					return { content: [{ type: 'text', text: `Draft created\n\n\`\`\`json\n${JSON.stringify(await res.json(), null, 2)}\n\`\`\`` }] };
				} catch (e) { return { content: [{ type: 'text', text: String(e), isError: true }] }; }
			}
		);

		// Tool 17: Send Draft
		this.server.tool(
			"sendDraft",
			"Send a draft email by ID.",
			SendDraftSchema,
			async ({ draftId }) => {
				try {
					const res = await makeGmailApiCall(`/users/me/drafts/send`, this.props.bearerToken, { method: 'POST', body: JSON.stringify({ id: draftId }) });
					if (!res.ok) return { content: [{ type: 'text', text: `Error sending draft: ${res.status} ${res.statusText}\n${await res.text()}`, isError: true }] };
					return { content: [{ type: 'text', text: `Draft sent\n\n\`\`\`json\n${JSON.stringify(await res.json(), null, 2)}\n\`\`\`` }] };
				} catch (e) { return { content: [{ type: 'text', text: String(e), isError: true }] }; }
			}
		);

		// Tool 18: Reply to Email
		this.server.tool(
			"replyEmail",
			"Reply to a specific message in a thread.",
			ReplyEmailSchema,
			async ({ messageId, body, isHtml = false }) => {
				try {
					// Fetch message to get headers for threading
					const msgRes = await makeGmailApiCall(`/users/me/messages/${messageId}?format=metadata&metadataHeaders=Message-Id&metadataHeaders=Subject`, this.props.bearerToken);
					if (!msgRes.ok) return { content: [{ type: 'text', text: `Error fetching message: ${msgRes.status} ${msgRes.statusText}\n${await msgRes.text()}`, isError: true }] };
					const msg = await msgRes.json() as any;
					const headers = msg.payload?.headers || [];
					const getHeader = (n: string) => headers.find((h: any) => h.name?.toLowerCase() === n.toLowerCase())?.value || '';
					const messageIdHeader = getHeader('Message-Id');
					const subject = getHeader('Subject');
					const lines = [
						`Subject: Re: ${subject}`,
						`In-Reply-To: ${messageIdHeader}`,
						`References: ${messageIdHeader}`,
						'MIME-Version: 1.0',
						isHtml ? 'Content-Type: text/html; charset="UTF-8"' : 'Content-Type: text/plain; charset="UTF-8"',
						'',
						body,
					];
					const raw = btoa(lines.join('\r\n')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
					const sendRes = await makeGmailApiCall(`/users/me/messages/send`, this.props.bearerToken, { method: 'POST', body: JSON.stringify({ raw, threadId: msg.threadId }) });
					if (!sendRes.ok) return { content: [{ type: 'text', text: `Error sending reply: ${sendRes.status} ${sendRes.statusText}\n${await sendRes.text()}`, isError: true }] };
					return { content: [{ type: 'text', text: `Reply sent\n\n\`\`\`json\n${JSON.stringify(await sendRes.json(), null, 2)}\n\`\`\`` }] };
				} catch (e) { return { content: [{ type: 'text', text: String(e), isError: true }] }; }
			}
		);

		// Batch tools
		// Tool 19: batchDelete (trash or permanent)
		this.server.tool(
			"batchDelete",
			"Batch delete messages (move to trash). For permanent delete, use 'permanent' flag per message with separate tool.",
			BatchIdsSchema,
			async ({ messageIds }) => {
				try {
					const res = await makeGmailApiCall(`/users/me/messages/batchDelete`, this.props.bearerToken, { method: 'POST', body: JSON.stringify({ ids: messageIds }) });
					if (!res.ok) return { content: [{ type: 'text', text: `Error batch deleting: ${res.status} ${res.statusText}\n${await res.text()}`, isError: true }] };
					return { content: [{ type: 'text', text: `Batch delete requested for ${messageIds.length} messages.` }] };
				} catch (e) { return { content: [{ type: 'text', text: String(e), isError: true }] }; }
			}
		);

		// Tool 20: batchModify (add/remove labels)
		this.server.tool(
			"batchModify",
			"Batch add/remove labels for messages.",
			{
				messageIds: z.array(z.string().min(1)).min(1),
				addLabelIds: z.array(z.string()).optional(),
				removeLabelIds: z.array(z.string()).optional(),
			},
			async ({ messageIds, addLabelIds, removeLabelIds }) => {
				try {
					const res = await makeGmailApiCall(`/users/me/messages/batchModify`, this.props.bearerToken, { method: 'POST', body: JSON.stringify({ ids: messageIds, addLabelIds, removeLabelIds }) });
					if (!res.ok) return { content: [{ type: 'text', text: `Error batch modifying: ${res.status} ${res.statusText}\n${await res.text()}`, isError: true }] };
					return { content: [{ type: 'text', text: `Batch modify requested for ${messageIds.length} messages.` }] };
				} catch (e) { return { content: [{ type: 'text', text: String(e), isError: true }] }; }
			}
		);

		// Tool 21: batchMoveToLabel convenience
		this.server.tool(
			"batchMoveToLabel",
			"Batch move messages to a label, optionally removing INBOX.",
			BatchMoveToLabelSchema,
			async ({ messageIds, targetLabelId, removeFromInbox = true }) => {
				try {
					const res = await makeGmailApiCall(`/users/me/messages/batchModify`, this.props.bearerToken, { method: 'POST', body: JSON.stringify({ ids: messageIds, addLabelIds: [targetLabelId], removeLabelIds: removeFromInbox ? ["INBOX"] : undefined }) });
					if (!res.ok) return { content: [{ type: 'text', text: `Error batch moving: ${res.status} ${res.statusText}\n${await res.text()}`, isError: true }] };
					return { content: [{ type: 'text', text: `Batch move requested for ${messageIds.length} messages to ${targetLabelId}.` }] };
				} catch (e) { return { content: [{ type: 'text', text: String(e), isError: true }] }; }
			}
		);
		// Removed getToken tool per request
	}
}

// Render a basic homepage placeholder to make sure the app is up
app.get("/", async (c) => {
	const content = await homeContent(c.req.raw);
	return c.html(layout(content, "MCP Remote Auth Demo - Home"));
});

app.mount("/", (req, env, ctx) => {
	// This could technically be pulled out into a middleware function, but is left here for clarity
	const authHeader = req.headers.get("authorization");
	if (!authHeader) {
		return new Response("Unauthorized", { status: 401 });
	}

	ctx.props = {
		bearerToken: authHeader,
		// could also add arbitrary headers/parameters here to pass into the MCP client
	};

	return MyMCP.mount("/mcp").fetch(req, env, ctx);
});

export default app;
