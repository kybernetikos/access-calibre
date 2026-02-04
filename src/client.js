const axios = require('axios');
const AdmZip = require('adm-zip');
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const os = require('os');

class CalibreClient {
    constructor(baseUrl, username = null, password = null) {
        this.baseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
        this.auth = (username && password) ? { username, password } : null;
        this.client = axios.create({
            baseURL: this.baseUrl,
            auth: this.auth
        });
    }

    /**
     * Get a list of libraries available on the server.
     */
    async getLibraries() {
        const response = await this.client.get('/interface-data/init');
        const data = response.data;
        const libraries = data.library_info || data.library_map || {};
        
        // If we don't have book counts, try to get them
        const libraryEntries = Object.entries(libraries);
        const result = {};
        
        for (const [id, info] of libraryEntries) {
            let name = typeof info === 'string' ? info : (info.name || id);
            let count = (typeof info === 'object' && info !== null) ? info.num_books : undefined;

            // Fallback 1: If this is the default library, it might be in search_result
            if (count === undefined && data.library_id === id && data.search_result) {
                count = data.search_result.num_books_without_search;
            }

            if (count !== undefined) {
                result[id] = { name, num_books: count };
            } else {
                // Fallback 2: Try to fetch from /ajax/books
                try {
                    const booksResponse = await this.client.get(`/ajax/books/${id}`, {
                        params: { num: 1 }
                    });
                    
                    let fetchedCount = 0;
                    if (booksResponse.data) {
                        fetchedCount = booksResponse.data.total_num || booksResponse.data.count || 0;
                        if (fetchedCount === 0 && booksResponse.data.book_ids) {
                            fetchedCount = booksResponse.data.book_ids.length;
                        }
                    }
                    
                    result[id] = { name, num_books: fetchedCount };
                } catch (e) {
                    // Fallback 3: Return what we have
                    result[id] = { name };
                }
            }
        }
        return result;
    }

    /**
     * Get books from a specific library.
     * @param {string} libraryId 
     * @param {number} limit 
     * @param {number} offset 
     * @param {string} search search query in Calibre's search syntax
     */
    async getBooks(libraryId, limit = 100, offset = 0, search = '') {
        if (search) {
            // Using /ajax/search is more reliable for filtering than /ajax/books with search param
            const searchResponse = await this.client.get('/ajax/search', {
                params: {
                    query: search,
                    library_id: libraryId,
                    num: limit,
                    offset: offset,
                    sort: 'timestamp',
                    sort_order: 'desc'
                }
            });

            const bookIds = searchResponse.data.book_ids || [];
            const total = searchResponse.data.total_num;

            if (bookIds.length === 0) {
                return { books: [], total };
            }

            // Fetch metadata for these books.
            // The /ajax/books/libraryId endpoint returns a map of books.
            // We fetch with a large limit to get the metadata for the IDs we found.
            const metadataResponse = await this.client.get(`/ajax/books/${libraryId}`, {
                params: {
                    num: 1000000, 
                    start: 0
                }
            });
            
            let metadataMap = {};
            if (metadataResponse.data.metadata) {
                metadataMap = metadataResponse.data.metadata;
            } else if (typeof metadataResponse.data === 'object') {
                metadataMap = metadataResponse.data;
            }

            const books = bookIds.map(id => metadataMap[id] || { id });
            return { books, total };
        }

        let allBooks = [];
        let currentOffset = offset;
        let remaining = limit;
        let totalOnServer = undefined;
        const PAGE_SIZE = 100; // Calibre Content Server might have a limit per request

        while (remaining > 0) {
            const numToFetch = Math.min(remaining, PAGE_SIZE);
            const params = {
                num: numToFetch,
                start: currentOffset,
                sort: 'timestamp',
                order: 'desc'
            };
            if (search) {
                params.search = search;
                // console.error(`Fetching books with search: ${search}, params:`, params);
            }
            const response = await this.client.get(`/ajax/books/${libraryId}`, {
                params
            });

            let booksFetched = [];

            if (response.data && response.data.books) {
                booksFetched = response.data.books;
                if (totalOnServer === undefined) {
                    totalOnServer = response.data.total_num;
                }
            } else if (response.data && typeof response.data === 'object') {
                if (response.data.book_ids && response.data.metadata) {
                    booksFetched = response.data.book_ids.map(id => response.data.metadata[id] || { id });
                    if (totalOnServer === undefined) {
                        totalOnServer = response.data.total_num || response.data.count;
                    }
                } else {
                    const values = Object.values(response.data);
                    booksFetched = values.filter(item => typeof item === 'object' && item !== null && (item.id !== undefined || item.application_id !== undefined));
                    if (totalOnServer === undefined) {
                        totalOnServer = response.data.total_num || response.data.count;
                    }
                }
            }

            if (booksFetched.length === 0) break;

            allBooks = allBooks.concat(booksFetched);
            remaining -= booksFetched.length;
            currentOffset += booksFetched.length;

            // If the server returned fewer books than requested, check if we've reached the end
            if (booksFetched.length < numToFetch) {
                if (totalOnServer !== undefined && allBooks.length + offset >= totalOnServer) {
                    break;
                }
                
                // If it returned 0 books, we've definitely reached the end
                if (booksFetched.length === 0) break;
            }
        }

        return {
            books: allBooks,
            total: totalOnServer
        };
    }

