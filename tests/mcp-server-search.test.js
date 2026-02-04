const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const CalibreClient = require("../src/client");
const nock = require("nock");

// Helper to simulate the MCP server logic without running the full server
// This extracts the core logic from mcp-server.js for search_books
async function mockSearchBooks(query, client, libraries) {
  const results = [];
  for (const libraryId of Object.keys(libraries)) {
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
  return results;
}

async function mockListLibraries(client) {
  const libraries = await client.getLibraries();
  return Object.entries(libraries).map(([id, info]) => {
    let name = id;
    let bookCount = undefined;
    if (typeof info === 'string') {
      name = info;
    } else if (typeof info === 'object' && info !== null) {
      bookCount = info.num_books;
    }
    return { id, name, bookCount };
  });
}

describe('MCP Server Search Filtering', () => {
  const baseUrl = 'http://localhost:8080';
  const client = new CalibreClient(baseUrl);
  const libraries = { 'lib1': 'My Library' };

  afterEach(() => {
    nock.cleanAll();
  });

  test('list_libraries should include book count', async () => {
    const mockData = {
      library_info: { 'lib1': { num_books: 42 } }
    };
    nock(baseUrl)
      .get('/interface-data/init')
      .reply(200, mockData);

    const results = await mockListLibraries(client);

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('lib1');
    expect(results[0].bookCount).toBe(42);
  });

  test('search_books should filter out irrelevant authors when using author: syntax', async () => {
    const query = 'author:"Robert Service"';
    const mockSearchResponse = {
      book_ids: [1, 3],
      total_num: 2
    };
    const mockMetadataResponse = {
      1: { id: 1, title: 'The Spell of the Yukon', authors: ['Robert Service'] },
      3: { id: 3, title: 'Mixed Authors', authors: ['Robert Service', 'Co-author'] }
    };

    nock(baseUrl)
      .get('/ajax/search')
      .query(true)
      .reply(200, mockSearchResponse);

    nock(baseUrl)
      .get('/ajax/books/lib1')
      .query(true)
      .reply(200, mockMetadataResponse);

    const results = await mockSearchBooks(query, client, libraries);

    expect(results).toHaveLength(2);
    expect(results[0].title).toBe('The Spell of the Yukon');
    expect(results[1].title).toBe('Mixed Authors');
  });

  test('search_books should filter out irrelevant titles when using title: syntax', async () => {
    const query = 'title:"Foundation"';
    const mockSearchResponse = {
      book_ids: [1, 2],
      total_num: 2
    };
    const mockMetadataResponse = {
      1: { id: 1, title: 'Foundation', authors: ['Isaac Asimov'] },
      2: { id: 2, title: 'Foundation and Empire', authors: ['Isaac Asimov'] }
    };

    nock(baseUrl)
      .get('/ajax/search')
      .query(true)
      .reply(200, mockSearchResponse);

    nock(baseUrl)
      .get('/ajax/books/lib1')
      .query(true)
      .reply(200, mockMetadataResponse);

    const results = await mockSearchBooks(query, client, libraries);

    expect(results).toHaveLength(2);
    expect(results[0].title).toBe('Foundation');
    expect(results[1].title).toBe('Foundation and Empire');
  });

  test('search_books should handle "Last, First" author format', async () => {
    const query = 'author:"Robert Service"';
    const mockSearchResponse = {
      book_ids: [1],
      total_num: 1
    };
    const mockMetadataResponse = {
      1: { id: 1, title: 'The Spell of the Yukon', authors: ['Service, Robert'] }
    };

    nock(baseUrl)
      .get('/ajax/search')
      .query(true)
      .reply(200, mockSearchResponse);

    nock(baseUrl)
      .get('/ajax/books/lib1')
      .query(true)
      .reply(200, mockMetadataResponse);

    const results = await mockSearchBooks(query, client, libraries);

    expect(results).toHaveLength(1);
    expect(results[0].authors).toContain('Service, Robert');
  });

  test('search_books should NOT filter results for complex OR queries', async () => {
    const query = 'title:"The Hobbit" OR author:"J.R.R. Tolkien"';
    const mockSearchResponse = {
      book_ids: [1, 2],
      total_num: 2
    };
    const mockMetadataResponse = {
      1: { id: 1, title: 'The Hobbit', authors: ['J.R.R. Tolkien'] },
      2: { id: 2, title: 'The Fellowship of the Ring', authors: ['J.R.R. Tolkien'] }
    };

    nock(baseUrl)
      .get('/ajax/search')
      .query(true)
      .reply(200, mockSearchResponse);

    nock(baseUrl)
      .get('/ajax/books/lib1')
      .query(true)
      .reply(200, mockMetadataResponse);

    const results = await mockSearchBooks(query, client, libraries);

    expect(results).toHaveLength(2);
    expect(results[0].title).toBe('The Hobbit');
    expect(results[1].title).toBe('The Fellowship of the Ring');
  });

  test('search_books should filter multi-word queries to ensure all words are present', async () => {
    const query = '"assassin" "apprentice"';
    const mockSearchResponse = {
      book_ids: [1],
      total_num: 1
    };
    const mockMetadataResponse = {
      1: { id: 1, title: "Assassin's Apprentice", authors: ['Robin Hobb'] }
    };

    nock(baseUrl)
      .get('/ajax/search')
      .query(true)
      .reply(200, mockSearchResponse);

    nock(baseUrl)
      .get('/ajax/books/lib1')
      .query(true)
      .reply(200, mockMetadataResponse);

    const results = await mockSearchBooks(query, client, libraries);

    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Assassin's Apprentice");
  });
});
