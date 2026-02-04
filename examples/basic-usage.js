const CalibreClient = require('access-calibre');

async function main() {
    const client = new CalibreClient('http://localhost:8080');

    try {
        console.log('Connecting to Calibre...');
        const libraries = await client.getLibraries();
        const libraryIds = Object.keys(libraries);
        console.log('Available libraries:', libraryIds);

        if (libraryIds.length > 0) {
            const libraryId = libraryIds[0];
            console.log(`Fetching books from ${libraryId}...`);
            const books = await client.getBooks(libraryId, 5);
            
            for (const bookId of books.book_ids) {
                const meta = books.metadata[bookId];
                console.log(`- ${meta.title} by ${meta.authors}`);
                
                if (meta.formats.includes('EPUB')) {
                    console.log(`  Getting contents of EPUB for book ${bookId}...`);
                    const contents = await client.getEpubContents(libraryId, bookId);
                    console.log(`  First 3 files in EPUB:`, contents.slice(0, 3));
                    
                    // Example of grabbing a specific portion (if you knew the filename)
                    // const text = await client.getEpubFile(libraryId, bookId, 'index_split_000.html');
                    // console.log(text.substring(0, 100));
                }
            }
        }
    } catch (error) {
        console.error('Error:', error.message);
        console.log('Note: This example expects a running Calibre Content Server at http://localhost:8080');
    }
}

main();
