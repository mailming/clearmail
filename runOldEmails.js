// Standalone script to process old emails
const config = require('./config');
require('dotenv').config();
const { processOldEmails } = require('./processOldEmails');

async function main() {
    console.log('Starting old email processing...');
    console.log(`Processing ALL emails (no date limit)`);
    console.log(`Will delete emails older than ${config.settings.deleteEmailsOlderThanDays || 365} days that are NOT worth reading\n`);
    
    try {
        const results = await processOldEmails();
        console.log('\n=== Summary ===');
        console.log(`Processed: ${results.processed || 0} emails`);
        console.log(`Categorized: ${results.categorized || 0} emails`);
        console.log(`Deleted: ${results.deleted || 0} emails`);
        process.exit(0);
    } catch (error) {
        console.error('Error processing old emails:', error);
        process.exit(1);
    }
}

main();

