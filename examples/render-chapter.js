const CalibreClient = require('../index');
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

async function main() {
    const args = process.argv.slice(2);
    if (args.length < 2) {
        console.log('Usage: node render-chapter.js <book_id_or_title_fragment> <chapter_number_or_title> [output_file] [--page <number>]');
        console.log('Example: node render-chapter.js "Orbit" 10');
        console.log('Example: node render-chapter.js 1 "Chapter 1" chapter.png --page 2');
        return;
    }

    let pageNumber = 1;
    const pageIdx = args.indexOf('--page');
    if (pageIdx !== -1 && args.length > pageIdx + 1) {
        pageNumber = parseInt(args[pageIdx + 1], 10);
        args.splice(pageIdx, 2);
    }

    const outputFile = args.length > 2 ? args.pop() : 'chapter_render.png';
    const chapterQuery = args.pop();
    const bookQuery = args.join(' ');
    const serverUrl = 'http://[::1]:8080/';

    const client = new CalibreClient(serverUrl);

    try {
        const libraries = await client.getLibraries();
        const libraryIds = Object.keys(libraries);

        if (libraryIds.length === 0) {
            throw new Error(`No libraries found on the Calibre server at ${serverUrl}. Is it running?`);
        }

        let foundBooks = [];

        for (const libraryId of libraryIds) {
            let books;
            try {
                books = await client.getBooks(libraryId);
            } catch (err) {
                console.warn(`Warning: Could not fetch books from library "${libraries[libraryId]}" (${libraryId}): ${err.message}`);
                continue;
            }
            if (!books || !Array.isArray(books)) continue;

            for (const book of books) {
                const id = String(book.id || book.application_id);
                const title = book.title || '';
                
                if (id === bookQuery || title.toLowerCase().includes(bookQuery.toLowerCase())) {
                    foundBooks.push({ ...book, libraryId, libraryName: libraries[libraryId] });
                }
            }
        }

        if (foundBooks.length === 0) {
            throw new Error(`No books found matching "${bookQuery}". Use 'node list-books.js' to see available books.`);
        }

        if (foundBooks.length > 1) {
            console.log(`Found ${foundBooks.length} books matching "${bookQuery}":`);
            foundBooks.forEach((book, index) => {
                const authors = Array.isArray(book.authors) ? book.authors.join(', ') : book.authors;
                const id = book.id || book.application_id;
                console.log(`${index + 1}. ${book.title} (by ${authors}) [ID: ${id}] in ${book.libraryName}`);
            });
            throw new Error('Multiple books found. Please be more specific or use the Book ID.');
        }

        const book = foundBooks[0];
        const bookId = book.id || book.application_id;
        
        let chapters;
        try {
            chapters = await client.getChapters(book.libraryId, bookId);
        } catch (err) {
            throw new Error(`Failed to get chapters for book "${book.title}": ${err.message}`);
        }
        
        let targetChapter = null;
        const chapterIndex = parseInt(chapterQuery, 10);
        if (!isNaN(chapterIndex) && chapterIndex > 0 && chapterIndex <= chapters.length) {
            targetChapter = chapters[chapterIndex - 1];
        } else {
            targetChapter = chapters.find(c => 
                c.title.toLowerCase().includes(chapterQuery.toLowerCase()) || 
                c.path.toLowerCase().includes(chapterQuery.toLowerCase())
            );
        }

        if (!targetChapter) {
            console.log(`Available chapters for "${book.title}":`);
            chapters.forEach((c, i) => console.log(`${i + 1}. ${c.title}`));
            throw new Error(`Could not find chapter matching "${chapterQuery}".`);
        }

        console.log(`Extracting chapter: [${targetChapter.title}] ${targetChapter.path}...`);
        
        const { buffer, totalPages } = await client.renderChapterPage(
            book.libraryId, 
            bookId, 
            targetChapter.path, 
            pageNumber
        );

        fs.writeFileSync(outputFile, buffer);
        console.log(`Rendered page ${pageNumber} of ${totalPages} saved to ${outputFile}`);

    } catch (error) {
        console.error('\nERROR:', error.message);
        process.exit(1);
    }
}

main();