    /**
     * Get detailed metadata for a specific book.
     */
    async getBookMetadata(libraryId, bookId) {
        const response = await this.client.get(`/ajax/book/${bookId}/${libraryId}`);
        return response.data;
    }

    /**
     * Get the formats available for a book.
     */
    async getBookFormats(libraryId, bookId) {
        const metadata = await this.getBookMetadata(libraryId, bookId);
        return metadata.formats;
    }

    /**
     * Download a specific format of a book.
     * Note: This returns a Buffer.
     */
    async downloadBook(libraryId, bookId, format) {
        const url = `/get/${format}/${bookId}/${libraryId}`;
        const response = await this.client.get(url, { responseType: 'arraybuffer' });
        return Buffer.from(response.data);
    }

    /**
     * Get the cover image of a book.
     * Returns a Buffer.
     */
    async getBookCover(libraryId, bookId) {
        const url = `/get/cover/${bookId}/${libraryId}`;
        const response = await this.client.get(url, { responseType: 'arraybuffer' });
        return Buffer.from(response.data);
    }

    /**
     * Get a list of files inside an EPUB book.
     */
    async getEpubContents(libraryId, bookId) {
        const buffer = await this.getEpubBuffer(libraryId, bookId);
        const zip = new AdmZip(buffer);
        return zip.getEntries().map(entry => entry.entryName);
    }

    /**
     * Extract a specific file from an EPUB.
     * Returns the content as a string or Buffer depending on the format.
     */
    async getEpubFile(libraryId, bookId, filePath, responseType = 'text') {
        const buffer = await this.getEpubBuffer(libraryId, bookId);
        const zip = new AdmZip(buffer);
        const entry = zip.getEntry(filePath);
        if (!entry) throw new Error(`File ${filePath} not found in EPUB`);
        
        if (responseType === 'buffer') {
            return entry.getData();
        }
        return zip.readAsText(entry);
    }
    /**
     * Get a Buffer of the entire EPUB file.
     */
    async getEpubBuffer(libraryId, bookId) {
        const formats = await this.getBookFormats(libraryId, bookId);
        const epubFormat = formats.find(f => f.toUpperCase() === 'EPUB');
        if (!epubFormat) throw new Error(`Book ${bookId} does not have an EPUB format`);

        return await this.downloadBook(libraryId, bookId, epubFormat);
    }

