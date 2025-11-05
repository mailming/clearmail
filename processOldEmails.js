const Imap = require("imap");
const fs = require('fs');
const config = require("./config");
const {simpleParser} = require("mailparser");
const {analyzeEmail} = require("./analyzeEmail");
const {isBusinessEmail} = require("./utilities");

async function processOldEmails() {
    return new Promise(async (resolve, reject) => {
        // Process ALL emails (no date limit)
        const deleteThresholdDate = new Date();
        deleteThresholdDate.setDate(deleteThresholdDate.getDate() - (config.settings.deleteEmailsOlderThanDays || 365));

        console.log(`\n\n[${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}]`);
        console.log(`*** Processing ALL old emails (no date limit).`);
        console.log(`*** Will delete emails older than ${config.settings.deleteEmailsOlderThanDays} days that are NOT worth reading.`);

        // Initialize IMAP with TLS configuration
        const imapConfig = {
            user: process.env.IMAP_USER,
            password: process.env.IMAP_PASSWORD,
            host: process.env.IMAP_HOST || 'imap.gmail.com',
            port: parseInt(process.env.IMAP_PORT) || 993,
            tls: true,
            tlsOptions: {
                rejectUnauthorized: false
            }
        };

        const imap = new Imap(imapConfig);

        function searchAndProcessEmails(mailboxName, searchCriteria, callback) {
            // Open in read-write mode (true) to allow deletions
            imap.openBox(mailboxName, true, function(err, box) {
                if (err) {
                    console.log(`Could not open ${mailboxName}, skipping...`);
                    callback(null, []);
                    return;
                }

                imap.search(searchCriteria, function(err, results) {
                    if (err) {
                        console.log(`Error searching ${mailboxName}:`, err);
                        callback(null, []);
                        return;
                    }
                    callback(results, mailboxName);
                });
            });
        }

        imap.once('ready', async function () {
            console.log(`Searching for ALL emails...`);
            
            // Try to search in "[Gmail]/All Mail" first (contains all emails)
                // If that doesn't work, search INBOX and category folders
                const allMailFolders = ['[Gmail]/All Mail', '[Google Mail]/All Mail', 'INBOX'];
                
                let searchResults = [];
                let currentFolderIndex = 0;

                function tryNextFolder() {
                    if (currentFolderIndex >= allMailFolders.length) {
                        // If no results from main folders, try category folders
                        if (searchResults.length === 0 && config.settings.sortIntoCategoryFolders) {
                            searchCategoryFolders();
                        } else {
                            processSearchResults(searchResults);
                        }
                        return;
                    }

                    const folderName = allMailFolders[currentFolderIndex];
                    console.log(`Searching in ${folderName}...`);
                    
                    // Search ALL emails (no date restriction)
                    searchAndProcessEmails(folderName, ['ALL'], function(results, mailboxName) {
                    if (results && results.length > 0) {
                        console.log(`Found ${results.length} emails in ${mailboxName}`);
                        searchResults = results;
                        // Process results from first folder that has emails
                        processSearchResults(searchResults, mailboxName);
                    } else {
                        currentFolderIndex++;
                        tryNextFolder();
                    }
                });
            }

            function searchCategoryFolders() {
                console.log('Searching category folders...');
                const categoryFolders = config.categoryFolderNames || [];
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

                console.log(`Processing ${results.length} emails from ${mailboxName}...`);
                
                // Re-open mailbox in read-write mode (true) to allow deletions
                imap.openBox(mailboxName, true, function(err, box) {
                    if (err) {
                        console.error(`Error opening ${mailboxName} in read-write mode:`, err);
                        imap.end();
                        resolve({statusCode: 500, message: 'Error opening mailbox for deletion.'});
                        return;
                    }

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
                                    const emailDate = email.date || new Date(attributes.date);
                                    const emailAge = Math.floor((new Date() - emailDate) / (1000 * 60 * 60 * 24)); // Age in days

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
                                            
                                            // Process next email
                                            processEmailSequentially();
                                            return;
                                        }
                                        
                                        const emailAnalysis = await analyzeEmail(
                                            email.subject, 
                                            email.from.text, 
                                            emailBody ? emailBody.substring(0, config.settings.maxEmailChars) : '', 
                                            emailDate
                                        );

                                        if (emailAnalysis.judgment !== 'unknown') {
                                            // If email is worth reading (judgment === true), move to Records category
                                            if (emailAnalysis.judgment === true) {
                                                // Move to Records category (worth reading emails)
                                                const recordsFolder = 'Records';
                                                
                                                // Move email to Records folder first, then star it in the new location
                                                await new Promise((resolve) => {
                                                    imap.move(attributes.uid, recordsFolder, function (err) {
                                                        if (err) {
                                                            console.log(`Error moving email to ${recordsFolder}:`, err);
                                                            resolve();
                                                        } else {
                                                            console.log(`MOVED TO RECORDS: ${email.subject} (worth reading)`);
                                                            
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
                                                                    console.log(`Error moving email to ${folderToMoveTo}:`, err);
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
                                }
                                
                                // Process next email
                                processEmailSequentially();
                            });
                        });

                        f.once('error', function(err) {
                            console.error('Error fetching email:', err);
                            processEmailSequentially(); // Continue with next email
                        });

                    } catch (err) {
                        console.error('Error in processEmailSequentially:', err);
                        processEmailSequentially(); // Continue with next email
                    }
                }

                function finishProcessing() {
                    // Expunge deleted emails
                    imap.expunge(function (err) {
                        if (err) {
                            console.log('Error expunging deleted emails:', err);
                        }
                        console.log(`\n*** Finished processing old emails:`);
                        console.log(`  - Processed: ${processedCount} emails`);
                        console.log(`  - Categorized: ${categorizedCount} emails`);
                        console.log(`  - Deleted: ${deletedCount} emails`);
                        imap.end();
                        resolve({statusCode: 200, message: 'Old email processing completed.', processed: processedCount, categorized: categorizedCount, deleted: deletedCount});
                    });
                }

                // Start processing emails one at a time
                processEmailSequentially();
                }); // Close openBox callback
            }

            // Start searching from the first folder
            tryNextFolder();
        });

        imap.once('error', function(err) {
            console.error('IMAP connection error:', err);
            reject(err);
        });

        imap.connect();
    });
}

module.exports = { processOldEmails };
