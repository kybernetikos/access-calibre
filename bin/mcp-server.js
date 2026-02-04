#!/usr/bin/env node
const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  McpError,
} = require("@modelcontextprotocol/sdk/types.js");
const fs = require("fs");
const CalibreClient = require("../index");

const CALIBRE_URL = process.env.CALIBRE_URL || "http://[::1]:8080/";
const CALIBRE_USERNAME = process.env.CALIBRE_USERNAME || null;
const CALIBRE_PASSWORD = process.env.CALIBRE_PASSWORD || null;

const client = new CalibreClient(CALIBRE_URL, CALIBRE_USERNAME, CALIBRE_PASSWORD);

const LOG_ENABLED = process.argv.includes('--verbose') || process.argv.includes('-v');
const LOG_FILE_ARG = process.argv.find(arg => arg.startsWith('--log-file='));
const LOG_FILE = LOG_FILE_ARG ? LOG_FILE_ARG.split('=')[1] : null;

function log(message, data = null) {
  if (LOG_ENABLED || LOG_FILE) {
    const timestamp = new Date().toISOString();
    let logMessage = `[${timestamp}] [LOG] ${message}`;
    if (data) {
      if (data instanceof Error) {
        logMessage += `: ${data.message}\n${data.stack}`;
      } else {
        logMessage += `: ${JSON.stringify(data, null, 2)}`;
      }
    }
    logMessage += '\n';

    if (LOG_FILE) {
      try {
        fs.appendFileSync(LOG_FILE, logMessage);
      } catch (err) {
        console.error(`Failed to write to log file ${LOG_FILE}: ${err.message}`);
      }
    }

    if (LOG_ENABLED) {
      if (data) {
        console.error(`[LOG] ${message}:`, data instanceof Error ? data : JSON.stringify(data, null, 2));
      } else {
        console.error(`[LOG] ${message}`);
      }
    }
  }
}

const server = new Server(
  {
    name: "calibre-reader",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
      prompts: {},
    },
  }
);

server.setRequestHandler(ListPromptsRequestSchema, async () => {
  log("ListPrompts requested");
  const response = {
    prompts: [
      {
        name: "analyze_book",
        description: "Guidance on how to investigate and analyze a book in the Calibre library.",
        arguments: [
          {
            name: "bookTitle",
            description: "The title of the book to analyze",
            required: true
          }
        ]
      }
    ]
  };
  log("ListPrompts response", response);
  return response;
});

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  log(`GetPrompt requested: ${request.params.name}`, request.params.arguments);
  if (request.params.name === "analyze_book") {
    const bookTitle = request.params.arguments?.bookTitle;
    const response = {
      description: `Analyze book: ${bookTitle}`,
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `I want to investigate details in the book "${bookTitle}". 

To do this effectively, please follow these steps:
1. Use 'search_books' to find the book and get its 'libraryId' and 'bookId'. Use Calibre's search syntax for better accuracy (e.g., 'author:"Author Name"' or 'title:"Book Title"').
2. Use 'list_chapters' to understand the structure of the book.
3. If you are looking for specific information (characters, events, etc.), use 'search_in_book' to find relevant snippets.
4. Once you identify relevant chapters or sections from the search results or the table of contents, use 'get_chapter_content_markdown' to read the full text. This is the preferred method for reading. Remember that large chapters are truncated, so check the 'Section Info' at the end and use the 'offset' if you need to read more.
   IMPORTANT: If you got an offset from 'search_in_book', you MUST use 'markdownOffset' when calling 'get_chapter_content_markdown'. Do NOT use 'htmlOffset' with the Markdown tool.
5. If the book has images or complex formatting that is hard to understand from Markdown or HTML alone, use 'render_chapter_page' to see what a specific page looks like.

Please start by searching for the book.`
          }
        }
      ]
    };
    log(`GetPrompt response: ${request.params.name}`, response);
    return response;
  }
  log(`GetPrompt error: Unknown prompt ${request.params.name}`);
  throw new McpError(ErrorCode.InvalidParams, `Unknown prompt: ${request.params.name}`);
});

