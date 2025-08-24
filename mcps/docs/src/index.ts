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
		name: "Google Docs MCP Server",
		version: "1.0.0",
	});

	async init() {
		// Helper function to make Google Docs API calls
		async function makeDocsApiCall(
			endpoint: string, 
			bearerToken: string,
			options: RequestInit = {}
		): Promise<Response> {
			const url = `https://docs.googleapis.com/v1${endpoint}`;
			
			return fetch(url, {
				...options,
				headers: {
					'Authorization': `${bearerToken}`,
					'Content-Type': 'application/json',
					...options.headers,
				},
			});
		}

		// Helper function to make Google Drive API calls (for document listing/creation)
		async function makeDriveApiCall(
			endpoint: string, 
			bearerToken: string,
			options: RequestInit = {}
		): Promise<Response> {
			const url = `https://www.googleapis.com/drive/v3${endpoint}`;
			
			return fetch(url, {
				...options,
				headers: {
					'Authorization': `${bearerToken}`,
					'Content-Type': 'application/json',
					...options.headers,
				},
			});
		}

		// Google Docs tool schemas
		const ListDocumentsSchema = {
			maxResults: z
				.number()
				.optional()
				.default(10)
				.describe("Maximum number of documents to retrieve (default: 10, max: 100)"),
			query: z
				.string()
				.optional()
				.describe("Advanced Drive query to filter documents (ANDed with other filters)"),
			nameContains: z
				.string()
				.optional()
				.describe("Filter by document title containing this text, case-insensitive"),
		};

		const GetDocumentSchema = {
			documentId: z
				.string()
				.min(1, "Document ID cannot be empty")
				.describe("Google Docs document ID to retrieve")
		};

		const CreateDocumentSchema = {
			title: z
				.string()
				.min(1, "Document title cannot be empty")
				.describe("Title for the new document")
		};

		const UpdateDocumentSchema = {
			documentId: z
				.string()
				.min(1, "Document ID cannot be empty")
				.describe("Document ID to update"),
			requests: z
				.array(z.object({}).passthrough())
				.describe("Array of batch update requests to apply to the document")
		};

		const InsertTextSchema = {
			documentId: z
				.string()
				.min(1, "Document ID cannot be empty")
				.describe("Document ID to insert text into"),
			text: z
				.string()
				.min(1, "Text cannot be empty")
				.describe("Text to insert"),
			index: z
				.number()
				.optional()
				.default(1)
				.describe("Index position to insert text (default: 1, which is after the title)")
		};

		const DeleteDocumentSchema = {
			documentId: z
				.string()
				.min(1, "Document ID cannot be empty")
				.describe("Document ID to delete")
		};

		// Additional schemas
		const FindReplaceSchema = {
			documentId: z.string().min(1),
			findText: z.string().min(1).describe("Text to find"),
			replaceText: z.string().default("").describe("Replacement text (default empty)"),
			matchCase: z.boolean().optional().default(false),
		};

		const InsertHeadingSchema = {
			documentId: z.string().min(1),
			text: z.string().min(1),
			level: z.enum([
				"HEADING_1",
				"HEADING_2",
				"HEADING_3",
				"HEADING_4",
				"HEADING_5",
				"HEADING_6",
			]).default("HEADING_2"),
			index: z.number().optional().default(1),
		};

		const InsertInlineImageSchema = {
			documentId: z.string().min(1),
			uri: z.string().min(1).describe("Publicly accessible image URL"),
			index: z.number().optional().default(1),
			altText: z.string().optional(),
		};

		const ListCommentsSchema = {
			documentId: z.string().min(1),
			pageSize: z.number().optional().default(20),
		};

		const CreateCommentSchema = {
			documentId: z.string().min(1),
			content: z.string().min(1),
			anchor: z.string().optional(),
		};

		const ListRevisionsSchema = {
			documentId: z.string().min(1),
		};

		const ExportDocumentSchema = {
			documentId: z.string().min(1),
			mimeType: z.enum([
				"application/pdf",
				"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
				"text/plain",
				"text/html",
			]).default("application/pdf"),
			preview: z.boolean().optional().default(true).describe("Include base64 preview (truncated)"),
			maxPreviewBytes: z.number().optional().default(200000),
		};

		const CopyDocumentSchema = {
			documentId: z.string().min(1),
			name: z.string().min(1),
			folderId: z.string().optional(),
		};

		const BatchFindReplaceSchema = {
			documentId: z.string().min(1),
			replacements: z.array(
				z.object({
					findText: z.string().min(1),
					replaceText: z.string().default("") ,
					matchCase: z.boolean().optional().default(false),
				})
			).min(1),
		};

		const InsertTableSchema = {
			documentId: z.string().min(1),
			rows: z.number().min(1).max(100),
			columns: z.number().min(1).max(20),
			index: z.number().optional().default(1),
		};

		const ListPermissionsSchema = {
			documentId: z.string().min(1),
		};

		const AddPermissionSchema = {
			documentId: z.string().min(1),
			type: z.enum(["user","group","domain","anyone"]),
			role: z.enum(["reader","commenter","writer"]),
			emailAddress: z.string().min(1).optional(),
			domain: z.string().optional(),
			allowFileDiscovery: z.boolean().optional(),
		};

		const RemovePermissionSchema = {
			documentId: z.string().min(1),
			permissionId: z.string().min(1),
		};

		// Tool 1: List Documents
		this.server.tool(
			"listDocuments",
			"Retrieve a list of Google Docs documents. Supports search queries to filter documents.",
			ListDocumentsSchema,
			async ({ maxResults = 10, query = "", nameContains }) => {
				try {
					const clampedMaxResults = Math.min(Math.max(1, maxResults), 100);
					// Build Drive 'q' with parts
					const qParts: string[] = ["mimeType='application/vnd.google-apps.document'"];
					if (nameContains && nameContains.trim()) {
						const escaped = nameContains.replace(/'/g, "\\'");
						qParts.push(`name contains '${escaped}'`);
					}
					if (query && query.trim()) {
						qParts.push(`(${query})`);
					}
					const q = encodeURIComponent(qParts.join(" and "));
					let endpoint = `/files?pageSize=${clampedMaxResults}&q=${q}`;
					endpoint += "&fields=files(id,name,createdTime,modifiedTime,owners,webViewLink)";
					
					const response = await makeDriveApiCall(endpoint, this.props.bearerToken);
					
					if (!response.ok) {
						const error = await response.text();
						return {
							content: [{
								type: "text",
								text: `**Error**\n\nGoogle Drive API error: ${response.status} ${response.statusText}\n\n**Details:**\n${error}`,
								isError: true
							}]
						};
					}
					
					const data = await response.json() as any;
					const documents = data.files || [];
					
					if (documents.length === 0) {
						return {
							content: [{
								type: "text",
								text: "**Google Docs Documents**\n\nNo documents found matching the query."
							}]
						};
					}
					
					const documentDetails = documents.map((doc: any) => ({
						id: doc.id,
						name: doc.name,
						createdTime: doc.createdTime,
						modifiedTime: doc.modifiedTime,
						owners: doc.owners?.map((owner: any) => owner.displayName || owner.emailAddress) || [],
						webViewLink: doc.webViewLink
					}));
					
					return {
						content: [{
							type: "text",
							text: `**Google Docs Documents**\n\nFound ${documentDetails.length} documents\n\n**Results:**\n\`\`\`json\n${JSON.stringify(documentDetails, null, 2)}\n\`\`\``
						}]
					};
					
				} catch (error) {
					console.error('listDocuments error:', error);
					return {
						content: [{
							type: "text",
							text: `**Error**\n\nError retrieving documents: ${error}`,
							isError: true
						}]
					};
				}
			}
		);
		
		// Tool 2: Get Document Content
		this.server.tool(
			"getDocument",
			"Retrieve the full content and structure of a specific Google Docs document.",
			GetDocumentSchema,
			async ({ documentId }) => {
				try {
					const response = await makeDocsApiCall(
						`/documents/${documentId}`, 
						this.props.bearerToken
					);
					
					if (!response.ok) {
						const error = await response.text();
						return {
							content: [{
								type: "text",
								text: `**Error**\n\nGoogle Docs API error: ${response.status} ${response.statusText}\n\n**Details:**\n${error}`,
								isError: true
							}]
						};
					}
					
					const document = await response.json() as any;
					
					// Extract text content from the document
					let textContent = "";
					function extractText(element: any): void {
						if (element.paragraph) {
							element.paragraph.elements?.forEach((elem: any) => {
								if (elem.textRun) {
									textContent += elem.textRun.content;
								}
							});
						} else if (element.table) {
							element.table.tableRows?.forEach((row: any) => {
								row.tableCells?.forEach((cell: any) => {
									cell.content?.forEach((cellElement: any) => {
										extractText(cellElement);
									});
								});
							});
						}
					}
					
					document.body?.content?.forEach((element: any) => {
						extractText(element);
					});
					
					const documentDetails = {
						documentId: document.documentId,
						title: document.title,
						revisionId: document.revisionId,
						textContent: textContent.trim(),
						structure: {
							body: document.body,
							headers: document.headers,
							footers: document.footers,
							footnotes: document.footnotes
						}
					};
					
					return {
						content: [{
							type: "text",
							text: `**Google Docs Document**\n\nDocument retrieved successfully\n\n**Details:**\n\`\`\`json\n${JSON.stringify(documentDetails, null, 2)}\n\`\`\``
						}]
					};
					
				} catch (error) {
					console.error('getDocument error:', error);
					return {
						content: [{
							type: "text",
							text: `**Error**\n\nError retrieving document: ${error}`,
							isError: true
						}]
					};
				}
			}
		);
		
		// Tool 3: Create Document
		this.server.tool(
			"createDocument",
			"Create a new Google Docs document with the specified title.",
			CreateDocumentSchema,
			async ({ title }) => {
				try {
					const documentData = {
						title: title
					};
					
					const response = await makeDocsApiCall(
						`/documents`,
						this.props.bearerToken,
						{
							method: 'POST',
							body: JSON.stringify(documentData)
						}
					);
					
					if (!response.ok) {
						const error = await response.text();
						return {
							content: [{
								type: "text",
								text: `**Error**\n\nGoogle Docs API error: ${response.status} ${response.statusText}\n\n**Details:**\n${error}`,
								isError: true
							}]
						};
					}
					
					const document = await response.json() as any;
					
					const result = {
						documentId: document.documentId,
						title: document.title,
						revisionId: document.revisionId,
						documentUrl: `https://docs.google.com/document/d/${document.documentId}/edit`
					};
					
					return {
						content: [{
							type: "text",
							text: `**Document Created Successfully**\n\nDocument "${title}" created\n\n**Details:**\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``
						}]
					};
					
				} catch (error) {
					console.error('createDocument error:', error);
					return {
						content: [{
							type: "text",
							text: `**Error**\n\nError creating document: ${error}`,
							isError: true
						}]
					};
				}
			}
		);
		
		// Tool 4: Insert Text
		this.server.tool(
			"insertText",
			"Insert text into a Google Docs document at the specified position.",
			InsertTextSchema,
			async ({ documentId, text, index = 1 }) => {
				try {
					const requests = [
						{
							insertText: {
								location: {
									index: index
								},
								text: text
							}
						}
					];
					
					const response = await makeDocsApiCall(
						`/documents/${documentId}:batchUpdate`,
						this.props.bearerToken,
						{
							method: 'POST',
							body: JSON.stringify({ requests })
						}
					);
					
					if (!response.ok) {
						const error = await response.text();
						return {
							content: [{
								type: "text",
								text: `**Error**\n\nGoogle Docs API error: ${response.status} ${response.statusText}\n\n**Details:**\n${error}`,
								isError: true
							}]
						};
					}
					
					const result = await response.json() as any;
					
					return {
						content: [{
							type: "text",
							text: `**Text Inserted Successfully**\n\nText inserted into document at index ${index}\n\n**Details:**\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``
						}]
					};
					
				} catch (error) {
					console.error('insertText error:', error);
					return {
						content: [{
							type: "text",
							text: `**Error**\n\nError inserting text: ${error}`,
							isError: true
						}]
					};
				}
			}
		);
		
		// Tool 5: Update Document
		this.server.tool(
			"updateDocument",
			"Apply batch updates to a Google Docs document using the Google Docs API request format.",
			UpdateDocumentSchema,
			async ({ documentId, requests }) => {
				try {
					const response = await makeDocsApiCall(
						`/documents/${documentId}:batchUpdate`,
						this.props.bearerToken,
						{
							method: 'POST',
							body: JSON.stringify({ requests })
						}
					);
					
					if (!response.ok) {
						const error = await response.text();
						return {
							content: [{
								type: "text",
								text: `**Error**\n\nGoogle Docs API error: ${response.status} ${response.statusText}\n\n**Details:**\n${error}`,
								isError: true
							}]
						};
					}
					
					const result = await response.json() as any;
					
					return {
						content: [{
							type: "text",
							text: `**Document Updated Successfully**\n\nBatch update applied to document\n\n**Details:**\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``
						}]
					};
					
				} catch (error) {
					console.error('updateDocument error:', error);
					return {
						content: [{
							type: "text",
							text: `**Error**\n\nError updating document: ${error}`,
							isError: true
						}]
					};
				}
			}
		);

		// Tool 6: Delete Document
		this.server.tool(
			"deleteDocument",
			"Delete a Google Docs document by moving it to trash.",
			DeleteDocumentSchema,
			async ({ documentId }) => {
				try {
					const response = await makeDriveApiCall(
						`/files/${documentId}`,
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
								text: `**Error**\n\nGoogle Drive API error: ${response.status} ${response.statusText}\n\n**Details:**\n${error}`,
								isError: true
							}]
						};
					}

					return {
						content: [{
							type: "text",
							text: `**Document Deleted**\n\nDocument with ID "${documentId}" has been moved to trash.`
						}]
					};
				} catch (error) {
					console.error('deleteDocument error:', error);
					return {
						content: [{
							type: "text",
							text: `**Error**\n\nError deleting document: ${error}`,
							isError: true
						}]
					};
				}
			}
		);

		// Tool 7: Find and Replace
		this.server.tool(
			"findReplace",
			"Find and replace text across an entire document.",
			FindReplaceSchema,
			async ({ documentId, findText, replaceText = "", matchCase = false }) => {
				try {
					const requests = [
						{
							replaceAllText: {
								containsText: { text: findText, matchCase },
								replaceText,
							},
						},
					];
					const res = await makeDocsApiCall(`/documents/${documentId}:batchUpdate`, this.props.bearerToken, { method: 'POST', body: JSON.stringify({ requests }) });
					if (!res.ok) return { content: [{ type: 'text', text: `Error: ${res.status} ${res.statusText}\n${await res.text()}`, isError: true }] };
					return { content: [{ type: 'text', text: `Find/replace applied\n\n\`\`\`json\n${JSON.stringify(await res.json(), null, 2)}\n\`\`\`` }] };
				} catch (e) { return { content: [{ type: 'text', text: String(e), isError: true }] }; }
			}
		);

		// Tool 8: Insert Heading
		this.server.tool(
			"insertHeading",
			"Insert a heading at a specified index.",
			InsertHeadingSchema,
			async ({ documentId, text, level = "HEADING_2", index = 1 }) => {
				try {
					const requests = [
						{ insertText: { location: { index }, text } },
						{ updateParagraphStyle: { range: { startIndex: index, endIndex: index + text.length + 1 }, paragraphStyle: { namedStyleType: level }, fields: 'namedStyleType' } },
					];
					const res = await makeDocsApiCall(`/documents/${documentId}:batchUpdate`, this.props.bearerToken, { method: 'POST', body: JSON.stringify({ requests }) });
					if (!res.ok) return { content: [{ type: 'text', text: `Error: ${res.status} ${res.statusText}\n${await res.text()}`, isError: true }] };
					return { content: [{ type: 'text', text: `Heading inserted` }] };
				} catch (e) { return { content: [{ type: 'text', text: String(e), isError: true }] }; }
			}
		);

		// Tool 9: Insert Inline Image
		this.server.tool(
			"insertInlineImage",
			"Insert an inline image at a specified index.",
			InsertInlineImageSchema,
			async ({ documentId, uri, index = 1, altText }) => {
				try {
					const requests: any[] = [ { insertInlineImage: { location: { index }, uri } } ];
					if (altText) requests.push({ updateTextStyle: { range: { startIndex: index, endIndex: index + 1 }, textStyle: { link: { url: uri } }, fields: 'link' } });
					const res = await makeDocsApiCall(`/documents/${documentId}:batchUpdate`, this.props.bearerToken, { method: 'POST', body: JSON.stringify({ requests }) });
					if (!res.ok) return { content: [{ type: 'text', text: `Error: ${res.status} ${res.statusText}\n${await res.text()}`, isError: true }] };
					return { content: [{ type: 'text', text: `Image inserted` }] };
				} catch (e) { return { content: [{ type: 'text', text: String(e), isError: true }] }; }
			}
		);

		// Tool 10: List Comments
		this.server.tool(
			"listComments",
			"List Drive comments for a document.",
			ListCommentsSchema,
			async ({ documentId, pageSize = 20 }) => {
				try {
					const params = new URLSearchParams({ pageSize: String(pageSize), fields: 'comments(author,content,createdTime,htmlContent,quotedFileContent,anchor)' });
					const res = await makeDriveApiCall(`/files/${documentId}/comments?${params.toString()}`, this.props.bearerToken);
					if (!res.ok) return { content: [{ type: 'text', text: `Error listing comments: ${res.status} ${res.statusText}\n${await res.text()}`, isError: true }] };
					const data = await res.json() as any;
					return { content: [{ type: 'text', text: `Comments\n\n\`\`\`json\n${JSON.stringify((data as any).comments || [], null, 2)}\n\`\`\`` }] };
				} catch (e) { return { content: [{ type: 'text', text: String(e), isError: true }] }; }
			}
		);

		// Tool 11: Create Comment
		this.server.tool(
			"createComment",
			"Create a Drive comment on a document.",
			CreateCommentSchema,
			async ({ documentId, content, anchor }) => {
				try {
					const body: any = { content };
					if (anchor) body.anchor = anchor;
					const res = await makeDriveApiCall(`/files/${documentId}/comments`, this.props.bearerToken, { method: 'POST', body: JSON.stringify(body) });
					if (!res.ok) return { content: [{ type: 'text', text: `Error creating comment: ${res.status} ${res.statusText}\n${await res.text()}`, isError: true }] };
					return { content: [{ type: 'text', text: `Comment created\n\n\`\`\`json\n${JSON.stringify(await res.json(), null, 2)}\n\`\`\`` }] };
				} catch (e) { return { content: [{ type: 'text', text: String(e), isError: true }] }; }
			}
		);

		// Tool 12: List Revisions
		this.server.tool(
			"listRevisions",
			"List revisions for a document (Drive).",
			ListRevisionsSchema,
			async ({ documentId }) => {
				try {
					const params = new URLSearchParams({ fields: 'revisions(id,modifiedTime,keepForever,lastModifyingUser,exportLinks)' });
					const res = await makeDriveApiCall(`/files/${documentId}/revisions?${params.toString()}`, this.props.bearerToken);
					if (!res.ok) return { content: [{ type: 'text', text: `Error listing revisions: ${res.status} ${res.statusText}\n${await res.text()}`, isError: true }] };
					const data = await res.json() as any;
					return { content: [{ type: 'text', text: `Revisions\n\n\`\`\`json\n${JSON.stringify((data as any).revisions || [], null, 2)}\n\`\`\`` }] };
				} catch (e) { return { content: [{ type: 'text', text: String(e), isError: true }] }; }
			}
		);

		// Tool 13: Export Document
		this.server.tool(
			"exportDocument",
			"Export a document to a given mime type (returns base64 preview).",
			ExportDocumentSchema,
			async ({ documentId, mimeType = 'application/pdf', preview = true, maxPreviewBytes = 200000 }) => {
				try {
					const res = await makeDriveApiCall(`/files/${documentId}/export?mimeType=${encodeURIComponent(mimeType)}`, this.props.bearerToken, { method: 'GET' });
					if (!res.ok) return { content: [{ type: 'text', text: `Error exporting: ${res.status} ${res.statusText}` , isError: true }] };
					if (!preview) return { content: [{ type: 'text', text: `Export successful (binary content omitted)` }] };
					const buf = await res.arrayBuffer();
					const bytes = new Uint8Array(buf);
					let binary = '';
					for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
					const b64 = btoa(binary);
					const truncated = b64.slice(0, maxPreviewBytes);
					return { content: [{ type: 'text', text: `Export preview (base64, truncated)\n\nlength: ${b64.length}\n\n\`\`\`\n${truncated}\n\`\`\`` }] };
				} catch (e) { return { content: [{ type: 'text', text: String(e), isError: true }] }; }
			}
		);

		// Tool 14: Copy Document
		this.server.tool(
			"copyDocument",
			"Copy a document (Drive).",
			CopyDocumentSchema,
			async ({ documentId, name, folderId }) => {
				try {
					const body: any = { name };
					if (folderId) body.parents = [folderId];
					const res = await makeDriveApiCall(`/files/${documentId}/copy`, this.props.bearerToken, { method: 'POST', body: JSON.stringify(body) });
					if (!res.ok) return { content: [{ type: 'text', text: `Error copying: ${res.status} ${res.statusText}\n${await res.text()}`, isError: true }] };
					const data = await res.json() as any;
					return { content: [{ type: 'text', text: `Document copied\n\n\`\`\`json\n${JSON.stringify({ id: (data as any).id, name: (data as any).name, webViewLink: (data as any).webViewLink }, null, 2)}\n\`\`\`` }] };
				} catch (e) { return { content: [{ type: 'text', text: String(e), isError: true }] }; }
			}
		);

		// Tool 15: Batch Find/Replace
		this.server.tool(
			"batchFindReplace",
			"Apply multiple find/replace operations in a single batch.",
			BatchFindReplaceSchema,
			async ({ documentId, replacements }) => {
				try {
					const requests = replacements.map(r => ({ replaceAllText: { containsText: { text: r.findText, matchCase: r.matchCase ?? false }, replaceText: r.replaceText ?? '' } }));
					const res = await makeDocsApiCall(`/documents/${documentId}:batchUpdate`, this.props.bearerToken, { method: 'POST', body: JSON.stringify({ requests }) });
					if (!res.ok) return { content: [{ type: 'text', text: `Error: ${res.status} ${res.statusText}\n${await res.text()}`, isError: true }] };
					return { content: [{ type: 'text', text: `Batch find/replace applied` }] };
				} catch (e) { return { content: [{ type: 'text', text: String(e), isError: true }] }; }
			}
		);

		// Tool 16: Insert Table
		this.server.tool(
			"insertTable",
			"Insert a table with specified rows and columns at index.",
			InsertTableSchema,
			async ({ documentId, rows, columns, index = 1 }) => {
				try {
					const requests = [ { insertTable: { rows, columns, location: { index } } } ];
					const res = await makeDocsApiCall(`/documents/${documentId}:batchUpdate`, this.props.bearerToken, { method: 'POST', body: JSON.stringify({ requests }) });
					if (!res.ok) return { content: [{ type: 'text', text: `Error inserting table: ${res.status} ${res.statusText}\n${await res.text()}`, isError: true }] };
					return { content: [{ type: 'text', text: `Table inserted (${rows}x${columns}) at index ${index}.` }] };
				} catch (e) { return { content: [{ type: 'text', text: String(e), isError: true }] }; }
			}
		);

		// Tool 17: List Permissions
		this.server.tool(
			"listPermissions",
			"List sharing permissions for a document (Drive).",
			ListPermissionsSchema,
			async ({ documentId }) => {
				try {
					const params = new URLSearchParams({ fields: 'permissions(id,type,role,emailAddress,domain,allowFileDiscovery)' });
					const res = await makeDriveApiCall(`/files/${documentId}/permissions?${params.toString()}`, this.props.bearerToken);
					if (!res.ok) return { content: [{ type: 'text', text: `Error listing permissions: ${res.status} ${res.statusText}\n${await res.text()}`, isError: true }] };
					const data = await res.json() as any;
					return { content: [{ type: 'text', text: `Permissions\n\n\`\`\`json\n${JSON.stringify((data as any).permissions || [], null, 2)}\n\`\`\`` }] };
				} catch (e) { return { content: [{ type: 'text', text: String(e), isError: true }] }; }
			}
		);

		// Tool 18: Add Permission
		this.server.tool(
			"addPermission",
			"Add a sharing permission to a document (Drive).",
			AddPermissionSchema,
			async ({ documentId, type, role, emailAddress, domain, allowFileDiscovery }) => {
				try {
					const body: any = { type, role };
					if (emailAddress) body.emailAddress = emailAddress;
					if (domain) body.domain = domain;
					if (allowFileDiscovery !== undefined) body.allowFileDiscovery = allowFileDiscovery;
					const res = await makeDriveApiCall(`/files/${documentId}/permissions?sendNotificationEmail=false`, this.props.bearerToken, { method: 'POST', body: JSON.stringify(body) });
					if (!res.ok) return { content: [{ type: 'text', text: `Error adding permission: ${res.status} ${res.statusText}\n${await res.text()}`, isError: true }] };
					return { content: [{ type: 'text', text: `Permission added\n\n\`\`\`json\n${JSON.stringify(await res.json(), null, 2)}\n\`\`\`` }] };
				} catch (e) { return { content: [{ type: 'text', text: String(e), isError: true }] }; }
			}
		);

		// Tool 19: Remove Permission
		this.server.tool(
			"removePermission",
			"Remove a sharing permission from a document (Drive).",
			RemovePermissionSchema,
			async ({ documentId, permissionId }) => {
				try {
					const res = await makeDriveApiCall(`/files/${documentId}/permissions/${permissionId}`, this.props.bearerToken, { method: 'DELETE' });
					if (!res.ok) return { content: [{ type: 'text', text: `Error removing permission: ${res.status} ${res.statusText}\n${await res.text()}`, isError: true }] };
					return { content: [{ type: 'text', text: `Permission removed: ${permissionId}` }] };
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
