const cors = require('cors');
const express = require('express');
const config = require('./config');
require('dotenv').config();

const app = express();
const port = config.settings.portNumber;

const { getLastTimestamp, saveLastTimestamp } = require('./utilities');
const { processEmails } = require('./processEmails');
const { processOldEmails } = require('./processOldEmails');


async function main() {
    if (config.settings.runAsServerOrScript === 'server') {
        try {

            app.use(cors());
            app.use(express.json());
            app.use(express.urlencoded({extended: true}));

            app.get('/process-emails', async (req, res) => {
                try {
                    const timestamp = (req.query.timestamp) ? req.query.timestamp : await getLastTimestamp(config.settings.timestampFilePath);
                    const results = await processEmails(timestamp);

                    res.status(results.statusCode).send(results.message);
                } catch (error) {
                    console.error('Failed to process emails:', error);
                    res.status(500).send('Internal Server Error');
                }
            });

            app.get('/process-old-emails', async (req, res) => {
                try {
                    const results = await processOldEmails();
                    res.status(results.statusCode).json({
                        message: results.message,
                        processed: results.processed,
                        categorized: results.categorized,
                        deleted: results.deleted
                    });
                } catch (error) {
                    console.error('Failed to process old emails:', error);
                    res.status(500).send('Internal Server Error');
                }
            });

            app.listen(port, () => {
                console.log(`Server running at http://localhost:${port}`);
            });

        } catch (e) {
            console.error('Failed to start the server due to configuration error:', e);
        }
    } else {
        // Script mode - alternating between new and old emails
        const refreshIntervalMilliseconds = config.settings.refreshInterval * 1000; // Convert seconds to milliseconds
        let isProcessing = false; // Flag to prevent concurrent processing
        let shouldProcessOldEmails = false; // Flag to indicate if we should process old emails next

        const runProcessNewEmails = async () => {
            if (isProcessing) {
                return; // Skip if already processing
            }
            
            try {
                isProcessing = true;
                const timestamp = await getLastTimestamp(config.settings.timestampFilePath);
                const results = await processEmails(timestamp);
                
                // Check if any new emails were actually processed
                const hasNewEmails = results && results.processedCount > 0;
                
                if (hasNewEmails) {
                    // If new emails were found, immediately check for new emails again
                    console.log(`Processed ${results.processedCount} new email(s). Checking for more new emails...`);
                    shouldProcessOldEmails = false; // Don't process old emails yet
                    setTimeout(runProcessNewEmails, 1000); // Check again soon
                } else {
                    // No new emails found, process old emails now
                    console.log('No new emails found. Processing old emails now...');
                    // Process old emails immediately, then check for new emails again
                    if (config.settings.processOldEmails) {
                        // Call old email processing directly (don't wait, process immediately after isProcessing is reset)
                        setTimeout(() => {
                            runProcessOldEmails(true); // Pass true to indicate direct call (skip flag check)
                        }, 1000); // Small delay to ensure new email processing is fully done
                    } else {
                        // If old email processing is disabled, just check for new emails again after interval
                        setTimeout(runProcessNewEmails, refreshIntervalMilliseconds);
                    }
                }
            } catch (error) {
                console.error('Failed to process emails:', error);
                // On error, still check for new emails after interval
                setTimeout(runProcessNewEmails, refreshIntervalMilliseconds);
            } finally {
                isProcessing = false;
            }
        };

        const runProcessOldEmails = async (directCall = false) => {
            // If called directly, wait for isProcessing to be false if it's still true
            if (isProcessing) {
                setTimeout(() => runProcessOldEmails(directCall), 500);
                return;
            }
            
            // If not a direct call, check the flag
            if (!directCall && !shouldProcessOldEmails) {
                return; // Skip if not needed
            }
            
            try {
                isProcessing = true;
                shouldProcessOldEmails = false; // Reset flag
                
                console.log('Server is free. Processing old emails...');
                const results = await processOldEmails();
                
                if (results && results.processed > 0) {
                    console.log(`Processed ${results.processed} old emails. Returning to check new emails...`);
                } else {
                    console.log('No old emails to process. Returning to check new emails...');
                }
                
                // After processing old emails, check for new emails
                setTimeout(runProcessNewEmails, 1000);
            } catch (error) {
                console.error('Failed to process old emails:', error);
                // On error, return to checking new emails
                setTimeout(runProcessNewEmails, refreshIntervalMilliseconds);
            } finally {
                isProcessing = false;
            }
        };

        // Start by checking for new emails immediately
        console.log('Starting email processing cycle: New emails → Old emails → New emails...');
        runProcessNewEmails();
    }
}

main();