server.setRequestHandler(ListToolsRequestSchema, async () => {
  log("ListTools requested");
  const response = {
    tools: [
      {
        name: "list_libraries",
        description: "List available Calibre libraries with their book counts. This is usually the first step to find where books are stored.",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
      {
        name: "search_books",
        description: "Search for books across all libraries. Highly recommended to use Calibre's search syntax for precise results: e.g., 'author:\"Robert Service\"', 'title:\"The Spell of the Yukon\"', or 'series:\"Foundation\"'. A plain string search will match title, authors, tags, and series.",
        inputSchema: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Search query. Use Calibre syntax like 'author:\"Name\"' to find books by a specific author. Use quotes for multi-word names.",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "list_books",
        description: "List books in a specific library",
        inputSchema: {
          type: "object",
          properties: {
            libraryId: {
              type: "string",
              description: "The ID of the library",
            },
            limit: {
              type: "number",
              description: "Maximum number of books to return (default 100)",
            },
            offset: {
              type: "number",
              description: "Offset for pagination (default 0)",
            },
          },
          required: ["libraryId"],
        },
      },
      {
        name: "list_chapters",
        description: "List all chapters of a specific book in their linear reading order. This provides the 'path' for each chapter which is required to read its content or render it. Use this to get an overview of the book's structure and to navigate between chapters.",
        inputSchema: {
          type: "object",
          properties: {
            libraryId: {
              type: "string",
              description: "The ID of the library",
            },
            bookId: {
              type: "number",
              description: "The ID of the book",
            },
          },
          required: ["libraryId", "bookId"],
        },
      },
      {
        name: "get_chapter_content",
        description: "Get the HTML content of a specific chapter. Use this only if you need raw HTML or detailed rendering information. For most reading tasks, use 'get_chapter_content_markdown' instead. IMPORTANT: Large chapters are truncated. Check the end of the response for 'Section Info' to see if more content is available and use 'offset' to retrieve subsequent parts. If you need the end of a chapter, you must first check the 'Total Chapter Length' and request the final section.",
        inputSchema: {
          type: "object",
          properties: {
            libraryId: {
              type: "string",
              description: "The ID of the library",
            },
            bookId: {
              type: "number",
              description: "The ID of the book",
            },
            path: {
              type: "string",
              description: "The internal file path of the chapter (from list_chapters)",
            },
            offset: {
              type: "number",
              description: "The character offset to start from (default 0)",
            },
            length: {
              type: "number",
              description: "The number of characters to retrieve (default 30000). Max is around 50000 to avoid context limits.",
            },
          },
          required: ["libraryId", "bookId", "path"],
        },
      },
      {
        name: "get_chapter_content_markdown",
        description: "Get the content of a specific chapter converted to Markdown. This is the DEFAULT and RECOMMENDED tool for reading book content. IMPORTANT: Large chapters are truncated. Check the end of the response for 'Section Info' to see if more content is available and use 'offset' to retrieve subsequent parts. If you are using an offset from 'search_in_book', you MUST use 'markdownOffset', NOT 'htmlOffset'.",
        inputSchema: {
          type: "object",
          properties: {
            libraryId: {
              type: "string",
              description: "The ID of the library",
            },
            bookId: {
              type: "number",
              description: "The ID of the book",
            },
            path: {
              type: "string",
              description: "The internal file path of the chapter (from list_chapters)",
            },
            offset: {
              type: "number",
              description: "The character offset to start from (default 0). Use 'markdownOffset' from search results.",
            },
            length: {
              type: "number",
              description: "The number of characters to retrieve (default 30000). Max is around 50000 to avoid context limits.",
            },
          },
          required: ["libraryId", "bookId", "path"],
        },
      },
      {
        name: "render_chapter_page",
        description: "Render a specific page of a chapter as a PNG image",
        inputSchema: {
          type: "object",
          properties: {
            libraryId: {
              type: "string",
              description: "The ID of the library",
            },
            bookId: {
              type: "number",
              description: "The ID of the book",
            },
            path: {
              type: "string",
              description: "The internal file path of the chapter (from list_chapters)",
            },
            page: {
              type: "number",
              description: "The page number to render (default 1)",
            },
          },
          required: ["libraryId", "bookId", "path"],
        },
      },
      {
        name: "get_book_cover",
        description: "Get the cover image of a book as a PNG",
        inputSchema: {
          type: "object",
          properties: {
            libraryId: {
              type: "string",
              description: "The ID of the library",
            },
            bookId: {
              type: "number",
              description: "The ID of the book",
            },
          },
          required: ["libraryId", "bookId"],
        },
      },
      {
        name: "search_in_book",
        description: "Search for specific literal text or phrases across all chapters of a book. This tool ONLY supports simple literal string matching. It does NOT support boolean operators like AND, OR, NOT, or parentheses. It does NOT support quotes for phrases - just type the phrase. If you need to find multiple terms, call this tool multiple times for each term. Returns snippets of text with their character offsets.",
        inputSchema: {
          type: "object",
          properties: {
            libraryId: {
              type: "string",
              description: "The ID of the library",
            },
            bookId: {
              type: "number",
              description: "The ID of the book",
            },
            query: {
              type: "string",
              description: "The literal text to search for. MUST be a simple string, NOT a boolean expression or quoted phrase.",
            },
          },
          required: ["libraryId", "bookId", "query"],
        },
      },
      {
        name: "get_epub_file",
        description: "Retrieve any file from the EPUB (e.g. CSS, images)",
        inputSchema: {
          type: "object",
          properties: {
            libraryId: {
              type: "string",
              description: "The ID of the library",
            },
            bookId: {
              type: "number",
              description: "The ID of the book",
            },
            path: {
              type: "string",
              description: "The internal file path in the EPUB",
            },
          },
          required: ["libraryId", "bookId", "path"],
        },
      },
      {
        name: "get_book_metadata",
        description: "Get full metadata for a specific book",
        inputSchema: {
          type: "object",
          properties: {
            libraryId: {
              type: "string",
              description: "The ID of the library",
            },
            bookId: {
              type: "number",
              description: "The ID of the book",
            },
          },
          required: ["libraryId", "bookId"],
        },
      },
    ],
  };
  log("ListTools response", { count: response.tools.length });
  return response;
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  log(`Tool call: ${name}`, args);

  try {
    let response;
    switch (name) {
      case "list_libraries": {
        const libraries = await client.getLibraries();
        const formattedLibraries = Object.entries(libraries).map(([id, info]) => {
          let name = id;
          let bookCount = undefined;
          if (typeof info === 'object' && info !== null) {
            name = info.name || id;
            bookCount = info.num_books;
          } else if (typeof info === 'string') {
            name = info;
          }
          return { id, name, bookCount };
        });
        response = {
          content: [{ type: "text", text: JSON.stringify(formattedLibraries, null, 2) }],
        };
        break;
      }

      case "search_books": {
        if (!args.query) {
          throw new McpError(ErrorCode.InvalidParams, "Query is required");
        }
        const query = args.query;
        const libraries = await client.getLibraries();
        const results = [];

        for (const libraryId of Object.keys(libraries)) {
          // Use Calibre's search syntax for better performance
          // and because it's what the user asked for (finding books by author)
          // "search" in Calibre by default searches title, authors, tags etc.
          // Now using /ajax/search for reliable filtering.
          const { books } = await client.getBooks(libraryId, 100, 0, query);
          if (Array.isArray(books)) {
            for (const book of books) {
              results.push({
                libraryId,
                libraryName: libraries[libraryId],
                bookId: book.id || book.application_id,
                title: book.title,
                authors: book.authors
              });
            }
          }
        }
        response = {
          content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
        };
        break;
      }

      case "list_books": {
        if (!args.libraryId) {
          throw new McpError(ErrorCode.InvalidParams, "libraryId is required");
        }
        const limit = args.limit || 100;
        const offset = args.offset || 0;
        const { books, total } = await client.getBooks(args.libraryId, limit, offset);
        
        // Return only important fields to save context space
        const simplifiedBooks = books.map(book => ({
          id: book.id || book.application_id,
          title: book.title,
          authors: book.authors,
          timestamp: book.timestamp,
          size: book.size
        }));

        const result = {
          books: simplifiedBooks,
          pagination: {
            limit,
            offset,
            total: total
          }
        };

        response = {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
        break;
      }

      case "get_book_metadata": {
        if (!args.libraryId || !args.bookId) {
          throw new McpError(ErrorCode.InvalidParams, "libraryId and bookId are required");
        }
        const metadata = await client.getBookMetadata(args.libraryId, args.bookId);
        response = {
          content: [{ type: "text", text: JSON.stringify(metadata, null, 2) }],
        };
        break;
      }

      case "list_chapters": {
        if (!args.libraryId || !args.bookId) {
          throw new McpError(ErrorCode.InvalidParams, "libraryId and bookId are required");
        }
        const chapters = await client.getChapters(args.libraryId, args.bookId);
        response = {
          content: [{ type: "text", text: JSON.stringify(chapters, null, 2) }],
        };
        break;
      }

      case "get_chapter_content":
      case "get_chapter_content_markdown": {
        if (!args.libraryId || !args.bookId || !args.path) {
          throw new McpError(ErrorCode.InvalidParams, "libraryId, bookId and path are required");
        }

        let content;
        if (name === "get_chapter_content_markdown") {
          content = await client.getChapterContentMarkdown(args.libraryId, args.bookId, args.path);
        } else {
          content = await client.getEpubFile(args.libraryId, args.bookId, args.path);
        }
        
        const offset = args.offset || 0;
        const DEFAULT_LENGTH = 30000;
        const length = args.length || DEFAULT_LENGTH;
        
        if (offset >= content.length && content.length > 0) {
          let errorMessage = `Error: Offset ${offset} is beyond the end of the content (total length: ${content.length}).`;
          if (name === "get_chapter_content_markdown") {
            errorMessage += " IMPORTANT: You are using the Markdown tool, but the offset you provided might be from a search result's 'htmlOffset'. When using 'get_chapter_content_markdown', you MUST use the 'markdownOffset' from search results.";
          }
          response = {
            content: [{ 
              type: "text", 
              text: errorMessage 
            }],
            isError: true
          };
          break;
        }

        let slicedContent = content;
        // substring(start, end)
        const end = offset + length;
        slicedContent = content.substring(offset, end);

        console.error(`Returning chapter content (${name}), original length: ${content.length}, returning from ${offset}, to ${end}, actual returned length: ${slicedContent.length}`);
        
        const toolResponse = {
          content: [],
        };

        const nextOffset = offset + slicedContent.length;
        const hasMore = nextOffset < content.length;
        const isTruncated = slicedContent.length < content.length;

        let text = slicedContent;
        if (hasMore) {
          text += `\n\n... [CONTENT TRUNCATED. Total length: ${content.length} characters. See Section Info below for details] ...`;
        }

        toolResponse.content.push({ type: "text", text });

        // Always include section info if the content is potentially part of a larger whole
        // or if explicitly requested as a section
        if (isTruncated || offset > 0) {
          toolResponse.content.push({
            type: "text",
            text: `\n--- Section Info ---\nOffset: ${offset}\nReturned Length: ${slicedContent.length}\nTotal Chapter Length: ${content.length}\n${hasMore ? `Next Offset: ${nextOffset}\nMore content available. To see the rest, call this tool again with offset=${nextOffset}.` : "End of chapter."}`
          });
        }

        response = toolResponse;
        break;
      }
      
      case "render_chapter_page": {
        if (!args.libraryId || !args.bookId || !args.path) {
          throw new McpError(ErrorCode.InvalidParams, "libraryId, bookId and path are required");
        }
        const { buffer, totalPages } = await client.renderChapterPage(
          args.libraryId,
          args.bookId,
          args.path,
          args.page || 1
        );
        response = {
          content: [
            {
              type: "text",
              text: `Page ${args.page || 1} of ${totalPages}`,
            },
            {
              type: "image",
              data: buffer.toString("base64"),
              mimeType: "image/png",
            },
          ],
        };
        break;
      }

      case "get_book_cover": {
        if (!args.libraryId || !args.bookId) {
          throw new McpError(ErrorCode.InvalidParams, "libraryId and bookId are required");
        }
        const buffer = await client.getBookCover(args.libraryId, args.bookId);
        response = {
          content: [
            {
              type: "image",
              data: buffer.toString("base64"),
              mimeType: "image/png",
            },
            {
              type: "text",
              text: `Cover image for book ID ${args.bookId} in library ${args.libraryId}`,
            }
          ],
        };
        break;
      }

      case "search_in_book": {
        if (!args.libraryId || !args.bookId || !args.query) {
          throw new McpError(ErrorCode.InvalidParams, "libraryId, bookId and query are required");
        }
        const query = args.query.trim();
        // Check for common boolean operators that suggest the LLM misunderstood the tool
        if (/\s+AND\s+|\s+OR\s+|\s+NOT\s+|[\(\)"]/.test(query)) {
          return {
            content: [{ 
              type: "text", 
              text: `Error: The search_in_book tool only supports simple literal text matching. It does not support boolean operators (AND, OR, NOT), parentheses, or quotes. Please provide a simple string to search for. For example, instead of '("patient" OR "body") AND "table"', try searching for just 'patient' or just 'table'.` 
            }],
            isError: true,
          };
        }
        const results = await client.searchText(args.libraryId, args.bookId, query);
        const simplifiedResults = results.map(r => ({
          chapterTitle: r.chapterTitle,
          chapterPath: r.chapterPath,
          htmlOffset: r.offset,
          markdownOffset: r.markdownOffset,
          snippet: r.markdownSnippet || r.snippet,
          USAGE_NOTE: "Use 'markdownOffset' with 'get_chapter_content_markdown' and 'htmlOffset' with 'get_chapter_content'."
        }));
        response = {
          content: [{ type: "text", text: JSON.stringify(simplifiedResults, null, 2) }],
        };
        break;
      }

      case "get_epub_file": {
        if (!args.libraryId || !args.bookId || !args.path) {
          throw new McpError(ErrorCode.InvalidParams, "libraryId, bookId and path are required");
        }
        
        const isImage = /\.(png|jpe?g|gif|webp)$/i.test(args.path);
        const responseType = isImage ? 'buffer' : 'text';
        
        const content = await client.getEpubFile(args.libraryId, args.bookId, args.path, responseType);
        
        if (isImage) {
          const mimeType = args.path.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
          response = {
            content: [
              {
                type: "image",
                data: content.toString("base64"),
                mimeType: mimeType,
              },
            ],
          };
        } else {
          response = {
            content: [{ type: "text", text: content }],
          };
        }
        break;
      }

      default:
        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
    log(`Tool response: ${name}`, response);
    return response;
  } catch (error) {
    log(`Tool error: ${name}`, error.message);
    if (error instanceof McpError) {
      throw error;
    }
    return {
      content: [{ type: "text", text: `Error: ${error.message}` }],
      isError: true,
    };
  }
});

async function main() {
  log("Server starting...");
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Calibre Reader MCP server running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
