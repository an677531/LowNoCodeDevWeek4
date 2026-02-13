// ============================================================
// Dev Notes MCP Server
// ============================================================
// This is a Model Context Protocol (MCP) server that lets
// Claude Code save, list, read, delete, and tag markdown notes in ~/dev-notes/.
//
// MCP servers communicate over stdin/stdout using JSON-RPC.
// Claude Code launches this process and calls our "tools."
// ============================================================

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fs from "fs/promises";
import path from "path";
import os from "os";

// ------------------------------------
// Configuration
// ------------------------------------

// All notes are stored in ~/dev-notes/
const NOTES_DIR = path.join(os.homedir(), "dev-notes");

// ------------------------------------
// Helper functions
// ------------------------------------

// Turn a title like "Project Ideas" into "project-ideas.md"
function slugify(title) {
  return (
    title
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-") // replace non-alphanumeric chars with hyphens
      .replace(/^-+|-+$/g, "") + // trim leading/trailing hyphens
    ".md"
  );
}

// Make sure ~/dev-notes/ exists (creates it if not)
async function ensureNotesDir() {
  await fs.mkdir(NOTES_DIR, { recursive: true });
}

// ------------------------------------
// Create the MCP server
// ------------------------------------

// McpServer is the main class from the SDK. We give it a name
// and version so Claude Code can identify it.
const server = new McpServer({
  name: "dev-notes",
  version: "1.0.0",
});

// ------------------------------------
// Tool 1: save_note
// ------------------------------------
// Saves a markdown file to ~/dev-notes/ using a slugified title.
// Example: save_note("Project Ideas", "# Ideas\n- Build a CLI")
//   → creates ~/dev-notes/project-ideas.md

server.tool(
  "save_note", // tool name
  "Save a markdown note to ~/dev-notes/", // description shown to Claude
  {
    // Input schema — what parameters this tool accepts
    title: z.string().describe("Title of the note (used as filename)"),
    content: z.string().describe("Markdown content of the note"),
  },
  async ({ title, content }) => {
    // Make sure the notes directory exists
    await ensureNotesDir();

    // Build the file path from the slugified title
    const filename = slugify(title);
    const filePath = path.join(NOTES_DIR, filename);

    // Write the file
    await fs.writeFile(filePath, content, "utf-8");

    // MCP tools return a result object with a `content` array.
    // Each item has a `type` (usually "text") and the value.
    return {
      content: [
        {
          type: "text",
          text: `Saved note "${title}" to ${filePath}`,
        },
      ],
    };
  }
);

// ------------------------------------
// Tool 2: list_notes
// ------------------------------------
// Lists all .md files in ~/dev-notes/ with their last-modified dates.
// Takes no parameters.

server.tool(
  "list_notes",
  "List all saved notes in ~/dev-notes/",
  {}, // no input parameters
  async () => {
    await ensureNotesDir();

    // Read the directory contents
    const files = await fs.readdir(NOTES_DIR);

    // Filter to only .md files
    const mdFiles = files.filter((f) => f.endsWith(".md"));

    if (mdFiles.length === 0) {
      return {
        content: [{ type: "text", text: "No notes found in ~/dev-notes/" }],
      };
    }

    // Get details for each file
    const notes = await Promise.all(
      mdFiles.map(async (filename) => {
        const filePath = path.join(NOTES_DIR, filename);
        const stats = await fs.stat(filePath);

        // Turn "project-ideas.md" back into a readable title
        const title = filename
          .replace(/\.md$/, "")
          .replace(/-/g, " ")
          .replace(/\b\w/g, (c) => c.toUpperCase()); // capitalize words

        return `- ${title} (${filename}) — modified ${stats.mtime.toLocaleDateString()}`;
      })
    );

    return {
      content: [
        {
          type: "text",
          text: `Notes in ~/dev-notes/:\n\n${notes.join("\n")}`,
        },
      ],
    };
  }
);

// ------------------------------------
// Tool 3: read_note
// ------------------------------------
// Reads a note by title. Slugifies the title to find the file.
// Example: read_note("Project Ideas") → reads ~/dev-notes/project-ideas.md

server.tool(
  "read_note",
  "Read a note from ~/dev-notes/ by title",
  {
    title: z.string().describe("Title of the note to read"),
  },
  async ({ title }) => {
    const filename = slugify(title);
    const filePath = path.join(NOTES_DIR, filename);

    try {
      const content = await fs.readFile(filePath, "utf-8");
      return {
        content: [{ type: "text", text: content }],
      };
    } catch (err) {
      // If the file doesn't exist, return a helpful error
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Note "${title}" not found (looked for ${filename} in ~/dev-notes/)`,
          },
        ],
      };
    }
  }
);

// ------------------------------------
// Tool 4: delete_note
// ------------------------------------
// Deletes a note by title. Slugifies the title to find the file.
// Example: delete_note("Project Ideas") → deletes ~/dev-notes/project-ideas.md

server.tool(
  "delete_note",
  "Delete a note from ~/dev-notes/ by title",
  {
    title: z.string().describe("Title of the note to delete"),
  },
  async ({ title }) => {
    const filename = slugify(title);
    const filePath = path.join(NOTES_DIR, filename);

    try {
      await fs.unlink(filePath);
      return {
        content: [
          { type: "text", text: `Deleted note "${title}" (${filename})` },
        ],
      };
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Note "${title}" not found (looked for ${filename} in ~/dev-notes/)`,
          },
        ],
      };
    }
  }
);

// ------------------------------------
// Tool 5: tag_note
// ------------------------------------
// Adds or replaces a "Tags: ..." line at the top of a note.
// If the file already starts with "Tags: ...", that line is replaced.
// Example: tag_note("Project Ideas", ["cli", "tools"])
//   → first line becomes "Tags: cli, tools"

server.tool(
  "tag_note",
  "Add or update tags on a note in ~/dev-notes/",
  {
    title: z.string().describe("Title of the note to tag"),
    tags: z.array(z.string()).describe("List of tags to apply"),
  },
  async ({ title, tags }) => {
    const filename = slugify(title);
    const filePath = path.join(NOTES_DIR, filename);

    try {
      const existing = await fs.readFile(filePath, "utf-8");

      // If the first line is already a Tags line, replace it; otherwise prepend
      const tagLine = `Tags: ${tags.join(", ")}`;
      const lines = existing.split("\n");
      const updated = lines[0]?.startsWith("Tags: ")
        ? [tagLine, ...lines.slice(1)]
        : [tagLine, ...lines];

      await fs.writeFile(filePath, updated.join("\n"), "utf-8");

      return {
        content: [
          { type: "text", text: `Tagged "${title}" with: ${tags.join(", ")}` },
        ],
      };
    } catch (err) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Note "${title}" not found (looked for ${filename} in ~/dev-notes/)`,
          },
        ],
      };
    }
  }
);

// ------------------------------------
// Start the server
// ------------------------------------
// StdioServerTransport connects the server to stdin/stdout,
// which is how Claude Code communicates with MCP servers.

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // The server is now running and waiting for requests from Claude Code.
  // It will keep running until the parent process (Claude Code) stops it.
}

main().catch((err) => {
  console.error("Server failed to start:", err);
  process.exit(1);
});
