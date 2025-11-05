const {OpenAI} = require("openai");
const fs = require('fs').promises;

async function executeOpenAIWithRetry(params, retries = 3, backoff = 2500, rateLimitRetry = 10, timeoutOverride = 27500) {
    const RATE_LIMIT_RETRY_DURATION = 61000; // 61 seconds

    const openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
    });

    let attempts = 0;
    let rateLimitAttempts = 0;
    let error;
    let result;

    while (attempts < retries) {
        try {
            result = await Promise.race([
                openai.chat.completions.create(params),
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error(`Request took longer than ${timeoutOverride / 1000} seconds`)), timeoutOverride)
                )
            ]);

            //console.log(result);

            return result.choices[0].message.content.trim();
        } catch (e) {
            error = e;
            attempts++;

            // If we hit a rate limit
            if (e.response && e.response.status === 429 && rateLimitAttempts < rateLimitRetry) {
                console.log(`Hit rate limit. Sleeping for 61s...`);
                await sleep(RATE_LIMIT_RETRY_DURATION);
                rateLimitAttempts++;
                continue; // Don't increase backoff time, just retry
            }

            // Exponential backoff with jitter
            const delay = (Math.pow(2, attempts) * backoff) + (backoff * Math.random());

            console.log(`Attempt ${attempts} failed with error: ${e.message}. Retrying in ${delay}ms...`);
            await sleep(delay);
        }
    }

    throw error; // If all retries failed, throw the last error encountered
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function fixJSON(input) {
    return input
        // Fix common errors with local LLM JSON
        .replace(/[\u201C\u201D]/g, '"') // Replace curly double quotes with straight double quotes
        .replace(/[\u2018\u2019]/g, "'") // Replace curly single quotes with straight single quotes
        .replace(/`/g, "'") // Replace backticks with straight single quotes
        .replace(/\\_/g, "_") // Replace escaped underscores with unescaped underscores
        .replaceAll("'''json\n", '')
        .replaceAll("'''", '');
}

async function getLastTimestamp(timestampFilePath) {
    try {
        const lastTimestamp = await fs.readFile(timestampFilePath, 'utf8');
        return lastTimestamp;
    } catch (error) {
        // If the file doesn't exist, use the current date-time
        return new Date().toISOString();
    }
}

async function saveLastTimestamp(timestamp, timestampFilePath) {
    await fs.writeFile(timestampFilePath, timestamp, 'utf8');
}

/**
 * Checks if an email is from eBay, Craigslist, or other media involving computer queries with "gamepla"
 * These emails should be automatically moved to Records folder as they are business-related
 * @param {string} emailSender - The sender email address or name
 * @param {string} emailSubject - The email subject
 * @param {string} emailBody - The email body (text or HTML)
 * @returns {boolean} - True if email should be moved to Records
 */
function isBusinessEmail(emailSender, emailSubject, emailBody) {
    const senderLower = (emailSender || '').toLowerCase();
    const subjectLower = (emailSubject || '').toLowerCase();
    const bodyLower = (emailBody || '').toLowerCase();
    
    // Check if sender is from eBay, Craigslist, or other marketplace platforms
    const marketplacePatterns = [
        'ebay',
        'craigslist',
        'marketplace',
        'offerup',
        'facebook marketplace',
        'letgo',
        'mercari',
        'poshmark'
    ];
    
    const isFromMarketplace = marketplacePatterns.some(pattern => 
        senderLower.includes(pattern) || subjectLower.includes(pattern)
    );
    
    if (!isFromMarketplace) {
        return false;
    }
    
    // Check if email involves computer queries with "gamepla" or computer-related terms
    const computerTerms = [
        'gamepla',
        'computer',
        'pc',
        'thinkpad',
        'laptop',
        'desktop',
        'cpu',
        'gpu',
        'ram',
        'hardware',
        'system',
        'htpc',
        'intel',
        'amd',
        'nvidia'
    ];
    
    const combinedText = `${subjectLower} ${bodyLower}`;
    const hasComputerQuery = computerTerms.some(term => 
        combinedText.includes(term.toLowerCase())
    );
    
    return hasComputerQuery;
}


module.exports = {
    executeOpenAIWithRetry,
    fixJSON,
    getLastTimestamp,
    saveLastTimestamp,
    isBusinessEmail
};