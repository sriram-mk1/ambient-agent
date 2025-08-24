import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      allowedOrigins: ["localhost:3000"],
    },
  },
  webpack: (config, { isServer, dev }) => {
    // Handle Node.js modules and MCP adapters
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push({
        "@modelcontextprotocol/sdk": "commonjs @modelcontextprotocol/sdk",
        "@langchain/mcp-adapters": "commonjs @langchain/mcp-adapters",
        googleapis: "commonjs googleapis",
        "google-auth-library": "commonjs google-auth-library",
        gaxios: "commonjs gaxios",
        "node-fetch": "commonjs node-fetch",
      });
    } else {
      // For client-side, completely ignore server-only modules
      config.resolve.alias = {
        ...config.resolve.alias,
        googleapis: false,
        "google-auth-library": false,
        gaxios: false,
        "node-fetch": false,
      };
    }

    // Add fallbacks for Node.js modules
    config.resolve.fallback = {
      ...config.resolve.fallback,
      "node:process": false,
      "node:stream": false,
      "node:path": false,
      "node:os": false,
      "node:crypto": false,
      "node:fs": false,
      "node:buffer": false,
      "node:http": false,
      "node:https": false,
      "node:net": false,
      "node:tls": false,
      "node:url": false,
      "node:util": false,
      "node:events": false,
      "node:querystring": false,
      "node:zlib": false,
      process: require.resolve("process/browser"),
      stream: require.resolve("stream-browserify"),
      path: require.resolve("path-browserify"),
      crypto: require.resolve("crypto-browserify"),
      fs: false,
      net: false,
      tls: false,
      http: false,
      https: false,
      url: false,
      util: false,
      events: false,
      querystring: false,
      zlib: false,
      googleapis: false,
      "google-auth-library": false,
      gaxios: false,
      "node-fetch": false,
    };

    // Handle dynamic imports and eval restrictions
    config.module.rules.push({
      test: /\.m?js$/,
      resolve: {
        fullySpecified: false,
      },
    });

    return config;
  },
  transpilePackages: ["@langchain/mcp-adapters", "@modelcontextprotocol/sdk"],
};

export default nextConfig;