    /**
     * Parse Manifest
     */
    _parseManifest(opfXml, opfDir) {
        const manifest = {};
        const itemRegex = /<item\s+[^>]*href\s*=\s*"([^"]+)"[^>]*id\s*=\s*"([^"]+)"|<item\s+[^>]*id\s*=\s*"([^"]+)"[^>]*href\s*=\s*"([^"]+)"/gi;
        let itemMatch;
        while ((itemMatch = itemRegex.exec(opfXml)) !== null) {
            const id = itemMatch[2] || itemMatch[3];
            const href = itemMatch[1] || itemMatch[4];
            // Decode URI components in href (e.g. %20 to space)
            let decodedHref = href;
            try {
                decodedHref = decodeURIComponent(href);
            } catch (e) {
                // Ignore decoding errors
            }
            manifest[id] = this._normalizePath(opfDir + decodedHref);
        }
        return manifest;
    }

    /**
     * Normalize path (remove ./ and handle ../)
     */
    _normalizePath(filePath) {
        // Simple normalization for internal EPUB paths
        const parts = filePath.split('/');
        const stack = [];
        for (const part of parts) {
            if (part === '.' || part === '') continue;
            if (part === '..') {
                if (stack.length > 0) stack.pop();
            } else {
                stack.push(part);
            }
        }
        return stack.join('/');
    }

    /**
     * Build chapters list
     */
    async getChapters(libraryId, bookId) {
        const buffer = await this.getEpubBuffer(libraryId, bookId);
        const zip = new AdmZip(buffer);

        // 1. Find the OPF file
        const containerEntry = zip.getEntry('META-INF/container.xml');
        if (!containerEntry) throw new Error('EPUB missing META-INF/container.xml');
        const containerXml = zip.readAsText(containerEntry);
        const fullPathMatch = containerXml.match(/full-path="([^"]+)"/);
        if (!fullPathMatch) throw new Error('Could not find root file in container.xml');
        const opfPath = fullPathMatch[1];
        const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';

        const opfEntry = zip.getEntry(opfPath);
        if (!opfEntry) throw new Error(`Could not find OPF file at ${opfPath}`);
        const opfXml = zip.readAsText(opfEntry);

        // 2. Parse Manifest
        const manifest = this._parseManifest(opfXml, opfDir);

        // 3. Parse Spine
        const spine = [];
        const itemrefRegex = /<itemref\s+[^>]*idref\s*=\s*"([^"]+)"/gi;
        let itemrefMatch;
        while ((itemrefMatch = itemrefRegex.exec(opfXml)) !== null) {
            const idref = itemrefMatch[1];
            if (manifest[idref]) {
                spine.push(manifest[idref]);
            }
        }

        // 4. Get TOC for titles
        const toc = await this.getTOC(libraryId, bookId);
        const tocMap = {};
        toc.forEach(item => {
            const normalizedPath = this._normalizePath(item.path);
            if (!tocMap[normalizedPath]) {
                tocMap[normalizedPath] = item.title;
            }
        });

        // 5. Build chapters list
        return spine.map(chapterPath => {
            const entry = zip.getEntry(chapterPath);
            return {
                title: tocMap[chapterPath] || 'No heading',
                path: chapterPath,
                size: entry ? entry.header.size : 0
            };
        });
    }

    /**
     * Get the content of a specific chapter as Markdown.
     */
    async getChapterContentMarkdown(libraryId, bookId, chapterPath) {
        const html = await this.getEpubFile(libraryId, bookId, chapterPath);
        return this.htmlToMarkdown(html);
    }

    /**
     * A very simple HTML to Markdown converter.
     */
    htmlToMarkdown(html) {
        if (!html) return '';

        let markdown = html;

        // Extract body content if present
        const bodyMatch = markdown.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
        if (bodyMatch) {
            markdown = bodyMatch[1];
        }

        // Remove head, script, style tags
        markdown = markdown.replace(/<(head|script|style)[^>]*>[\s\S]*?<\/\1>/gi, '');

        // Headers
        markdown = markdown.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '# $1\n\n');
        markdown = markdown.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '## $1\n\n');
        markdown = markdown.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '### $1\n\n');
        markdown = markdown.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '#### $1\n\n');
        markdown = markdown.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, '##### $1\n\n');
        markdown = markdown.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, '###### $1\n\n');

        // Paragraphs and Breaks
        markdown = markdown.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n\n');
        markdown = markdown.replace(/<br\s*\/?>/gi, '\n');

        // Bold / Strong
        markdown = markdown.replace(/<(b|strong)[^>]*>([\s\S]*?)<\/\1>/gi, '**$2**');

        // Italic / Emphasis
        markdown = markdown.replace(/<(i|em)[^>]*>([\s\S]*?)<\/\1>/gi, '*$2*');

        // Lists
        markdown = markdown.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '* $1\n');
        markdown = markdown.replace(/<(ul|ol)[^>]*>([\s\S]*?)<\/\1>/gi, '$2\n');

        // Links
        markdown = markdown.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, '[$2]($1)');

        // Images
        markdown = markdown.replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/gi, '![$2]($1)');
        markdown = markdown.replace(/<img[^>]*alt="([^"]*)"[^>]*src="([^"]*)"[^>]*\/?>/gi, '![$1]($2)');
        markdown = markdown.replace(/<img[^>]*src="([^"]*)"[^>]*\/?>/gi, '![]( $1)');

        // Remove all other tags
        markdown = markdown.replace(/<[^>]+>/g, '');

        // Decode HTML entities
        markdown = markdown.replace(/&nbsp;/g, ' ');
        markdown = markdown.replace(/&amp;/g, '&');
        markdown = markdown.replace(/&lt;/g, '<');
        markdown = markdown.replace(/&gt;/g, '>');
        markdown = markdown.replace(/&quot;/g, '"');
        markdown = markdown.replace(/&#39;/g, "'");
        markdown = markdown.replace(/&apos;/g, "'");

        // Trim whitespace
        markdown = markdown.split('\n').map(line => line.trim()).join('\n');
        markdown = markdown.replace(/\n{3,}/g, '\n\n').trim();

        return markdown;
    }

    /**
     * Search for text in a book.
     * Returns an array of { chapterTitle, chapterPath, offset, snippet, markdownOffset, markdownSnippet } objects.
     */
    async searchText(libraryId, bookId, query, snippetWindow = 100) {
        const buffer = await this.getEpubBuffer(libraryId, bookId);
        const zip = new AdmZip(buffer);
        const chapters = await this.getChapters(libraryId, bookId);
        const results = [];

        for (const chapter of chapters) {
            const entry = zip.getEntry(chapter.path);
            if (!entry) continue;

            const content = zip.readAsText(entry);
            const markdownContent = this.htmlToMarkdown(content);
            
            let index = -1;
            const lowerContent = content.toLowerCase();
            const lowerQuery = query.toLowerCase();

            while ((index = lowerContent.indexOf(lowerQuery, index + 1)) !== -1) {
                const start = Math.max(0, index - snippetWindow);
                const end = Math.min(content.length, index + query.length + snippetWindow);
                const snippet = content.substring(start, end);

                const match = {
                    chapterTitle: chapter.title,
                    chapterPath: chapter.path,
                    offset: index,
                    snippet: snippet
                };

                // Also find the offset in markdown
                const lowerMarkdown = markdownContent.toLowerCase();
                let mdIndex = -1;
                while ((mdIndex = lowerMarkdown.indexOf(lowerQuery, mdIndex + 1)) !== -1) {
                    // We try to match the occurrence number if possible, or just find all.
                    // Actually, simple way is to just find the ONE that is closest to proportionally where it was in HTML?
                    // Or just return all mdIndices?
                    // Better yet, just find the occurrence that corresponds to the one in HTML.
                    
                    // Let's count which occurrence this is in HTML
                    let occurrence = 0;
                    let tempIndex = -1;
                    while ((tempIndex = lowerContent.indexOf(lowerQuery, tempIndex + 1)) !== -1) {
                        occurrence++;
                        if (tempIndex === index) break;
                    }

                    // Now find the same occurrence in Markdown
                    let mdTempIndex = -1;
                    let currentMdOccurrence = 0;
                    while ((mdTempIndex = lowerMarkdown.indexOf(lowerQuery, mdTempIndex + 1)) !== -1) {
                        currentMdOccurrence++;
                        if (currentMdOccurrence === occurrence) {
                            match.markdownOffset = mdTempIndex;
                            const mdStart = Math.max(0, mdTempIndex - snippetWindow);
                            const mdEnd = Math.min(markdownContent.length, mdTempIndex + query.length + snippetWindow);
                            match.markdownSnippet = markdownContent.substring(mdStart, mdEnd);
                            break;
                        }
                    }
                    break; // break the outer while after finding the match
                }

                results.push(match);
            }
        }

        return results;
    }

    /**
     * Renders a specific page of a chapter to a PNG Buffer.
     */
    async renderChapterPage(libraryId, bookId, chapterPath, pageNumber = 1, width = 800, height = 1000) {
        const epubBuffer = await this.getEpubBuffer(libraryId, bookId);
        const zip = new AdmZip(epubBuffer);
        
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'calibre-render-'));
        
        try {
            // Only extract the requested chapter and its immediate dependencies if possible?
            // Actually, EPUBs often have CSS/images in other directories.
            // Extracting all is safer for rendering, but let's ensure we only extract once if possible.
            zip.extractAllTo(tempDir, true);
            
            const htmlPath = path.join(tempDir, chapterPath);
            if (!fs.existsSync(htmlPath)) {
                // Try to find it if path is relative or slightly different
                throw new Error(`Extracted chapter file not found at expected path: ${chapterPath}`);
            }
            
            const browser = await chromium.launch({
                args: ['--disable-web-security'] // Allow loading local files
            });
            try {
                const page = await browser.newPage();
                await page.setViewportSize({ width, height });
                
                // Use a proper file:// URL
                const fileUrl = `file://${path.resolve(htmlPath)}`;
                await page.goto(fileUrl, { waitUntil: 'networkidle' });
                
                const totalPages = await page.evaluate((h) => {
                    return Math.ceil(document.documentElement.scrollHeight / h) || 1;
                }, height);

                if (pageNumber > 1) {
                    await page.evaluate(({ n, h }) => {
                        window.scrollTo(0, (n - 1) * h);
                    }, { n: pageNumber, h: height });
                    
                    // Give it a moment to scroll and render
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
                
                const screenshotBuffer = await page.screenshot({ fullPage: false });
                return {
                    buffer: screenshotBuffer,
                    totalPages: totalPages
                };
            } finally {
                await browser.close();
            }
        } finally {
            try {
                if (fs.existsSync(tempDir)) {
                    fs.rmSync(tempDir, { recursive: true, force: true });
                }
            } catch (err) {
                console.error(`Failed to clean up temp directory ${tempDir}: ${err.message}`);
            }
        }
    }

    /**
     * Get the Table of Contents (TOC) from an EPUB.
     * Returns an array of { title, path } objects.
     */
    async getTOC(libraryId, bookId) {
        const buffer = await this.getEpubBuffer(libraryId, bookId);
        const zip = new AdmZip(buffer);
        const entries = zip.getEntries();

        // 1. Find the OPF file to find the TOC file
        const containerEntry = zip.getEntry('META-INF/container.xml');
        if (!containerEntry) throw new Error('EPUB missing META-INF/container.xml');
        const containerXml = zip.readAsText(containerEntry);
        const fullPathMatch = containerXml.match(/full-path="([^"]+)"/);
        if (!fullPathMatch) throw new Error('Could not find root file in container.xml');
        const opfPath = fullPathMatch[1];
        const opfDir = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';

        const opfEntry = zip.getEntry(opfPath);
        if (!opfEntry) throw new Error(`Could not find OPF file at ${opfPath}`);
        const opfXml = zip.readAsText(opfEntry);

        // Try to find TOC in NCX (EPUB 2) or Nav (EPUB 3)
        // Check for NCX first
        const ncxMatch = opfXml.match(/id="([^"]+)"[^>]+media-type="application\/x-dtbncx\+xml"/i) || 
                         opfXml.match(/media-type="application\/x-dtbncx\+xml"[^>]+id="([^"]+)"/i);
        
        let toc = [];

        if (ncxMatch) {
            const ncxId = ncxMatch[1];
            const ncxHrefMatch = opfXml.match(new RegExp(`id="${ncxId}"[^>]+href="([^"]+)"`)) ||
                                 opfXml.match(new RegExp(`href="([^"]+)"[^>]+id="${ncxId}"`));
            if (ncxHrefMatch) {
                const ncxPath = opfDir + ncxHrefMatch[1];
                const ncxEntry = zip.getEntry(ncxPath);
                if (ncxEntry) {
                    const ncxXml = zip.readAsText(ncxEntry);
                    // Very basic NCX parsing using regex
                    const navPointRegex = /<navPoint[^>]*>[\s\S]*?<navLabel>[\s\S]*?<text>([\s\S]*?)<\/text>[\s\S]*?<\/navLabel>[\s\S]*?<content src="([^"]+)"/g;
                    let match;
                    while ((match = navPointRegex.exec(ncxXml)) !== null) {
                        let label = match[1].trim();
                        let href = match[2];
                        // remove anchors
                        if (href.includes('#')) href = href.split('#')[0];
                        
                        const fullPath = this._normalizePath(opfDir + href);
                        // Avoid duplicates if multiple navPoints point to same file, but keep first (usually better label)
                        if (!toc.find(t => t.path === fullPath)) {
                            toc.push({
                                title: label,
                                path: fullPath
                            });
                        }
                    }
                }
            }
        }

        // If no TOC found yet, try EPUB 3 Nav
        if (toc.length === 0) {
            const navMatch = opfXml.match(/properties="[^"]*nav[^"]*"[^>]+href="([^"]+)"/i) ||
                             opfXml.match(/href="([^"]+)"[^>]+properties="[^"]*nav[^"]*"/i);
            if (navMatch) {
                const navPath = this._normalizePath(opfDir + navMatch[1]);
                const navEntry = zip.getEntry(navPath);
                if (navEntry) {
                    const navXml = zip.readAsText(navEntry);
                    // Very basic Nav parsing
                    const linkRegex = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
                    let match;
                    while ((match = linkRegex.exec(navXml)) !== null) {
                        let href = match[1];
                        if (href.includes('#')) href = href.split('#')[0];
                        const fullPath = this._normalizePath(opfDir + href);
                        const label = match[2].replace(/<[^>]+>/g, '').trim();
                        if (!toc.find(t => t.path === fullPath)) {
                            toc.push({
                                title: label,
                                path: fullPath
                            });
                        }
                    }
                }
            }
        }

        return toc;
    }
}

module.exports = CalibreClient;
