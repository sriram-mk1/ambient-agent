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
    name: "Google Sheets MCP Server",
    version: "1.0.0",
  });

  async init() {
    // Helper function to make Google Sheets API calls
    async function makeSheetsApiCall(
      endpoint: string,
      bearerToken: string,
      options: RequestInit = {},
    ): Promise<Response> {
      const url = `https://sheets.googleapis.com/v4${endpoint}`;

      return fetch(url, {
        ...options,
        headers: {
          Authorization: `${bearerToken}`,
          "Content-Type": "application/json",
          ...options.headers,
        },
      });
    }

    // Helper function to make Google Drive API calls (for spreadsheet listing/creation)
    async function makeDriveApiCall(
      endpoint: string,
      bearerToken: string,
      options: RequestInit = {},
    ): Promise<Response> {
      const url = `https://www.googleapis.com/drive/v3${endpoint}`;

      return fetch(url, {
        ...options,
        headers: {
          Authorization: `${bearerToken}`,
          "Content-Type": "application/json",
          ...options.headers,
        },
      });
    }

    // Google Sheets tool schemas
    const ListSpreadsheetsSchema = {
      maxResults: z
        .number()
        .optional()
        .default(10)
        .describe(
          "Maximum number of spreadsheets to retrieve (default: 10, max: 100)",
        ),
      query: z
        .string()
        .optional()
        .describe(
          "Advanced Drive query to filter spreadsheets (ANDed with filters)",
        ),
      nameContains: z
        .string()
        .optional()
        .describe("Filter by spreadsheet title containing this text"),
    };

    const GetSpreadsheetSchema = {
      spreadsheetId: z
        .string()
        .min(1, "Spreadsheet ID cannot be empty")
        .describe("Google Sheets spreadsheet ID to retrieve"),
    };

    const CreateSpreadsheetSchema = {
      title: z
        .string()
        .min(1, "Spreadsheet title cannot be empty")
        .describe("Title for the new spreadsheet"),
      sheetTitles: z
        .array(z.string())
        .optional()
        .describe("Array of sheet titles to create (default: ['Sheet1'])"),
    };

    const GetValuesSchema = {
      spreadsheetId: z
        .string()
        .min(1, "Spreadsheet ID cannot be empty")
        .describe("Spreadsheet ID to read from"),
      range: z
        .string()
        .min(1, "Range cannot be empty")
        .describe("A1 notation range (e.g., 'Sheet1!A1:D10', 'Sheet1!A:A')"),
    };

    const BatchGetValuesSchema = {
      spreadsheetId: z.string().min(1),
      ranges: z.array(z.string().min(1)).min(1).describe("Array of A1 ranges"),
    };

    const UpdateValuesSchema = {
      spreadsheetId: z
        .string()
        .min(1, "Spreadsheet ID cannot be empty")
        .describe("Spreadsheet ID to update"),
      range: z
        .string()
        .min(1, "Range cannot be empty")
        .describe("A1 notation range (e.g., 'Sheet1!A1:D10')"),
      values: z
        .array(
          z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])),
        )
        .describe("2D array of values to update"),
    };

    const BatchUpdateValuesSchema = {
      spreadsheetId: z.string().min(1),
      data: z
        .array(
          z.object({
            range: z.string().min(1),
            values: z.array(
              z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])),
            ),
          }),
        )
        .min(1),
      valueInputOption: z
        .enum(["RAW", "USER_ENTERED"])
        .optional()
        .default("USER_ENTERED"),
    };

    const AppendValuesSchema = {
      spreadsheetId: z
        .string()
        .min(1, "Spreadsheet ID cannot be empty")
        .describe("Spreadsheet ID to append to"),
      range: z
        .string()
        .min(1, "Range cannot be empty")
        .describe(
          "A1 notation range indicating where to start appending (e.g., 'Sheet1!A1')",
        ),
      values: z
        .array(
          z.array(z.union([z.string(), z.number(), z.boolean(), z.null()])),
        )
        .describe("2D array of values to append"),
    };

    const ClearRangeSchema = {
      spreadsheetId: z.string().min(1),
      range: z.string().min(1),
    };

    const DeleteSpreadsheetSchema = {
      spreadsheetId: z
        .string()
        .min(1, "Spreadsheet ID cannot be empty")
        .describe("Spreadsheet ID to delete"),
    };

    // Tool 1: List Spreadsheets
    this.server.tool(
      "listSpreadsheets",
      "Retrieve a list of Google Sheets spreadsheets. Supports search queries to filter spreadsheets.",
      ListSpreadsheetsSchema,
      async ({ maxResults = 10, query = "", nameContains }) => {
        try {
          const clampedMaxResults = Math.min(Math.max(1, maxResults), 100);
          // Build Drive query
          const qParts: string[] = [
            "mimeType='application/vnd.google-apps.spreadsheet'",
          ];
          if (nameContains && nameContains.trim()) {
            const escaped = nameContains.replace(/'/g, "\\'");
            qParts.push(`name contains '${escaped}'`);
          }
          if (query && query.trim()) qParts.push(`(${query})`);
          const q = encodeURIComponent(qParts.join(" and "));
          let endpoint = `/files?pageSize=${clampedMaxResults}&q=${q}`;
          endpoint +=
            "&fields=files(id,name,createdTime,modifiedTime,owners,webViewLink)";

          const response = await makeDriveApiCall(
            endpoint,
            this.props.bearerToken,
          );

          if (!response.ok) {
            const error = await response.text();
            return {
              content: [
                {
                  type: "text",
                  text: `**Error**\n\nGoogle Drive API error: ${response.status} ${response.statusText}\n\n**Details:**\n${error}`,
                  isError: true,
                },
              ],
            };
          }

          const data = (await response.json()) as any;
          const spreadsheets = data.files || [];

          if (spreadsheets.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: "**Google Sheets Spreadsheets**\n\nNo spreadsheets found matching the query.",
                },
              ],
            };
          }

          const spreadsheetDetails = spreadsheets.map((sheet: any) => ({
            id: sheet.id,
            name: sheet.name,
            createdTime: sheet.createdTime,
            modifiedTime: sheet.modifiedTime,
            owners:
              sheet.owners?.map(
                (owner: any) => owner.displayName || owner.emailAddress,
              ) || [],
            webViewLink: sheet.webViewLink,
          }));

          return {
            content: [
              {
                type: "text",
                text: `**Google Sheets Spreadsheets**\n\nFound ${spreadsheetDetails.length} spreadsheets\n\n**Results:**\n\`\`\`json\n${JSON.stringify(spreadsheetDetails, null, 2)}\n\`\`\``,
              },
            ],
          };
        } catch (error) {
          console.error("listSpreadsheets error:", error);
          return {
            content: [
              {
                type: "text",
                text: `**Error**\n\nError retrieving spreadsheets: ${error}`,
                isError: true,
              },
            ],
          };
        }
      },
    );

    // Tool 2: Get Spreadsheet Info
    this.server.tool(
      "getSpreadsheet",
      "Retrieve information about a specific Google Sheets spreadsheet including its sheets and properties.",
      GetSpreadsheetSchema,
      async ({ spreadsheetId }) => {
        try {
          const response = await makeSheetsApiCall(
            `/spreadsheets/${spreadsheetId}`,
            this.props.bearerToken,
          );

          if (!response.ok) {
            const error = await response.text();
            return {
              content: [
                {
                  type: "text",
                  text: `**Error**\n\nGoogle Sheets API error: ${response.status} ${response.statusText}\n\n**Details:**\n${error}`,
                  isError: true,
                },
              ],
            };
          }

          const spreadsheet = (await response.json()) as any;

          const spreadsheetDetails = {
            spreadsheetId: spreadsheet.spreadsheetId,
            properties: {
              title: spreadsheet.properties?.title,
              locale: spreadsheet.properties?.locale,
              timeZone: spreadsheet.properties?.timeZone,
            },
            sheets:
              spreadsheet.sheets?.map((sheet: any) => ({
                sheetId: sheet.properties?.sheetId,
                title: sheet.properties?.title,
                index: sheet.properties?.index,
                sheetType: sheet.properties?.sheetType,
                gridProperties: sheet.properties?.gridProperties,
              })) || [],
            spreadsheetUrl: spreadsheet.spreadsheetUrl,
          };

          return {
            content: [
              {
                type: "text",
                text: `**Google Sheets Spreadsheet**\n\nSpreadsheet retrieved successfully\n\n**Details:**\n\`\`\`json\n${JSON.stringify(spreadsheetDetails, null, 2)}\n\`\`\``,
              },
            ],
          };
        } catch (error) {
          console.error("getSpreadsheet error:", error);
          return {
            content: [
              {
                type: "text",
                text: `**Error**\n\nError retrieving spreadsheet: ${error}`,
                isError: true,
              },
            ],
          };
        }
      },
    );

    // Tool 3: Create Spreadsheet
    this.server.tool(
      "createSpreadsheet",
      "Create a new Google Sheets spreadsheet with the specified title and optional sheet names.",
      CreateSpreadsheetSchema,
      async ({ title, sheetTitles = ["Sheet1"] }) => {
        try {
          const spreadsheetData = {
            properties: {
              title: title,
            },
            sheets: sheetTitles.map((sheetTitle, index) => ({
              properties: {
                title: sheetTitle,
                index: index,
              },
            })),
          };

          const response = await makeSheetsApiCall(
            `/spreadsheets`,
            this.props.bearerToken,
            {
              method: "POST",
              body: JSON.stringify(spreadsheetData),
            },
          );

          if (!response.ok) {
            const error = await response.text();
            return {
              content: [
                {
                  type: "text",
                  text: `**Error**\n\nGoogle Sheets API error: ${response.status} ${response.statusText}\n\n**Details:**\n${error}`,
                  isError: true,
                },
              ],
            };
          }

          const spreadsheet = (await response.json()) as any;

          const result = {
            spreadsheetId: spreadsheet.spreadsheetId,
            title: spreadsheet.properties?.title,
            spreadsheetUrl: spreadsheet.spreadsheetUrl,
            sheets:
              spreadsheet.sheets?.map((sheet: any) => ({
                title: sheet.properties?.title,
                sheetId: sheet.properties?.sheetId,
              })) || [],
          };

          return {
            content: [
              {
                type: "text",
                text: `**Spreadsheet Created Successfully**\n\nSpreadsheet "${title}" created\n\n**Details:**\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``,
              },
            ],
          };
        } catch (error) {
          console.error("createSpreadsheet error:", error);
          return {
            content: [
              {
                type: "text",
                text: `**Error**\n\nError creating spreadsheet: ${error}`,
                isError: true,
              },
            ],
          };
        }
      },
    );

    // Tool 4: Get Values
    this.server.tool(
      "getValues",
      "Read values from a specific range in a Google Sheets spreadsheet.",
      GetValuesSchema,
      async ({ spreadsheetId, range }) => {
        try {
          const response = await makeSheetsApiCall(
            `/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}`,
            this.props.bearerToken,
          );

          if (!response.ok) {
            const error = await response.text();
            return {
              content: [
                {
                  type: "text",
                  text: `**Error**\n\nGoogle Sheets API error: ${response.status} ${response.statusText}\n\n**Details:**\n${error}`,
                  isError: true,
                },
              ],
            };
          }

          const data = (await response.json()) as any;

          const result = {
            range: data.range,
            majorDimension: data.majorDimension,
            values: data.values || [],
            rowCount: data.values?.length || 0,
            columnCount: data.values?.[0]?.length || 0,
          };

          return {
            content: [
              {
                type: "text",
                text: `**Values Retrieved Successfully**\n\nValues from range "${range}"\n\n**Details:**\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``,
              },
            ],
          };
        } catch (error) {
          console.error("getValues error:", error);
          return {
            content: [
              {
                type: "text",
                text: `**Error**\n\nError retrieving values: ${error}`,
                isError: true,
              },
            ],
          };
        }
      },
    );

    // Tool 4b: Batch Get Values
    this.server.tool(
      "batchGetValues",
      "Read values for multiple ranges in one request.",
      BatchGetValuesSchema,
      async ({ spreadsheetId, ranges }) => {
        try {
          const params = new URLSearchParams();
          for (const r of ranges) params.append("ranges", r);
          const response = await makeSheetsApiCall(
            `/spreadsheets/${spreadsheetId}/values:batchGet?${params.toString()}`,
            this.props.bearerToken,
          );
          if (!response.ok) {
            const error = await response.text();
            return {
              content: [
                {
                  type: "text",
                  text: `Error batch getting values: ${response.status} ${response.statusText}\n${error}`,
                  isError: true,
                },
              ],
            };
          }
          const data = (await response.json()) as any;
          return {
            content: [
              {
                type: "text",
                text: `Batch values\n\n\`\`\`json\n${JSON.stringify(data.valueRanges || [], null, 2)}\n\`\`\``,
              },
            ],
          };
        } catch (e) {
          return {
            content: [{ type: "text", text: String(e), isError: true }],
          };
        }
      },
    );

    // Tool 5: Update Values
    this.server.tool(
      "updateValues",
      "Update values in a specific range of a Google Sheets spreadsheet.",
      UpdateValuesSchema,
      async ({ spreadsheetId, range, values }) => {
        try {
          const requestBody = {
            values: values,
            majorDimension: "ROWS",
          };

          const response = await makeSheetsApiCall(
            `/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
            this.props.bearerToken,
            {
              method: "PUT",
              body: JSON.stringify(requestBody),
            },
          );

          if (!response.ok) {
            const error = await response.text();
            return {
              content: [
                {
                  type: "text",
                  text: `**Error**\n\nGoogle Sheets API error: ${response.status} ${response.statusText}\n\n**Details:**\n${error}`,
                  isError: true,
                },
              ],
            };
          }

          const result = (await response.json()) as any;

          return {
            content: [
              {
                type: "text",
                text: `**Values Updated Successfully**\n\nUpdated ${result.updatedCells} cells in range "${range}"\n\n**Details:**\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``,
              },
            ],
          };
        } catch (error) {
          console.error("updateValues error:", error);
          return {
            content: [
              {
                type: "text",
                text: `**Error**\n\nError updating values: ${error}`,
                isError: true,
              },
            ],
          };
        }
      },
    );

    // Tool 5b: Batch Update Values
    this.server.tool(
      "batchUpdateValues",
      "Update multiple ranges in one request.",
      BatchUpdateValuesSchema,
      async ({ spreadsheetId, data, valueInputOption = "USER_ENTERED" }) => {
        try {
          const response = await makeSheetsApiCall(
            `/spreadsheets/${spreadsheetId}/values:batchUpdate`,
            this.props.bearerToken,
            {
              method: "POST",
              body: JSON.stringify({ valueInputOption, data }),
            },
          );
          if (!response.ok) {
            const error = await response.text();
            return {
              content: [
                {
                  type: "text",
                  text: `Error batch updating values: ${response.status} ${response.statusText}\n${error}`,
                  isError: true,
                },
              ],
            };
          }
          return {
            content: [
              {
                type: "text",
                text: `Batch update successful\n\n\`\`\`json\n${JSON.stringify(await response.json(), null, 2)}\n\`\`\``,
              },
            ],
          };
        } catch (e) {
          return {
            content: [{ type: "text", text: String(e), isError: true }],
          };
        }
      },
    );

    // Tool 6: Append Values
    this.server.tool(
      "appendValues",
      "Append values to a Google Sheets spreadsheet.",
      AppendValuesSchema,
      async ({ spreadsheetId, range, values }) => {
        try {
          const requestBody = {
            values: values,
            majorDimension: "ROWS",
          };

          const response = await makeSheetsApiCall(
            `/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
            this.props.bearerToken,
            {
              method: "POST",
              body: JSON.stringify(requestBody),
            },
          );

          if (!response.ok) {
            const error = await response.text();
            return {
              content: [
                {
                  type: "text",
                  text: `**Error**\n\nGoogle Sheets API error: ${response.status} ${response.statusText}\n\n**Details:**\n${error}`,
                  isError: true,
                },
              ],
            };
          }

          const result = (await response.json()) as any;

          return {
            content: [
              {
                type: "text",
                text: `**Values Appended Successfully**\n\nAppended ${result.updates?.updatedCells} cells starting at "${result.updates?.updatedRange}"\n\n**Details:**\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``,
              },
            ],
          };
        } catch (error) {
          console.error("appendValues error:", error);
          return {
            content: [
              {
                type: "text",
                text: `**Error**\n\nError appending values: ${error}`,
                isError: true,
              },
            ],
          };
        }
      },
    );

    // Tool 6b: Clear Range
    this.server.tool(
      "clearRange",
      "Clear values in a specified range.",
      ClearRangeSchema,
      async ({ spreadsheetId, range }) => {
        try {
          const response = await makeSheetsApiCall(
            `/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:clear`,
            this.props.bearerToken,
            { method: "POST" },
          );
          if (!response.ok)
            return {
              content: [
                {
                  type: "text",
                  text: `Error clearing range: ${response.status} ${response.statusText}\n${await response.text()}`,
                  isError: true,
                },
              ],
            };
          return {
            content: [{ type: "text", text: `Range cleared: ${range}` }],
          };
        } catch (e) {
          return {
            content: [{ type: "text", text: String(e), isError: true }],
          };
        }
      },
    );

    // Tool 7: Delete Spreadsheet
    this.server.tool(
      "deleteSpreadsheet",
      "Delete a Google Sheets spreadsheet by moving it to trash.",
      DeleteSpreadsheetSchema,
      async ({ spreadsheetId }) => {
        try {
          const response = await makeDriveApiCall(
            `/files/${spreadsheetId}`,
            this.props.bearerToken,
            {
              method: "DELETE",
            },
          );

          if (!response.ok) {
            const error = await response.text();
            return {
              content: [
                {
                  type: "text",
                  text: `**Error**\n\nGoogle Drive API error: ${response.status} ${response.statusText}\n\n**Details:**\n${error}`,
                  isError: true,
                },
              ],
            };
          }

          return {
            content: [
              {
                type: "text",
                text: `**Spreadsheet Deleted**\n\nSpreadsheet with ID "${spreadsheetId}" has been moved to trash.`,
              },
            ],
          };
        } catch (error) {
          console.error("deleteSpreadsheet error:", error);
          return {
            content: [
              {
                type: "text",
                text: `**Error**\n\nError deleting spreadsheet: ${error}`,
                isError: true,
              },
            ],
          };
        }
      },
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
