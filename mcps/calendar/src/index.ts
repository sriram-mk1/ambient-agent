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
		name: "Google Calendar MCP Server",
		version: "1.0.0",
	});

	async init() {
		// Helper function to make Google Calendar API calls
		async function makeCalendarApiCall(
			endpoint: string, 
			bearerToken: string,
			options: RequestInit = {}
		): Promise<Response> {
			const url = `https://www.googleapis.com/calendar/v3${endpoint}`;
			
			return fetch(url, {
				...options,
				headers: {
					'Authorization': `${bearerToken}`,
					'Content-Type': 'application/json',
					...options.headers,
				},
			});
		}

		// Calendar tool schemas
        const ListEventsSchema = {
			calendarId: z
				.string()
				.optional()
				.default("primary")
				.describe("Calendar ID to retrieve events from (default: primary)"),
			maxResults: z
				.number()
				.optional()
				.default(10)
				.describe("Maximum number of events to retrieve (default: 10, max: 250)"),
			timeMin: z
				.string()
				.optional()
				.describe("Lower bound (exclusive) for an event's end time to filter by (RFC3339 timestamp)"),
			timeMax: z
				.string()
				.optional()
                .describe("Upper bound (exclusive) for an event's start time to filter by (RFC3339 timestamp)"),
            q: z.string().optional().describe("Free text search query"),
            pageToken: z.string().optional().describe("Pagination token from previous response"),
            showDeleted: z.boolean().optional().default(false),
		};

		const GetEventSchema = {
			calendarId: z
				.string()
				.optional()
				.default("primary")
				.describe("Calendar ID containing the event"),
			eventId: z
				.string()
				.min(1, "Event ID cannot be empty")
				.describe("Google Calendar event ID to retrieve")
		};

		const CreateEventSchema = {
			calendarId: z
				.string()
				.optional()
				.default("primary")
				.describe("Calendar ID to create the event in"),
			summary: z
				.string()
				.min(1, "Event summary cannot be empty")
				.describe("Event title/summary"),
			description: z
				.string()
				.optional()
				.describe("Event description"),
			startDateTime: z
				.string()
				.describe("Event start time (RFC3339 timestamp)"),
			endDateTime: z
				.string()
				.describe("Event end time (RFC3339 timestamp)"),
			location: z
				.string()
				.optional()
				.describe("Event location")
		};

		const UpdateEventSchema = {
			calendarId: z
				.string()
				.optional()
				.default("primary")
				.describe("Calendar ID containing the event"),
			eventId: z
				.string()
				.min(1, "Event ID cannot be empty")
				.describe("Event ID to update"),
			summary: z
				.string()
				.optional()
				.describe("Event title/summary"),
			description: z
				.string()
				.optional()
				.describe("Event description"),
			startDateTime: z
				.string()
				.optional()
				.describe("Event start time (RFC3339 timestamp)"),
			endDateTime: z
				.string()
				.optional()
				.describe("Event end time (RFC3339 timestamp)"),
			location: z
				.string()
				.optional()
				.describe("Event location")
		};

		const DeleteEventSchema = {
			calendarId: z
				.string()
				.optional()
				.default("primary")
				.describe("Calendar ID containing the event"),
			eventId: z
				.string()
				.min(1, "Event ID cannot be empty")
				.describe("Event ID to delete")
		};

        const ListCalendarsSchema = {};

        // New schemas
        const FreeBusySchema = {
            timeMin: z.string().describe("RFC3339 start time"),
            timeMax: z.string().describe("RFC3339 end time"),
            calendarIds: z.array(z.string().min(1)).optional().describe("Calendar IDs to query; defaults to ['primary']"),
            timeZone: z.string().optional(),
        };

        const FindAvailableSlotsSchema = {
            timeMin: z.string(),
            timeMax: z.string(),
            slotMinutes: z.number().min(5).max(480).default(30),
            attendees: z.array(z.string().min(1)).min(1).describe("Calendar IDs/emails to check"),
            timeZone: z.string().optional(),
        };

        const QuickAddEventSchema = {
            calendarId: z.string().optional().default("primary"),
            text: z.string().min(1).describe("Natural language event text"),
        };

        const MoveEventSchema = {
            fromCalendarId: z.string().optional().default("primary"),
            eventId: z.string().min(1),
            destinationCalendarId: z.string().min(1),
        };

        const RespondToEventSchema = {
            calendarId: z.string().optional().default("primary"),
            eventId: z.string().min(1),
            responseStatus: z.enum(["accepted","declined","tentative"]),
            email: z.string().optional().describe("Attendee email to update; defaults to self if present"),
            comment: z.string().optional(),
        };

        const ListAclSchema = {
            calendarId: z.string().optional().default("primary"),
        };

        const AddAclSchema = {
            calendarId: z.string().optional().default("primary"),
            role: z.enum(["freeBusyReader","reader","writer","owner"]).default("reader"),
            scopeType: z.enum(["user","group","domain","default"]),
            scopeValue: z.string().optional().describe("Email or domain; omit for 'default'"),
        };

        const DeleteAclSchema = {
            calendarId: z.string().optional().default("primary"),
            ruleId: z.string().min(1),
        };

        const ColorsSchema = {};

        const BatchDeleteEventsSchema = {
            calendarId: z.string().optional().default("primary"),
            eventIds: z.array(z.string().min(1)).min(1),
        };

		// Tool 1: List Events
		this.server.tool(
			"listEvents",
			"Retrieve a list of events from Google Calendar. Supports time filtering and calendar selection.",
			ListEventsSchema,
            async ({ calendarId = "primary", maxResults = 10, timeMin, timeMax, q, pageToken, showDeleted = false }) => {
				try {
					const clampedMaxResults = Math.min(Math.max(1, maxResults), 250);
					
					let endpoint = `/calendars/${encodeURIComponent(calendarId)}/events?maxResults=${clampedMaxResults}&singleEvents=true&orderBy=startTime`;
					if (timeMin) {
						endpoint += `&timeMin=${encodeURIComponent(timeMin)}`;
					}
					if (timeMax) {
						endpoint += `&timeMax=${encodeURIComponent(timeMax)}`;
					}
                    if (q) endpoint += `&q=${encodeURIComponent(q)}`;
                    if (pageToken) endpoint += `&pageToken=${encodeURIComponent(pageToken)}`;
                    if (showDeleted) endpoint += `&showDeleted=true`;
					
					const response = await makeCalendarApiCall(endpoint, this.props.bearerToken);
					
					if (!response.ok) {
						const error = await response.text();
						return {
							content: [{
								type: "text",
								text: `**Error**\n\nGoogle Calendar API error: ${response.status} ${response.statusText}\n\n**Details:**\n${error}`,
								isError: true
							}]
						};
					}
					
					const data = await response.json() as any;
					const events = data.items || [];
					
					if (events.length === 0) {
						return {
							content: [{
								type: "text",
								text: "**Google Calendar Events**\n\nNo events found matching the criteria."
							}]
						};
					}
					
					const eventDetails = events.map((event: any) => ({
						id: event.id,
						summary: event.summary || "No Title",
						description: event.description || "",
						start: event.start?.dateTime || event.start?.date,
						end: event.end?.dateTime || event.end?.date,
						location: event.location || "",
						status: event.status,
						htmlLink: event.htmlLink,
						created: event.created,
						updated: event.updated,
						attendees: event.attendees?.map((attendee: any) => ({
							email: attendee.email,
							displayName: attendee.displayName,
							responseStatus: attendee.responseStatus
						})) || []
					}));
					
                    return {
                        content: [{
                            type: "text",
                            text: `**Google Calendar Events**\n\nFound ${eventDetails.length} events${data.nextPageToken ? `\n\nnextPageToken: ${data.nextPageToken}` : ""}\n\n**Results:**\n\`\`\`json\n${JSON.stringify(eventDetails, null, 2)}\n\`\`\``
                        }]
                    };
					
				} catch (error) {
					console.error('listEvents error:', error);
					return {
						content: [{
							type: "text",
							text: `**Error**\n\nError retrieving events: ${error}`,
							isError: true
						}]
					};
				}
			}
		);
		
		// Tool 2: Get Event Details
		this.server.tool(
			"getEvent",
			"Retrieve full details of a specific calendar event by event ID.",
			GetEventSchema,
			async ({ calendarId = "primary", eventId }) => {
				try {
					const response = await makeCalendarApiCall(
						`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, 
						this.props.bearerToken
					);
					
					if (!response.ok) {
						const error = await response.text();
						return {
							content: [{
								type: "text",
								text: `**Error**\n\nGoogle Calendar API error: ${response.status} ${response.statusText}\n\n**Details:**\n${error}`,
								isError: true
							}]
						};
					}
					
					const event = await response.json() as any;
					
					const eventDetails = {
						id: event.id,
						summary: event.summary || "No Title",
						description: event.description || "",
						start: event.start?.dateTime || event.start?.date,
						end: event.end?.dateTime || event.end?.date,
						location: event.location || "",
						status: event.status,
						htmlLink: event.htmlLink,
						created: event.created,
						updated: event.updated,
						creator: event.creator,
						organizer: event.organizer,
						attendees: event.attendees?.map((attendee: any) => ({
							email: attendee.email,
							displayName: attendee.displayName,
							responseStatus: attendee.responseStatus
						})) || [],
						recurrence: event.recurrence || [],
						reminders: event.reminders
					};
					
					return {
						content: [{
							type: "text",
							text: `**Google Calendar Event Details**\n\nEvent retrieved successfully\n\n**Details:**\n\`\`\`json\n${JSON.stringify(eventDetails, null, 2)}\n\`\`\``
						}]
					};
					
				} catch (error) {
					console.error('getEvent error:', error);
					return {
						content: [{
							type: "text",
							text: `**Error**\n\nError retrieving event: ${error}`,
							isError: true
						}]
					};
				}
			}
		);
		
		// Tool 3: Create Event
		this.server.tool(
			"createEvent",
			"Create a new event in Google Calendar.",
			CreateEventSchema,
			async ({ calendarId = "primary", summary, description, startDateTime, endDateTime, location }) => {
				try {
					const eventData = {
						summary,
						description,
						start: {
							dateTime: startDateTime,
							timeZone: 'UTC'
						},
						end: {
							dateTime: endDateTime,
							timeZone: 'UTC'
						},
						location
					};
					
					const response = await makeCalendarApiCall(
						`/calendars/${encodeURIComponent(calendarId)}/events`,
						this.props.bearerToken,
						{
							method: 'POST',
							body: JSON.stringify(eventData)
						}
					);
					
					if (!response.ok) {
						const error = await response.text();
						return {
							content: [{
								type: "text",
								text: `**Error**\n\nGoogle Calendar API error: ${response.status} ${response.statusText}\n\n**Details:**\n${error}`,
								isError: true
							}]
						};
					}
					
					const event = await response.json() as any;
					
					const result = {
						id: event.id,
						summary: event.summary,
						start: event.start?.dateTime || event.start?.date,
						end: event.end?.dateTime || event.end?.date,
						location: event.location,
						htmlLink: event.htmlLink
					};
					
					return {
						content: [{
							type: "text",
							text: `**Event Created Successfully**\n\nEvent "${summary}" created\n\n**Details:**\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``
						}]
					};
					
				} catch (error) {
					console.error('createEvent error:', error);
					return {
						content: [{
							type: "text",
							text: `**Error**\n\nError creating event: ${error}`,
							isError: true
						}]
					};
				}
			}
		);
		
		// Tool 4: Update Event
		this.server.tool(
			"updateEvent",
			"Update an existing event in Google Calendar.",
			UpdateEventSchema,
			async ({ calendarId = "primary", eventId, summary, description, startDateTime, endDateTime, location }) => {
				try {
					// First get the existing event
					const getResponse = await makeCalendarApiCall(
						`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, 
						this.props.bearerToken
					);
					
					if (!getResponse.ok) {
						const error = await getResponse.text();
						return {
							content: [{
								type: "text",
								text: `**Error**\n\nGoogle Calendar API error: ${getResponse.status} ${getResponse.statusText}\n\n**Details:**\n${error}`,
								isError: true
							}]
						};
					}
					
					const existingEvent = await getResponse.json() as any;
					
					// Update only provided fields
					const eventData = {
						...existingEvent,
						...(summary && { summary }),
						...(description !== undefined && { description }),
						...(startDateTime && { start: { dateTime: startDateTime, timeZone: 'UTC' } }),
						...(endDateTime && { end: { dateTime: endDateTime, timeZone: 'UTC' } }),
						...(location !== undefined && { location })
					};
					
					const response = await makeCalendarApiCall(
						`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
						this.props.bearerToken,
						{
							method: 'PUT',
							body: JSON.stringify(eventData)
						}
					);
					
					if (!response.ok) {
						const error = await response.text();
						return {
							content: [{
								type: "text",
								text: `**Error**\n\nGoogle Calendar API error: ${response.status} ${response.statusText}\n\n**Details:**\n${error}`,
								isError: true
							}]
						};
					}
					
					const event = await response.json() as any;
					
					const result = {
						id: event.id,
						summary: event.summary,
						start: event.start?.dateTime || event.start?.date,
						end: event.end?.dateTime || event.end?.date,
						location: event.location,
						htmlLink: event.htmlLink
					};
					
					return {
						content: [{
							type: "text",
							text: `**Event Updated Successfully**\n\nEvent updated\n\n**Details:**\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``
						}]
					};
					
				} catch (error) {
					console.error('updateEvent error:', error);
					return {
						content: [{
							type: "text",
							text: `**Error**\n\nError updating event: ${error}`,
							isError: true
						}]
					};
				}
			}
		);

		// Tool 5: Delete Event
		this.server.tool(
			"deleteEvent",
			"Delete an event from Google Calendar.",
			DeleteEventSchema,
			async ({ calendarId = "primary", eventId }) => {
				try {
					const response = await makeCalendarApiCall(
						`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
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
								text: `**Error**\n\nGoogle Calendar API error: ${response.status} ${response.statusText}\n\n**Details:**\n${error}`,
								isError: true
							}]
						};
					}

					return {
						content: [{
							type: "text",
							text: `**Event Deleted**\n\nEvent with ID "${eventId}" has been deleted from calendar.`
						}]
					};
				} catch (error) {
					console.error('deleteEvent error:', error);
					return {
						content: [{
							type: "text",
							text: `**Error**\n\nError deleting event: ${error}`,
							isError: true
						}]
					};
				}
			}
		);

		// Tool 6: List Calendars
		this.server.tool(
			"listCalendars",
			"Retrieves a list of all calendars in the user's Google Calendar account.",
			ListCalendarsSchema,
			async () => {
				try {
					const response = await makeCalendarApiCall(
						`/users/me/calendarList`,
						this.props.bearerToken	
					);

        // Tool 7: freeBusy
        this.server.tool(
            "freeBusy",
            "Get busy time ranges for one or more calendars.",
            FreeBusySchema,
            async ({ timeMin, timeMax, calendarIds, timeZone }) => {
                try {
                    const body: any = {
                        timeMin,
                        timeMax,
                        items: (calendarIds && calendarIds.length ? calendarIds : ["primary"]).map(id => ({ id })),
                        ...(timeZone ? { timeZone } : {}),
                    };
                    const res = await makeCalendarApiCall(`/freeBusy`, this.props.bearerToken, { method: 'POST', body: JSON.stringify(body) });
                    if (!res.ok) return { content: [{ type: 'text', text: `Error freeBusy: ${res.status} ${res.statusText}\n${await res.text()}`, isError: true }] };
                    return { content: [{ type: 'text', text: `FreeBusy\n\n\`\`\`json\n${JSON.stringify(await res.json(), null, 2)}\n\`\`\`` }] };
                } catch (e) { return { content: [{ type: 'text', text: String(e), isError: true }] }; }
            }
        );

        // Tool 8: findAvailableSlots (basic)
        this.server.tool(
            "findAvailableSlots",
            "Compute available time slots across attendees using free/busy.",
            FindAvailableSlotsSchema,
            async ({ timeMin, timeMax, slotMinutes = 30, attendees, timeZone }) => {
                try {
                    const fbRes = await makeCalendarApiCall(`/freeBusy`, this.props.bearerToken, { method: 'POST', body: JSON.stringify({ timeMin, timeMax, items: attendees.map(id => ({ id })), ...(timeZone ? { timeZone } : {}) }) });
                    if (!fbRes.ok) return { content: [{ type: 'text', text: `Error freeBusy: ${fbRes.status} ${fbRes.statusText}\n${await fbRes.text()}`, isError: true }] };
                    const fb = await fbRes.json() as any;
                    const ranges: Array<{ start: number; end: number }> = [];
                    for (const calId in fb.calendars || {}) {
                        for (const b of fb.calendars[calId].busy || []) {
                            ranges.push({ start: Date.parse(b.start), end: Date.parse(b.end) });
                        }
                    }
                    ranges.sort((a,b) => a.start - b.start);
                    const merged: typeof ranges = [];
                    for (const r of ranges) {
                        if (!merged.length || r.start > merged[merged.length-1].end) merged.push({ ...r });
                        else merged[merged.length-1].end = Math.max(merged[merged.length-1].end, r.end);
                    }
                    const start = Date.parse(timeMin);
                    const end = Date.parse(timeMax);
                    const free: typeof ranges = [];
                    let cursor = start;
                    for (const r of merged) {
                        if (r.start > cursor) free.push({ start: cursor, end: Math.min(r.start, end) });
                        cursor = Math.max(cursor, r.end);
                        if (cursor >= end) break;
                    }
                    if (cursor < end) free.push({ start, end });
                    const slotMs = slotMinutes * 60 * 1000;
                    const slots: Array<{ start: string; end: string }> = [];
                    for (const f of free) {
                        for (let s = f.start; s + slotMs <= f.end; s += slotMs) {
                            slots.push({ start: new Date(s).toISOString(), end: new Date(s + slotMs).toISOString() });
                        }
                    }
                    return { content: [{ type: 'text', text: `Available slots (${slotMinutes}m):\n\n\`\`\`json\n${JSON.stringify(slots, null, 2)}\n\`\`\`` }] };
                } catch (e) { return { content: [{ type: 'text', text: String(e), isError: true }] }; }
            }
        );

        // Tool 9: quickAddEvent
        this.server.tool(
            "quickAddEvent",
            "Create an event from natural language text.",
            QuickAddEventSchema,
            async ({ calendarId = 'primary', text }) => {
                try {
                    const res = await makeCalendarApiCall(`/calendars/${encodeURIComponent(calendarId)}/events/quickAdd?text=${encodeURIComponent(text)}`, this.props.bearerToken, { method: 'POST' });
                    if (!res.ok) return { content: [{ type: 'text', text: `Error quickAdd: ${res.status} ${res.statusText}\n${await res.text()}`, isError: true }] };
                    return { content: [{ type: 'text', text: `Event created\n\n\`\`\`json\n${JSON.stringify(await res.json(), null, 2)}\n\`\`\`` }] };
                } catch (e) { return { content: [{ type: 'text', text: String(e), isError: true }] }; }
            }
        );

        // Tool 10: moveEvent
        this.server.tool(
            "moveEvent",
            "Move an event to another calendar.",
            MoveEventSchema,
            async ({ fromCalendarId = 'primary', eventId, destinationCalendarId }) => {
                try {
                    const res = await makeCalendarApiCall(`/calendars/${encodeURIComponent(fromCalendarId)}/events/${encodeURIComponent(eventId)}/move?destination=${encodeURIComponent(destinationCalendarId)}`, this.props.bearerToken, { method: 'POST' });
                    if (!res.ok) return { content: [{ type: 'text', text: `Error moving event: ${res.status} ${res.statusText}\n${await res.text()}`, isError: true }] };
                    return { content: [{ type: 'text', text: `Event moved\n\n\`\`\`json\n${JSON.stringify(await res.json(), null, 2)}\n\`\`\`` }] };
                } catch (e) { return { content: [{ type: 'text', text: String(e), isError: true }] }; }
            }
        );

        // Tool 11: respondToEvent
        this.server.tool(
            "respondToEvent",
            "Respond (RSVP) to an event as accepted/declined/tentative.",
            RespondToEventSchema,
            async ({ calendarId = 'primary', eventId, responseStatus, email, comment }) => {
                try {
                    const getRes = await makeCalendarApiCall(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, this.props.bearerToken);
                    if (!getRes.ok) return { content: [{ type: 'text', text: `Error fetching event: ${getRes.status} ${getRes.statusText}\n${await getRes.text()}`, isError: true }] };
                    const event = await getRes.json() as any;
                    const attendees = Array.isArray(event.attendees) ? event.attendees.slice() : [];
                    let updated = false;
                    for (const a of attendees) {
                        if ((email && a.email === email) || (!email && a.self)) {
                            a.responseStatus = responseStatus;
                            if (comment) a.comment = comment;
                            updated = true;
                            break;
                        }
                    }
                    if (!updated && email) attendees.push({ email, responseStatus, ...(comment ? { comment } : {}) });
                    const patchRes = await makeCalendarApiCall(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, this.props.bearerToken, { method: 'PATCH', body: JSON.stringify({ attendees }) });
                    if (!patchRes.ok) return { content: [{ type: 'text', text: `Error updating RSVP: ${patchRes.status} ${patchRes.statusText}\n${await patchRes.text()}`, isError: true }] };
                    return { content: [{ type: 'text', text: `RSVP updated\n\n\`\`\`json\n${JSON.stringify(await patchRes.json(), null, 2)}\n\`\`\`` }] };
                } catch (e) { return { content: [{ type: 'text', text: String(e), isError: true }] }; }
            }
        );

        // Tool 12: listAcl
        this.server.tool(
            "listAcl",
            "List ACL rules for a calendar.",
            ListAclSchema,
            async ({ calendarId = 'primary' }) => {
                try {
                    const res = await makeCalendarApiCall(`/calendars/${encodeURIComponent(calendarId)}/acl`, this.props.bearerToken);
                    if (!res.ok) return { content: [{ type: 'text', text: `Error listing ACL: ${res.status} ${res.statusText}\n${await res.text()}`, isError: true }] };
                    return { content: [{ type: 'text', text: `ACL\n\n\`\`\`json\n${JSON.stringify(await res.json(), null, 2)}\n\`\`\`` }] };
                } catch (e) { return { content: [{ type: 'text', text: String(e), isError: true }] }; }
            }
        );

        // Tool 13: addAcl
        this.server.tool(
            "addAcl",
            "Add an ACL rule to a calendar.",
            AddAclSchema,
            async ({ calendarId = 'primary', role = 'reader', scopeType, scopeValue }) => {
                try {
                    const rule: any = { role, scope: { type: scopeType } };
                    if (scopeValue) rule.scope.value = scopeValue;
                    const res = await makeCalendarApiCall(`/calendars/${encodeURIComponent(calendarId)}/acl`, this.props.bearerToken, { method: 'POST', body: JSON.stringify(rule) });
                    if (!res.ok) return { content: [{ type: 'text', text: `Error adding ACL: ${res.status} ${res.statusText}\n${await res.text()}`, isError: true }] };
                    return { content: [{ type: 'text', text: `ACL added\n\n\`\`\`json\n${JSON.stringify(await res.json(), null, 2)}\n\`\`\`` }] };
                } catch (e) { return { content: [{ type: 'text', text: String(e), isError: true }] }; }
            }
        );

        // Tool 14: deleteAcl
        this.server.tool(
            "deleteAcl",
            "Delete an ACL rule from a calendar.",
            DeleteAclSchema,
            async ({ calendarId = 'primary', ruleId }) => {
                try {
                    const res = await makeCalendarApiCall(`/calendars/${encodeURIComponent(calendarId)}/acl/${encodeURIComponent(ruleId)}`, this.props.bearerToken, { method: 'DELETE' });
                    if (!res.ok) return { content: [{ type: 'text', text: `Error deleting ACL: ${res.status} ${res.statusText}\n${await res.text()}`, isError: true }] };
                    return { content: [{ type: 'text', text: `ACL deleted: ${ruleId}` }] };
                } catch (e) { return { content: [{ type: 'text', text: String(e), isError: true }] }; }
            }
        );

        // Tool 15: getColors
        this.server.tool(
            "getColors",
            "Retrieve color definitions for calendars and events.",
            ColorsSchema,
            async () => {
                try {
                    const res = await makeCalendarApiCall(`/colors`, this.props.bearerToken);
                    if (!res.ok) return { content: [{ type: 'text', text: `Error getting colors: ${res.status} ${res.statusText}\n${await res.text()}`, isError: true }] };
                    return { content: [{ type: 'text', text: `Colors\n\n\`\`\`json\n${JSON.stringify(await res.json(), null, 2)}\n\`\`\`` }] };
                } catch (e) { return { content: [{ type: 'text', text: String(e), isError: true }] }; }
            }
        );

        // Tool 16: batchDeleteEvents (simple loop)
        this.server.tool(
            "batchDeleteEvents",
            "Delete multiple events from a calendar.",
            BatchDeleteEventsSchema,
            async ({ calendarId = 'primary', eventIds }) => {
                try {
                    let success = 0;
                    const errors: Array<{ id: string; error: string }> = [];
                    for (const id of eventIds) {
                        const res = await makeCalendarApiCall(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`, this.props.bearerToken, { method: 'DELETE' });
                        if (res.ok) success++; else errors.push({ id, error: await res.text() });
                    }
                    return { content: [{ type: 'text', text: `Batch delete complete. Deleted: ${success}/${eventIds.length}${errors.length ? `\nErrors: ${JSON.stringify(errors, null, 2)}` : ''}` }] };
                } catch (e) { return { content: [{ type: 'text', text: String(e), isError: true }] }; }
            }
        );
					
					if (!response.ok) {
						const error = await response.text();
						return {
							content: [{
								type: "text",
								text: `**Error**\n\nGoogle Calendar API error: ${response.status} ${response.statusText}\n\n**Details:**\n${error}`,
								isError: true
							}]
						};
					}

					const data = await response.json() as any;
					const calendars = data.items || [];

					const formattedCalendars = calendars.map((calendar: any) => ({
						id: calendar.id,
						summary: calendar.summary,
						description: calendar.description,
						timeZone: calendar.timeZone,
						accessRole: calendar.accessRole,
						primary: calendar.primary || false,
						backgroundColor: calendar.backgroundColor,
						foregroundColor: calendar.foregroundColor
					}));

					return {
						content: [{
							type: "text",
							text: `**Google Calendars**\n\nFound ${formattedCalendars.length} calendars:\n\n\`\`\`json\n${JSON.stringify(formattedCalendars, null, 2)}\n\`\`\``
						}]
					};
				} catch (error) {
					console.error('listCalendars error:', error);
					return {
						content: [{
							type: "text",
							text: `**Error**\n\nError listing calendars: ${error}`,
							isError: true
						}]
					};
				}
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
