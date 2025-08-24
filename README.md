# Multi-Step AI Agent with Google Workspace Integration

This project is a sophisticated AI agent designed for complex, multi-step tasks that integrate with Google Workspace services like Gmail, Google Calendar, Google Docs, and Google Sheets. It features real-time streaming of its reasoning process, tool calls, and results, providing a transparent and interactive user experience.

This project was built to demonstrate the power of the [Model-Context Protocol (MCP)](https://mcp.ai), an open standard for building AI agents that can interact with tools and services in a standardized way.

## Table of Contents

- [Key Features](#key-features)
- [Architecture](#architecture)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Configuration](#configuration)
- [Running the Application](#running-the-application)
- [Code Quality and Future Work](#code-quality-and-future-work)
- [Detailed Documentation](#detailed-documentation)

## Key Features

- **Multi-Step Execution**: The agent can perform multiple actions to fulfill a single request, such as searching for emails and then creating a calendar event based on the results.
- **Real-Time Streaming**: Observe the agent's thought process, tool calls, and results as they happen.
- **Google Workspace Integration**: Seamlessly connect and control Gmail, Google Calendar, Google Docs, and Google Sheets.
- **Configurable Agent Behavior**: Customize the agent's execution parameters, such as the maximum number of steps it can take.
- **User-Specific Authentication**: Each user authenticates with their own Google account, ensuring that the agent acts on their behalf and with their permissions.

## Architecture

The application is composed of two main parts:

1.  **Next.js Web Application**: A modern web interface built with Next.js, React, and Tailwind CSS. This is the user-facing part of the application, where users can interact with the AI agent. It also serves the API endpoints that the frontend communicates with.

2.  **MCP Workers**: A set of Cloudflare Workers that act as MCP servers for the various Google Workspace services. Each worker (e.g., for Gmail, Calendar) exposes a standardized set of tools that the AI agent can call. These workers are responsible for handling the logic of interacting with the Google APIs.

### Diagram

```
[User] -> [Next.js App] -> [AI Agent] -> [MCP Manager] -> [MCP Workers (Gmail, Calendar, etc.)] -> [Google APIs]
```

- **Next.js App**: Provides the UI and the main `/api/chat` endpoint.
- **AI Agent**: The core logic that processes user requests, implemented using LangChain and Google's Gemini model.
- **MCP Manager**: A component in the Next.js app that discovers and communicates with the MCP workers.
- **MCP Workers**: Cloudflare Workers that wrap the Google APIs in an MCP-compliant interface.

## Getting Started

### Prerequisites

- Node.js (v20 or later)
- pnpm (or your preferred package manager)
- A Google Cloud Platform project with the Gmail, Google Calendar, Google Docs, and Google Sheets APIs enabled.
- Supabase project for authentication.
- Cloudflare account for deploying the MCP workers.

### Installation

1.  **Clone the repository:**
    ```bash
    git clone <repository-url>
    cd <repository-name>
    ```

2.  **Install dependencies:**
    This is a monorepo-style project, so you will need to install dependencies in the root and in each of the MCP worker directories.
    ```bash
    pnpm install
    cd mcps/gmail && pnpm install && cd ../..
    cd mcps/calendar && pnpm install && cd ../..
    cd mcps/docs && pnpm install && cd ../..
    cd mcps/sheets && pnpm install && cd ../..
    ```

### Configuration

1.  **Root `.env.local` file:**
    Copy the `.env.example` to a new file named `.env.local` and fill in the required values for your Google Cloud, Supabase, and other services.

2.  **MCP Worker Configuration:**
    Each MCP worker in the `mcps/` directory has a `wrangler.jsonc` file. You will need to configure these with your Cloudflare account details. You will also need to set up the necessary secrets (e.g., for Google API access) for each worker.

## Running the Application

1.  **Deploy the MCP Workers:**
    For each worker in the `mcps/` directory, run the following command to deploy it to Cloudflare:
    ```bash
    cd mcps/gmail
    pnpm run deploy # Assuming a deploy script is in package.json
    ```

2.  **Run the Next.js Application:**
    From the root of the project, run:
    ```bash
    pnpm run dev
    ```
    The application will be available at `http://localhost:3000`.

## Code Quality and Future Work

We have identified several areas for improvement in the current codebase, including refactoring duplicated code in the MCP workers and making the agent configuration persistent. For a detailed list of these items, please see the [FIXES_NEEDED.md](./FIXES_NEEDED.md) file.

## Detailed Documentation

For more in-depth information about the AI agent's architecture, capabilities, and API, please refer to the following documents:

- **[Agent Documentation](./AGENT_DOCUMENTATION.md)**: A deep dive into the agent's features, execution flow, and API endpoints.
- **[Token Refresh System](./TOKEN_REFRESH_SYSTEM.md)**: An explanation of how the application manages and refreshes OAuth tokens for Google APIs.
- **[Zep Memory Integration](./ZEP_MEMORY_INTEGRATION.md)**: Details on how the agent uses Zep for long-term conversation memory.
- **[Implementation Summary](./IMPLEMENTATION_SUMMARY.md)**: A summary of the technical implementation details.
