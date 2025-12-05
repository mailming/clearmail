const Imap = require("imap");
const fs = require('fs');
const config = require("./config");
const {simpleParser} = require("mailparser");
const {analyzeEmail} = require("./analyzeEmail");
const {isBusinessEmail} = require("./utilities");

async function processOldEmails(retryCount = 0) {
    const maxRetries = 3;
    const retryDelay = Math.min(1000 * Math.pow(2, retryCount), 10000); // Exponential backoff, max 10 seconds
    const PROCESSING_TIMEOUT = 30 * 60 * 1000; // 30 minutes timeout to prevent hanging

    return new Promise(async (resolve, reject) => {
        // Process ALL emails (no date limit)
        let imapRef = null; // Will hold reference to imap for timeout handler
        const deleteThresholdDate = new Date();
        deleteThresholdDate.setDate(deleteThresholdDate.getDate() - (config.settings.deleteEmailsOlderThanDays || 365));

        console.log(`\n\n[${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}]`);
        console.log(`*** Processing ALL old emails (no date limit).`);
        console.log(`*** Will delete emails older than ${config.settings.deleteEmailsOlderThanDays} days that are NOT worth reading.`);
        if (retryCount > 0) {
            console.log(`*** Retry attempt ${retryCount}/${maxRetries}`);
        }

        // Initialize IMAP with TLS configuration
        const imapConfig = {
            user: process.env.IMAP_USER,
            password: process.env.IMAP_PASSWORD,
            host: process.env.IMAP_HOST || 'imap.gmail.com',
            port: parseInt(process.env.IMAP_PORT) || 993,
            tls: true,
            tlsOptions: {
                rejectUnauthorized: false
            },
            connTimeout: 60000, // 60 seconds connection timeout
            authTimeout: 60000  // 60 seconds authentication timeout
        };

        const imap = new Imap(imapConfig);
        imapRef = imap; // Store reference for timeout handler
        
        // Set a timeout to ensure the promise always resolves, even if processing gets stuck
        const timeoutId = setTimeout(() => {
            console.error('*** WARNING: Old email processing timed out after 30 minutes. Forcing completion...');
            try {
                if (imapRef && imapRef.state !== 'closed') {
                    imapRef.end();
                }
            } catch (err) {
                console.error('Error closing IMAP connection on timeout:', err);
            }
            // Use original resolve to avoid clearing timeout (already timed out)
            resolve({statusCode: 200, message: 'Old email processing timed out.', processed: 0, categorized: 0, deleted: 0});
        }, PROCESSING_TIMEOUT);
        
        // Wrap resolve/reject to clear timeout
        const originalResolve = resolve;
        const originalReject = reject;
        resolve = (...args) => {
            clearTimeout(timeoutId);
            originalResolve(...args);
        };
        reject = (...args) => {
            clearTimeout(timeoutId);
            originalReject(...args);
        };

        function searchAndProcessEmails(mailboxName, searchCriteria, callback) {
            try {
                // Open in read-write mode (true) to allow deletions
                imap.openBox(mailboxName, true, function(err, box) {
                    if (err) {
                        console.log(`Could not open ${mailboxName}, skipping...`);
                        callback(null, []);
                        return;
                    }

                    try {
                        imap.search(searchCriteria, function(err, results) {
                            if (err) {
                                console.log(`Error searching ${mailboxName}:`, err);
                                callback(null, []);
                                return;
                            }
                            callback(results, mailboxName);
                        });
                    } catch (searchErr) {
                        console.error(`Exception during search in ${mailboxName}:`, searchErr);
                        callback(null, []);
                    }
                });
            } catch (openErr) {
                console.error(`Exception opening ${mailboxName}:`, openErr);
                callback(null, []);
            }
        }

        imap.once('ready', async function () {
            console.log(`Searching for unprocessed emails in INBOX...`);
            
            // IMPORTANT: Search INBOX first, NOT All Mail, because All Mail includes Records folder emails
            // We want to process emails that haven't been processed yet (not starred, not in Records)
            // Priority: INBOX emails that haven't been processed > category folder emails
            // Never search in All Mail or Records folder
            
            let searchResults = [];
            
            // First, search INBOX for unprocessed emails (not starred, not in Records)
            console.log(`Searching INBOX for unprocessed emails (excluding starred and Records)...`);
            
            // Search criteria: ALL emails in INBOX (we'll filter out starred emails during processing)
            // The IMAP library doesn't support ['NOT', 'FLAGGED'], so we search all and filter during processing
            // We'll check Records label and flagged status during processing to skip those emails
            searchAndProcessEmails('INBOX', ['ALL'], function(results, mailboxName) {
                if (results && results.length > 0) {
                    console.log(`Found ${results.length} unprocessed emails in INBOX`);
                    searchResults = results;
                    // Process INBOX emails first
                    processSearchResults(searchResults, mailboxName);
                } else {
                    console.log(`No unprocessed emails in INBOX. Checking category folders...`);
                    // If no emails in INBOX, try category folders (excluding Records)
                    if (config.settings.sortIntoCategoryFolders) {
                        searchCategoryFolders();
                    } else {
                        console.log('No emails found to process.');
                        imap.end();
                        resolve({statusCode: 200, message: 'No old emails to process.', processed: 0, categorized: 0, deleted: 0});
                    }
                }
            });

            function searchCategoryFolders() {
                console.log('Searching category folders...');
                const categoryFolders = (config.categoryFolderNames || []).filter(folder => 
                    folder !== 'Records' // Exclude Records folder from category search
                );
                let folderIndex = 0;
                
                function tryNextCategoryFolder() {
                    if (folderIndex >= categoryFolders.length) {
                        if (searchResults.length === 0) {
                            console.log('No emails found in any folder.');
                            imap.end();
                            resolve({statusCode: 200, message: 'No old emails to process.', processed: 0, categorized: 0, deleted: 0});
                        } else {
                            processSearchResults(searchResults);
                        }
                        return;
                    }

                    const folderName = categoryFolders[folderIndex];
                    // Search ALL emails in category folders too
                    searchAndProcessEmails(folderName, ['ALL'], function(results, mailboxName) {
                        if (results && results.length > 0) {
                            console.log(`Found ${results.length} emails in ${mailboxName}`);
                            searchResults = results;
                            processSearchResults(searchResults, mailboxName);
                        } else {
                            folderIndex++;
                            tryNextCategoryFolder();
                        }
                    });
                }
                
                tryNextCategoryFolder();
            }

            function processSearchResults(results, mailboxName = 'INBOX') {
                if (!results || results.length === 0) {
                    console.log('No emails found to process.');
                    imap.end();
                    resolve({statusCode: 200, message: 'No old emails to process.', processed: 0, categorized: 0, deleted: 0});
                    return;
                }

                // Skip processing if mailbox is Records - emails already in Records don't need processing
                if (mailboxName === 'Records' || mailboxName === '[Gmail]/Records' || mailboxName === '[Google Mail]/Records') {
                    console.log(`Skipping ${mailboxName} - emails already in Records folder don't need processing.`);
                    imap.end();
                    resolve({statusCode: 200, message: 'Skipped Records folder.', processed: 0, categorized: 0, deleted: 0});
                    return;
                }

                // Reverse the results array to process newest emails first (IMAP returns UIDs in ascending order)
                // Higher UIDs = newer emails, so reversing gives us newest-to-oldest order
                results = results.reverse();
                
                console.log(`Processing ${results.length} emails from ${mailboxName} (newest to oldest)...`);
                
                // Re-open mailbox in read-write mode (true) to allow deletions
                imap.openBox(mailboxName, true, function(err, box) {
                    if (err) {
                        console.error(`Error opening ${mailboxName} in read-write mode:`, err);
                        imap.end();
                        resolve({statusCode: 500, message: 'Error opening mailbox for deletion.'});
                        return;
                    }

                    // Check if mailbox is read-only (category folders are often read-only)
                    const isReadOnly = box.readOnly || false;
                    const canStarEmails = !isReadOnly && mailboxName === 'INBOX';

                    const fetchOptions = {
                        bodies: '',
                        struct: true,
                        markSeen: false
                    };

                // Process emails ONE at a time sequentially
                let processedCount = 0;
                let categorizedCount = 0;
                let deletedCount = 0;
                let currentIndex = 0;

                async function processEmailSequentially() {
                    if (currentIndex >= results.length) {
                        // All emails processed
                        finishProcessing();
                        return;
                    }

                    const uid = results[currentIndex];
                    currentIndex++;
                    processedCount++;

                    try {
                        // Skip if email is already in Records folder (check mailbox name)
                        if (mailboxName === 'Records' || mailboxName === '[Gmail]/Records' || mailboxName === '[Google Mail]/Records') {
                            // Skip this email and process next with delay
                            setTimeout(() => processEmailSequentially(), 100);
                            return;
                        }

                        // Note: When searching in All Mail, it includes emails from all folders including Records.
                        // We can't easily check if an email is in Records without expensive operations,
                        // but we've excluded Records folder from direct searches, so most Records emails won't be processed.
                        fetchAndProcessEmail(uid);
                    } catch (err) {
                        console.error('Error in processEmailSequentially:', err);
                        processEmailSequentially(); // Continue with next email
                    }
                }

                function fetchAndProcessEmail(uid) {
                    try {
                        // Fetch single email
                        const f = imap.fetch(uid, {
                            bodies: '',
                            struct: true,
                            markSeen: false
                        });

                        f.on('message', function (msg, seqno) {
                            const attributesPromise = new Promise((resolve) => msg.once('attributes', resolve));

                            msg.on('body', async function (stream, info) {
                                try {
                                    const email = await simpleParser(stream);
                                    const attributes = await attributesPromise;
                                    
                                    // Check if email is already in Records folder using Gmail labels
                                    // Gmail IMAP provides X-GM-LABELS extension
                                    const gmailLabels = attributes['x-gm-labels'] || attributes['X-GM-LABELS'] || [];
                                    const labelsArray = Array.isArray(gmailLabels) ? gmailLabels : (gmailLabels ? [gmailLabels] : []);
                                    const isInRecords = labelsArray.some(label => {
                                        const labelStr = String(label).toLowerCase();
                                        return labelStr === 'records';
                                    });
                                    
                                    if (isInRecords) {
                                        console.log(`*** Skipping email already in Records: ${email.subject || '(no subject)'}`);
                                        // Process next email with delay to avoid throttling
                                        setTimeout(() => processEmailSequentially(), 100);
                                        return;
                                    }
                                    
                                    const emailDate = email.date || new Date(attributes.date);
                                    const emailAge = Math.floor((new Date() - emailDate) / (1000 * 60 * 60 * 24)); // Age in days

                                    // Check if email is in INBOX by checking labels or mailbox name
                                    const isInInbox = mailboxName === 'INBOX' || 
                                        (labelsArray.some(label => {
                                            const labelStr = String(label).toLowerCase();
                                            return labelStr === 'inbox' || labelStr === '\\inbox';
                                        }));

                                    // Only process if not already starred (important emails)
                                    if (!attributes.flags.includes('\\Flagged')) {
                                        const emailBody = (email?.text) ? email.text : email.html;
                                        
                                        // Check if this is a business email (eBay/Craigslist/computer queries with gamepla)
                                        // If so, automatically move to Records without AI analysis
                                        if (isBusinessEmail(email.from.text, email.subject, emailBody || '')) {
                                            const recordsFolder = 'Records';
                                            console.log(`*** BUSINESS EMAIL DETECTED: ${email.subject} - Auto-moving to Records`);
                                            
                                            // Move email to Records folder
                                            await new Promise((resolve) => {
                                                imap.move(attributes.uid, recordsFolder, function (err) {
                                                    if (err) {
                                                        console.log(`Error moving email to ${recordsFolder}:`, err);
                                                        resolve();
                                                    } else {
                                                        console.log(`MOVED TO RECORDS: ${email.subject} (business email)`);
                                                        resolve();
                                                    }
                                                });
                                            });
                                            
                                            // Process next email with delay to avoid throttling
                                            setTimeout(() => processEmailSequentially(), 100);
                                            return;
                                        }
                                        
                                        const emailAnalysis = await analyzeEmail(
                                            email.subject, 
                                            email.from.text, 
                                            emailBody ? emailBody.substring(0, config.settings.maxEmailChars) : '', 
                                            emailDate
                                        );

                                        if (emailAnalysis.judgment !== 'unknown') {
                                            // If email is worth reading (judgment === true)
                                            if (emailAnalysis.judgment === true) {
                                                // If email is in INBOX, less than 30 days old, and worth reading: star it and keep in inbox
                                                if (isInInbox && emailAge < 30) {
                                                    // Only try to star if mailbox is writable and we're in INBOX
                                                    if (config.settings.starAllKeptEmails && canStarEmails) {
                                                        imap.addFlags(attributes.uid, ['\\Flagged'], function (err) {
                                                            if (err && err.textCode !== 'THROTTLED') {
                                                                // Only log non-throttling errors (throttling is expected)
                                                                if (!err.message || !err.message.includes('READ-ONLY')) {
                                                                    console.log('Error starring email:', err.message || err);
                                                                }
                                                            }
                                                        });
                                                    }
                                                    console.log(`Email kept in inbox (starred if enabled) (${emailAge} days old, worth reading).`);
                                                } else {
                                                    // Email is 30 days or older OR not in INBOX, move to Records category (worth reading emails)
                                                    const recordsFolder = 'Records';
                                                    
                                                    // Move email to Records folder first, then star it in the new location
                                                    await new Promise((resolve) => {
                                                        imap.move(attributes.uid, recordsFolder, function (err) {
                                                            if (err) {
                                                                console.log(`Error moving email to ${recordsFolder}:`, err);
                                                                resolve();
                                                            } else {
                                                                console.log(`MOVED TO RECORDS: ${email.subject} (worth reading${emailAge >= 30 ? `, ${emailAge} days old` : ''})`);
                                                                
                                                                // After moving, star the email in the Records folder
                                                                // Note: We can't star in the original folder since it's read-only
                                                                // The email will be starred in Records folder if needed
                                                                // For now, we'll skip starring since it's already moved to Records
                                                                if (config.settings.starAllKeptEmails) {
                                                                    // The email is now in Records, we could try to star it there
                                                                    // but that would require opening Records folder, which is complex
                                                                    // So we'll just move it and skip starring for old emails
                                                                }
                                                                resolve();
                                                            }
                                                        });
                                                    });
                                                }
                                            } else {
                                                // Email is NOT worth reading (judgment === false)
                                                const folderToMoveTo = (config.settings.sortIntoCategoryFolders) 
                                                    ? emailAnalysis.category 
                                                    : config.settings.rejectedFolderName;

                                                // Delete if email is older than 1 year AND not worth reading
                                                const shouldDelete = emailDate < deleteThresholdDate;

                                                if (shouldDelete) {
                                                    // Delete the email - move to Trash (Gmail will auto-delete after 30 days)
                                                    // For immediate deletion, we'll mark as deleted in current folder
                                                    await new Promise((resolve) => {
                                                        // Try to move to Trash first
                                                        const trashFolder = '[Gmail]/Trash';
                                                        imap.move(attributes.uid, trashFolder, function (moveErr) {
                                                            if (moveErr) {
                                                                // Try alternative trash folder name
                                                                const altTrash = '[Google Mail]/Trash';
                                                                imap.move(attributes.uid, altTrash, function (altErr) {
                                                                    if (altErr) {
                                                                        // If move fails, try direct deletion in current folder
                                                                        console.log(`Cannot move to Trash, trying direct deletion in current folder...`);
                                                                        imap.addFlags(attributes.uid, ['\\Deleted'], function (delErr) {
                                                                            if (delErr) {
                                                                                console.log(`Error marking for deletion:`, delErr);
                                                                                resolve();
                                                                            } else {
                                                                                // Expunge immediately
                                                                                imap.expunge();
                                                                                console.log(`✓ DELETED (direct): ${email.subject} (${emailAge} days old)`);
                                                                                deletedCount++;
                                                                                resolve();
                                                                            }
                                                                        });
                                                                    } else {
                                                                        console.log(`✓ MOVED TO TRASH: ${email.subject} (${emailAge} days old)`);
                                                                        deletedCount++;
                                                                        resolve();
                                                                    }
                                                                });
                                                            } else {
                                                                console.log(`✓ MOVED TO TRASH: ${email.subject} (${emailAge} days old)`);
                                                                deletedCount++;
                                                                resolve();
                                                            }
                                                        });
                                                    });
                                                } else {
                                                    // Move to category folder (only for emails not worth reading)
                                                    if (folderToMoveTo) {
                                                        await new Promise((resolve) => {
                                                            imap.move(attributes.uid, folderToMoveTo, function (err) {
                                                                if (err) {
                                                                    // Handle missing folder gracefully
                                                                    if (err.textCode === 'TRYCREATE') {
                                                                        console.log(`Warning: Folder "${folderToMoveTo}" does not exist. Please create it in Gmail as a label.`);
                                                                    } else if (err.textCode === 'THROTTLED') {
                                                                        console.log(`Gmail rate limit hit. Email "${email.subject}" will be processed later.`);
                                                                    } else {
                                                                        console.log(`Error moving email to ${folderToMoveTo}:`, err.message || err);
                                                                    }
                                                                } else {
                                                                    console.log(`Categorized: ${email.subject} → ${folderToMoveTo}`);
                                                                    categorizedCount++;
                                                                }
                                                                resolve();
                                                            });
                                                        });
                                                    }
                                                }
                                            }
                                        }
                                    }
                                } catch (err) {
                                    console.error('Error processing email:', err);
                                    // Ensure we continue even on error
                                }
                                
                                // Process next email with a small delay to avoid Gmail throttling
                                // Delay of 100ms between emails to stay under rate limits
                                setTimeout(() => processEmailSequentially(), 100);
                            });
                        });

                        f.once('error', function(err) {
                            console.error('Error fetching email:', err);
                            // Continue with next email with delay to avoid throttling
                            setTimeout(() => processEmailSequentially(), 100);
                        });

                    } catch (err) {
                        console.error('Error in processEmailSequentially:', err);
                        // Continue with next email with delay to avoid throttling
                        setTimeout(() => processEmailSequentially(), 100);
                    }
                }

                function finishProcessing() {
                    try {
                        // Expunge deleted emails
                        imap.expunge(function (err) {
                            if (err) {
                                console.log('Error expunging deleted emails:', err);
                            }
                            console.log(`\n*** Finished processing old emails:`);
                            console.log(`  - Processed: ${processedCount} emails`);
                            console.log(`  - Categorized: ${categorizedCount} emails`);
                            console.log(`  - Deleted: ${deletedCount} emails`);
                            
                            // Close IMAP connection and resolve promise
                            try {
                                imap.end();
                            } catch (endErr) {
                                console.error('Error closing IMAP connection:', endErr);
                            }
                            
                            console.log('*** Old email processing completed. Returning to new email check...');
                            resolve({statusCode: 200, message: 'Old email processing completed.', processed: processedCount, categorized: categorizedCount, deleted: deletedCount});
                        });
                    } catch (err) {
                        console.error('Error in finishProcessing:', err);
                        // Ensure we still resolve the promise even on error
                        try {
                            imap.end();
                        } catch (endErr) {
                            console.error('Error closing IMAP connection:', endErr);
                        }
                        resolve({statusCode: 200, message: 'Old email processing completed with errors.', processed: processedCount, categorized: categorizedCount, deleted: deletedCount});
                    }
                }

                // Start processing emails one at a time
                processEmailSequentially();
                }); // Close openBox callback
            }
        });

        imap.once('error', function(err) {
            console.error('IMAP connection error:', err.message);
            
            // Check if it's a timeout error and we haven't exceeded max retries
            if ((err.source === 'timeout-auth' || err.source === 'timeout') && retryCount < maxRetries) {
                console.log(`Connection timeout. Retrying in ${retryDelay/1000} seconds...`);
                imap.end();
                
                setTimeout(() => {
                    processOldEmails(retryCount + 1)
                        .then(resolve)
                        .catch(reject);
                }, retryDelay);
            } else {
                imap.end();
                reject(err);
            }
        });

        imap.connect();
    });
}

module.exports = { processOldEmails };
