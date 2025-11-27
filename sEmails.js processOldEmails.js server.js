warning: in the working copy of 'processEmails.js', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'processOldEmails.js', LF will be replaced by CRLF the next time Git touches it
warning: in the working copy of 'server.js', LF will be replaced by CRLF the next time Git touches it
[1mdiff --git a/processEmails.js b/processEmails.js[m
[1mindex 47e7cc0..c98f738 100644[m
[1m--- a/processEmails.js[m
[1m+++ b/processEmails.js[m
[36m@@ -5,11 +5,17 @@[m [mconst {simpleParser} = require("mailparser");[m
 const {analyzeEmail} = require("./analyzeEmail");[m
 const {saveLastTimestamp, isBusinessEmail} = require("./utilities");[m
 [m
[31m-async function processEmails(timestamp) {[m
[32m+[m[32masync function processEmails(timestamp, retryCount = 0) {[m
[32m+[m[32m    const maxRetries = 3;[m
[32m+[m[32m    const retryDelay = Math.min(1000 * Math.pow(2, retryCount), 10000); // Exponential backoff, max 10 seconds[m
[32m+[m
     return new Promise(async (resolve, reject) => {[m
 [m
         console.log(`\n\n[${new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} ${new Date(timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}]`);[m
         console.log(`*** Checking for unread, non-starred messages.`);[m
[32m+[m[32m        if (retryCount > 0) {[m
[32m+[m[32m            console.log(`*** Retry attempt ${retryCount}/${maxRetries}`);[m
[32m+[m[32m        }[m
 [m
         // Initialize IMAP with TLS configuration[m
         // Gmail IMAP uses standard TLS, no custom certificates needed[m
[36m@@ -21,7 +27,9 @@[m [masync function processEmails(timestamp) {[m
             tls: true,[m
             tlsOptions: {[m
                 rejectUnauthorized: false // Allow connection (Gmail uses valid certs, but some Windows setups have CA issues)[m
[31m-            }[m
[32m+[m[32m            },[m
[32m+[m[32m            connTimeout: 60000, // 60 seconds connection timeout[m
[32m+[m[32m            authTimeout: 60000  // 60 seconds authentication timeout[m
         };[m
 [m
         const imap = new Imap(imapConfig);[m
[36m@@ -33,11 +41,21 @@[m [masync function processEmails(timestamp) {[m
         imap.once('ready', async function () {[m
 [m
             openInbox(async function (err, box) {[m
[31m-                if (err) throw err;[m
[32m+[m[32m                if (err) {[m
[32m+[m[32m                    console.error('Error opening inbox:', err);[m
[32m+[m[32m                    imap.end();[m
[32m+[m[32m                    reject(err);[m
[32m+[m[32m                    return;[m
[32m+[m[32m                }[m
 [m
                 // Use search criteria to get unread emails since the last timestamp[m
                 imap.search(['UNSEEN', ['SINCE', new Date(timestamp)]], async function (err, results) {[m
[31m-                    if (err) throw err;[m
[32m+[m[32m                    if (err) {[m
[32m+[m[32m                        console.error('Error searching emails:', err);[m
[32m+[m[32m                        imap.end();[m
[32m+[m[32m                        reject(err);[m
[32m+[m[32m                        return;[m
[32m+[m[32m                    }[m
 [m
                     if (results.length > 0) {[m
                         const fetchOptions = {[m
[36m@@ -62,6 +80,21 @@[m [masync function processEmails(timestamp) {[m
                                         .then(async email => {[m
                                             const attributes = await attributesPromise;[m
 [m
[32m+[m[32m                                            // Check if email is already in Records folder using Gmail labels[m
[32m+[m[32m                                            // Gmail IMAP provides X-GM-LABELS extension[m
[32m+[m[32m                                            const gmailLabels = attributes['x-gm-labels'] || attributes['X-GM-LABELS'] || [];[m
[32m+[m[32m                                            const labelsArray = Array.isArray(gmailLabels) ? gmailLabels : (gmailLabels ? [gmailLabels] : []);[m
[32m+[m[32m                                            const isInRecords = labelsArray.some(label => {[m
[32m+[m[32m                                                const labelStr = String(label).toLowerCase();[m
[32m+[m[32m                                                return labelStr === 'records';[m
[32m+[m[32m                                            });[m
[32m+[m[41m                                            [m
[32m+[m[32m                                            if (isInRecords) {[m
[32m+[m[32m                                                console.log(`*** Skipping email already in Records: ${email.subject || '(no subject)'}`);[m
[32m+[m[32m                                                resolve();[m
[32m+[m[32m                                                return;[m
[32m+[m[32m                                            }[m
[32m+[m
                                             // Check if the email is flagged as \\Starred; if so, do not process further[m
                                             if (!attributes.flags.includes('\\Flagged')) {[m
 [m
[36m@@ -171,6 +204,25 @@[m [masync function processEmails(timestamp) {[m
             });[m
         });[m
 [m
[32m+[m[32m        imap.once('error', function(err) {[m
[32m+[m[32m            console.error('IMAP connection error:', err.message);[m
[32m+[m[41m            [m
[32m+[m[32m            // Check if it's a timeout error and we haven't exceeded max retries[m
[32m+[m[32m            if ((err.source === 'timeout-auth' || err.source === 'timeout') && retryCount < maxRetries) {[m
[32m+[m[32m                console.log(`Connection timeout. Retrying in ${retryDelay/1000} seconds...`);[m
[32m+[m[32m                imap.end();[m
[32m+[m[41m                [m
[32m+[m[32m                setTimeout(() => {[m
[32m+[m[32m                    processEmails(timestamp, retryCount + 1)[m
[32m+[m[32m                        .then(resolve)[m
[32m+[m[32m                        .catch(reject);[m
[32m+[m[32m                }, retryDelay);[m
[32m+[m[32m            } else {[m
[32m+[m[32m                imap.end();[m
[32m+[m[32m                reject(err);[m
[32m+[m[32m            }[m
[32m+[m[32m        });[m
[32m+[m
         imap.connect();[m
     });[m
 }[m
[1mdiff --git a/processOldEmails.js b/processOldEmails.js[m
[1mindex 49ff31a..4a46234 100644[m
[1m--- a/processOldEmails.js[m
[1m+++ b/processOldEmails.js[m
[36m@@ -5,15 +5,23 @@[m [mconst {simpleParser} = require("mailparser");[m
 const {analyzeEmail} = require("./analyzeEmail");[m
 const {isBusinessEmail} = require("./utilities");[m
 [m
[31m-async function processOldEmails() {[m
[32m+[m[32masync function processOldEmails(retryCount = 0) {[m
[32m+[m[32m    const maxRetries = 3;[m
[32m+[m[32m    const retryDelay = Math.min(1000 * Math.pow(2, retryCount), 10000); // Exponential backoff, max 10 seconds[m
[32m+[m[32m    const PROCESSING_TIMEOUT = 30 * 60 * 1000; // 30 minutes timeout to prevent hanging[m
[32m+[m
     return new Promise(async (resolve, reject) => {[m
         // Process ALL emails (no date limit)[m
[32m+[m[32m        let imapRef = null; // Will hold reference to imap for timeout handler[m
         const deleteThresholdDate = new Date();[m
         deleteThresholdDate.setDate(deleteThresholdDate.getDate() - (config.settings.deleteEmailsOlderThanDays || 365));[m
 [m
         console.log(`\n\n[${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} ${new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}]`);[m
         console.log(`*** Processing ALL old emails (no date limit).`);[m
         console.log(`*** Will delete emails older than ${config.settings.deleteEmailsOlderThanDays} days that are NOT worth reading.`);[m
[32m+[m[32m        if (ret