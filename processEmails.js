const Imap = require("imap");
const fs = require('fs');
const config = require("./config");
const {simpleParser} = require("mailparser");
const {analyzeEmail} = require("./analyzeEmail");
const {saveLastTimestamp, isBusinessEmail} = require("./utilities");

async function processEmails(timestamp, retryCount = 0) {
    const maxRetries = 3;
    const retryDelay = Math.min(1000 * Math.pow(2, retryCount), 10000); // Exponential backoff, max 10 seconds

    return new Promise(async (resolve, reject) => {

        console.log(`\n\n[${new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} ${new Date(timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}]`);
        console.log(`*** Checking for unread, non-starred messages.`);
        if (retryCount > 0) {
            console.log(`*** Retry attempt ${retryCount}/${maxRetries}`);
        }

        // Initialize IMAP with TLS configuration
        // Gmail IMAP uses standard TLS, no custom certificates needed
        const imapConfig = {
            user: process.env.IMAP_USER,
            password: process.env.IMAP_PASSWORD,
            host: process.env.IMAP_HOST || 'imap.gmail.com',
            port: parseInt(process.env.IMAP_PORT) || 993,
            tls: true,
            tlsOptions: {
                rejectUnauthorized: false // Allow connection (Gmail uses valid certs, but some Windows setups have CA issues)
            },
            connTimeout: 60000, // 60 seconds connection timeout
            authTimeout: 60000  // 60 seconds authentication timeout
        };

        const imap = new Imap(imapConfig);

        function openInbox(cb) {
            imap.openBox('INBOX', false, cb);
        }

        imap.once('ready', async function () {

            openInbox(async function (err, box) {
                if (err) {
                    console.error('Error opening inbox:', err);
                    imap.end();
                    reject(err);
                    return;
                }

                // Use search criteria to get unread emails since the last timestamp
                imap.search(['UNSEEN', ['SINCE', new Date(timestamp)]], async function (err, results) {
                    if (err) {
                        console.error('Error searching emails:', err);
                        imap.end();
                        reject(err);
                        return;
                    }

                    if (results.length > 0) {
                        const fetchOptions = {
                            bodies: '',
                            struct: true,
                            markSeen: false // Do not mark emails as seen automatically
                        };

                        const f = imap.fetch(results, fetchOptions);
                        let emailPromises = []; // Create an array to hold promises for each email processed

                        let i = 0;

                        f.on('message', function (msg, seqno) {
                            if (i > config.settings.maxEmailsToProcessAtOnce) return;

                            const attributesPromise = new Promise((resolve) => msg.once('attributes', resolve)); // Move this outside

                            const emailPromise = new Promise((resolve, reject) => {
                                msg.on('body', function (stream, info) {
                                    simpleParser(stream)
                                        .then(async email => {
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
                                                resolve();
                                                return;
                                            }

                                            // Check if the email is flagged as \\Starred; if so, do not process further
                                            if (!attributes.flags.includes('\\Flagged')) {

                                                const emailBody = (email?.text) ? email.text : email.html;
                                                
                                                // Check if this is a business email (eBay/Craigslist/computer queries with gamepla)
                                                // If so, automatically move to Records without AI analysis
                                                if (isBusinessEmail(email.from.text, email.subject, emailBody)) {
                                                    const recordsFolder = 'Records';
                                                    console.log(`*** BUSINESS EMAIL DETECTED: ${email.subject} - Auto-moving to Records`);
                                                    if (config.settings.starAllKeptEmails) {
                                                        imap.addFlags(attributes.uid, ['\\Flagged'], function (err) {
                                                            if (err) console.log('Error starring email:', err);
                                                        });
                                                    }
                                                    // Move email to Records folder
                                                    imap.move(attributes.uid, recordsFolder, function (err) {
                                                        if (err) {
                                                            console.log(`Error moving email to ${recordsFolder}:`, err);
                                                        } else {
                                                            console.log(`Email moved to ${recordsFolder} (business email).`);
                                                        }
                                                    });
                                                    i++;
                                                    resolve();
                                                    return;
                                                }
                                                
                                                const emailAnalysis = await analyzeEmail(email.subject, email.from.text, emailBody.substring(0, config.settings.maxEmailChars), email.date);

                                                if (emailAnalysis.judgment !== 'unknown') {
                                                    // After determining if an email is worth reading or not
                                                    if (emailAnalysis.judgment === true) {
                                                        // Calculate email age in days
                                                        const emailDate = email.date || new Date(attributes.date);
                                                        const emailAge = Math.floor((new Date() - emailDate) / (1000 * 60 * 60 * 24)); // Age in days
                                                        
                                                        // If email is less than 30 days old and worth reading, star it and keep in inbox
                                                        if (emailAge < 30) {
                                                            if (config.settings.starAllKeptEmails) {
                                                                imap.addFlags(attributes.uid, ['\\Flagged'], function (err) {
                                                                    if (err) console.log('Error starring email:', err);
                                                                });
                                                            }
                                                            console.log(`Email kept in inbox (starred if enabled) (${emailAge} days old, worth reading).`);
                                                        } else {
                                                            // Email is 30 days or older, move to Records category (worth reading emails)
                                                            const recordsFolder = 'Records';
                                                            if (config.settings.starAllKeptEmails) {
                                                                imap.addFlags(attributes.uid, ['\\Flagged'], function (err) {
                                                                    if (err) console.log('Error starring email:', err);
                                                                });
                                                            }
                                                            // Move email to Records folder
                                                            imap.move(attributes.uid, recordsFolder, function (err) {
                                                                if (err) {
                                                                    console.log(`Error moving email to ${recordsFolder}:`, err);
                                                                } else {
                                                                    console.log(`Email moved to ${recordsFolder} (worth reading, ${emailAge} days old).`);
                                                                }
                                                            });
                                                        }
                                                    } else if (emailAnalysis.judgment === false) {
                                                        // Mark the message as seen and remove the primary inbox label
                                                        if (config.settings.markAllRejectedEmailsRead) imap.setFlags(attributes.uid, ['\\Seen'], function (err) {
                                                            if (err) console.log('Error marking email as seen:', err);
                                                        });

                                                        const folderToMoveTo = (config.settings.sortIntoCategoryFolders) ? emailAnalysis.category : config.settings.rejectedFolderName;

                                                        // Copy the message to "AI Rejects" label for archiving
                                                        imap.move(attributes.uid, folderToMoveTo, function (err) {
                                                            if (err) {
                                                                console.log(`Error moving email to ${folderToMoveTo}:`, err);
                                                            } else {
                                                                console.log(`Email moved to ${folderToMoveTo}.`);
                                                            }
                                                        });

                                                    }
                                                    i++;
                                                }
                                            }
                                            resolve(); // Resolve the promise after processing the email
                                        })
                                        .catch(err => {
                                            console.error('Error parsing mail:', err);
                                            reject(err); // Reject the promise if there's an error
                                        });
                                });
                            });

                            emailPromises.push(emailPromise); // Add the promise to the array
                        });

                        f.once('end', function () {
                            Promise.all(emailPromises).then(() => {
                                if (i !== 0) {
                                    console.log(`*** Finished processing ${i} email(s).  Enjoy a breath of fresh air.`);
                                } else {
                                    console.log(`*** No unread, non-starred messages found for any date starting ${new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}.`);
                                }

                                saveLastTimestamp(new Date().toISOString(), config.settings.timestampFilePath);
                                imap.end(); // Close the IMAP connection only after all emails have been processed

                                resolve({statusCode: 200, message: 'Email processing completed.', processedCount: i});
                            }).catch(error => {
                                console.error('Error processing some emails:', error);
                                imap.end(); // Consider closing the IMAP connection even if there are errors

                                resolve({statusCode: 500, message: 'Error processing email.', processedCount: 0});
                            });
                        });
                    } else {
                        console.log('No new messages to fetch.');
                        imap.end();
                        resolve({statusCode: 200, message: 'No new messages to fetch.', processedCount: 0});
                    }
                });
            });
        });

        imap.once('error', function(err) {
            console.error('IMAP connection error:', err.message);
            
            // Check if it's a timeout error and we haven't exceeded max retries
            if ((err.source === 'timeout-auth' || err.source === 'timeout') && retryCount < maxRetries) {
                console.log(`Connection timeout. Retrying in ${retryDelay/1000} seconds...`);
                imap.end();
                
                setTimeout(() => {
                    processEmails(timestamp, retryCount + 1)
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

module.exports = { processEmails };