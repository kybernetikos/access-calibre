const CalibreClient = require('../index');

async function main() {
    const args = process.argv.slice(2);
    if (args.length < 2) {
        console.log('Usage: node get-chapter.js <book_id_or_title_fragment> <chapter_number_or_title>');
        console.log('Example: node get-chapter.js "Orbit" 10');
        console.log('Example: node get-chapter.js 1 "Chapter 1"');
        return;
    }

    const chapterQuery = args.pop();
    const bookQuery = args.join(' ');
    const serverUrl = 'http://[::1]:8080/';

    const client = new CalibreClient(serverUrl);

    try {
        const libraries = await client.getLibraries();
        const libraryIds = Object.keys(libraries);

        let foundBooks = [];

        for (const libraryId of libraryIds) {
            const books = await client.getBooks(libraryId);
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
            console.log(`No books found matching "${bookQuery}".`);
            return;
        }

        if (foundBooks.length > 1) {
            console.log(`Found ${foundBooks.length} books matching "${bookQuery}":`);
            foundBooks.forEach((book, index) => {
                const authors = Array.isArray(book.authors) ? book.authors.join(', ') : book.authors;
                const id = book.id || book.application_id;
                console.log(`${index + 1}. ${book.title} (by ${authors}) [ID: ${id}] in ${book.libraryName}`);
            });
            console.log('\nPlease be more specific or use the Book ID.');
            return;
        }

        const book = foundBooks[0];
        const bookId = book.id || book.application_id;
        
        const chapters = await client.getChapters(book.libraryId, bookId);
        
        let targetChapter = null;

        // Try to parse chapterQuery as a number (1-based index)
        const chapterIndex = parseInt(chapterQuery, 10);
        if (!isNaN(chapterIndex) && chapterIndex > 0 && chapterIndex <= chapters.length) {
            targetChapter = chapters[chapterIndex - 1];
        } else {
            // Try to match by title or path
            targetChapter = chapters.find(c => 
                c.title.toLowerCase().includes(chapterQuery.toLowerCase()) || 
                c.path.toLowerCase().includes(chapterQuery.toLowerCase())
            );
        }

        if (!targetChapter) {
            console.log(`Could not find chapter matching "${chapterQuery}".`);
            console.log(`Available chapters:`);
            chapters.forEach((c, i) => console.log(`${i + 1}. [${c.title}] ${c.path}`));
            return;
        }

        console.log(`\nExtracting chapter: [${targetChapter.title}] ${targetChapter.path}...`);
        const content = await client.getEpubFile(book.libraryId, bookId, targetChapter.path);
        
        console.log('--- CHAPTER CONTENT START ---');
        console.log(content);
        console.log('--- CHAPTER CONTENT END ---');

    } catch (error) {
        console.error('Error:');
        if (error.response) {
            console.error(`Status: ${error.response.status}`);
            console.error('Data:', error.response.data);
        } else {
            console.error(error.message);
        }
    }
}

main();
