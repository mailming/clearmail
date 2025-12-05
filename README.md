# clearmail README

## Introduction

**clearmail** is an open-source project that leverages AI to filter emails according to a set of simple rules you can write in english. The tool stars important emails and rejects or categorizes non-important emails according to preferences you can easily specify.

For maximum peace of mind, clearmail does not delete any emails. Instead, it only adds or removes labels from them, allowing you to review the AI's work. This project began as a weekend project and is still very much a work in progress!

## How it works

### 1. At a Given Interval...

Clearmail operates on a configurable interval, determined by the `refreshInterval` setting in the `config.yml` file. This interval sets how often clearmail checks for new emails. When running in script mode, the process wakes up at this interval, checks for new emails since the last processed timestamp, and then goes back to sleep until the next interval.

### 2. Connecting to the Gmail via IMAP

Clearmail uses the IMAP protocol to connect to your Gmail account. It securely authenticates using the credentials provided in the `.env` file and establishes a connection to the server.

### 3. Searching for New Emails

Once connected, clearmail searches the inbox for any unread emails that have arrived since the last processed timestamp that are not STARRED.

### 4. Processing Each Email

For each new email identified, clearmail performs the following steps:

- **Analyzing the Email:** The email's sender, subject, and body is analyzed using either the local LLM or OpenAI to determine if the email should be kept/starred or rejected/sorted according to predefined rules you specify in plain english in the `config.yml` file.

#### Sample Rules for Keeping Emails

```yaml
rules:
  keep: |
    * Email is a direct reply to one of my sent emails
    * Email contains tracking information for a recent purchase
    * Subject: "Invoice" or "Receipt" (Transactional emails)
```

#### Example Rules for Rejecting Emails

```yaml
rules:
  reject: |
    * Bulk emails that are not addressed to me specifically by name
    * Subject contains "Subscribe" or "Join now"
    * Email looks like a promotion
```

- **Categorizing or Moving the Email:** If the email is worth reading according to your rules, it is left in the inbox and starred.  If it's not, its either:
    - Moved to the rejection folder (as named in `rejectedFolderName`), if the email is considered not important.
    - Moved to a specific label like `Social`, if `sortIntoCategoryFolders` is enabled and the email matches one of the specified categories.  You can specify any categories you want!  For example:

        ```yaml
        categoryFolderNames:
          - News
          - SocialUpdate
          - Work
          - Family
          - Financial
        ```

### 5. Wrap Up

If any errors occur during the process, such as connection issues or errors in email analysis, clearmail logs these errors for debugging purposes.

## Requirements

To use clearmail you will need:

- A Gmail account
- Node.js installed on your system

Note: this has only been tested for Mac.

## Setup Instructions

Follow these steps to get clearmail up and running on your system:

### Step 1: Gmail IMAP Access with App Password

To securely access your Gmail account using IMAP in applications like clearmail, you'll need to create and use an app password. Here's the most current way to do this:

#### Quick Method (Direct Link)

1. **Go directly to App Passwords:**
   - Visit: https://myaccount.google.com/apppasswords
   - You'll be prompted to sign in if you're not already signed in.

2. **If you see "App passwords aren't available":**
   - This means you need to enable 2-Step Verification first
   - Go to: https://myaccount.google.com/security
   - Click on "2-Step Verification" and follow the prompts to enable it
   - Then return to the App Passwords page

3. **Generate the App Password:**
   - Select app: Choose **"Mail"**
   - Select device: Choose **"Windows Computer"** (or "Other (Custom name)" and type "clearmail")
   - Click **"Generate"**
   - A 16-character password will appear (it looks like: `abcd efgh ijkl mnop`)
   - **Copy this password immediately** - you won't be able to see it again!

4. **Add to your .env file:**
   - Open the `.env` file in the clearmail directory
   - Paste the password (you can remove spaces) in the `IMAP_PASSWORD` field
   - Example: `IMAP_PASSWORD=abcdefghijklmnop`

#### Alternative: Step-by-Step Navigation

If the direct link doesn't work, navigate manually:

1. **Go to Google Account:**
   - Visit https://myaccount.google.com/
   - Sign in with your Gmail account

2. **Go to Security:**
   - Click on "Security" in the left sidebar (or go to https://myaccount.google.com/security)

3. **Enable 2-Step Verification (if not already enabled):**
   - Click on "2-Step Verification"
   - Follow the prompts to set it up (you'll need your phone)

4. **Access App Passwords:**
   - After enabling 2-Step Verification, go back to Security
   - Scroll down to find "App passwords" (it's under "How you sign in to Google")
   - Or go directly to: https://myaccount.google.com/apppasswords

5. **Create App Password:**
   - Select app: **"Mail"**
   - Select device: **"Windows Computer"** or **"Other (Custom name)"** → type "clearmail"
   - Click **"Generate"**
   - Copy the 16-character password shown

#### Troubleshooting

- **"App passwords aren't available"**: Enable 2-Step Verification first
- **Can't find App passwords**: Make sure 2-Step Verification is fully set up (not just security keys)
- **Work/School account**: App passwords may not be available for managed accounts - contact your administrator
- **Advanced Protection**: If you have Advanced Protection enabled, app passwords won't work - you'll need to use OAuth instead (not currently supported by clearmail)

### Step 2: Configure the YAML File

Navigate to the `config.yml` file in the clearmail directory. Customize these settings to match your email management preferences.

#### YAML File Options

The `config.yml` file contains several options to customize how clearmail works:

- `useLocalLLM`: Determines whether to use a local language model or OpenAI for email analysis.
- `maxEmailChars`: The maximum number of characters from an email body to feed to the AI for analysis.
- `maxEmailsToProcessAtOnce`: Limits the number of emails processed in a single batch.
- `refreshInterval`: How often, in seconds, to check for new emails.
- `timestampFilePath`: The file path for storing the timestamp of the last processed email.
- `sortIntoCategoryFolders`: Whether to sort emails into specified categories.
- `rejectedFolderName`: The name of the folder where rejected emails are moved.
- `categoryFolderNames`: A list of folder names for categorizing emails.
- `rules`: Simple rules defining which emails to keep or reject.

Additional details are included as comments in `config.yml`.

### Step 3: Configure .env File

To integrate your environment with clearmail, you'll need to configure the `.env` file by setting up various environment variables that the application requires to run. Copy the `.env.example` to `.env` and fill in the following:

#### .env File Configuration

1. **OPENAI_API_KEY**:
    - **Description**: Optional.  If you choose to not use a local LLM, fill in your OpenAI API key here.

2. **IMAP_USER**:
    - **Description**: Your email address that you will use to access your Gmail account via IMAP.

3. **IMAP_PASSWORD**:
    - **Description**: Use app password generated above.

4. **IMAP_HOST**:
    - **Description**: The IMAP server address for Gmail.
    - **Default Value**: `imap.gmail.com`. This is pre-set for Gmail accounts and typically does not need to be changed.

5. **IMAP_PORT**:
    - **Description**: The port number used to connect to the IMAP server.
    - **Default Value**: `993`. This is the standard port for IMAP over SSL (IMAPS) and is used by Gmail.

#### Example .env File Content

```plaintext
OPENAI_API_KEY=your_openai_api_key_here
IMAP_USER=yourname@gmail.com
IMAP_PASSWORD=your_app_password_or_regular_password_here
IMAP_HOST=imap.gmail.com
IMAP_PORT=993
```

### Step 4: Run the Process

Expanding on Step 4 to include instructions on setting up Node.js on your machine and ensuring you navigate to the correct folder to run `clearmail`:

#### Installing Node.js

Node.js is a JavaScript runtime built on Chrome's V8 JavaScript engine, and it's required to run `clearmail`. Here's how to install it:

1. **Download Node.js**: Visit the [official Node.js website](https://nodejs.org/) to download the installer for your operating system. It is recommended to download the LTS (Long Term Support) version for better stability.

2. **Install Node.js**:
   - **Windows & macOS**: Run the downloaded installer and follow the on-screen instructions. The installer includes Node.js and npm (Node Package Manager).
   - **Linux**: You can install Node.js via a package manager. Instructions for different distributions are available on the Node.js website under the [Linux installations guide](https://nodejs.org/en/download/package-manager/).

3. **Verify Installation**: Open a terminal or command prompt and type the following commands to verify that Node.js and npm are installed correctly:

    ```bash
    node --version
    npm --version
    ```

   If the installation was successful, you should see the version numbers for both Node.js and npm.

#### Navigating to the clearmail Directory

Before running the `clearmail` process, make sure you are in the directory where `clearmail` is located:

1. **Open a Terminal or Command Prompt**: Use a terminal on Linux or macOS, or Command Prompt/Powershell on Windows.

2. **Navigate to the clearmail Directory**: Use the `cd` (change directory) command to navigate to the folder where you have `clearmail` installed. For example, if you have `clearmail` in a folder named "clearmail" on your desktop, the command might look like this:

   - On Windows:
       ```bash
       cd Desktop\clearmail
       ```
   - On Linux or macOS:
       ```bash
       cd ~/Desktop/clearmail
       ```

#### Running clearmail

Once Node.js is installed and you are in the correct directory, you can start `clearmail` by running the following command in your terminal or command prompt:

```bash
node server.js
```

This will initialize clearmail and begin sorting your emails according to the defined rules.  It will continue to run at the defined interval and output data about its activities to the shell.

#### Stopping clearmail

To stop the clearmail process type `<ctrl> + c` on Mac.


## Large Language Model (LLM) Choice: Local or OpenAI

Clearmail supports integration with any running local LLM and is configured out of the box to support default LM Studio settings. The advantage of Local LLMs is privacy and zero inference costs, but the tradeoff is likely performance.  For that reason, clearmail also supports using any OpenAI chat completion model.

### Using Ollama

To use Ollama with clearmail:

1. Install Ollama from [https://ollama.ai](https://ollama.ai)
2. **Ensure GPU Support (IMPORTANT):**
   - **For NVIDIA GPUs on Windows:**
     - Install [CUDA Toolkit](https://developer.nvidia.com/cuda-downloads) (version 11.8 or later recommended)
     - Ollama should automatically detect and use your GPU once CUDA is installed
     - Verify GPU usage by running: `ollama ps` after starting a model
   - **For AMD GPUs:**
     - Install [ROCm](https://rocm.docs.amd.com/) drivers
     - Ollama will automatically use GPU if ROCm is properly configured
   - **To force GPU usage (if CPU is still being used):**
     - Set environment variable before starting Ollama: `set CUDA_VISIBLE_DEVICES=0` (Windows) or `export CUDA_VISIBLE_DEVICES=0` (Linux/Mac)
     - Restart Ollama service after setting the environment variable
     - On Windows, you can also set this in System Environment Variables permanently
3. Pull the model: `ollama pull gpt-oss:20b`
4. Configure `config.yml`:
   ```yaml
   settings:
     llmProvider: ollama
   
   ollama:
     baseURL: http://localhost:11434
     model: gpt-oss:20b
   ```
5. **Verify GPU Usage:**
   - Start Ollama and run a model
   - Check Task Manager (Windows) or `nvidia-smi` (Linux) to confirm GPU utilization
   - If GPU is not being used, ensure CUDA drivers are up to date and Ollama is restarted

### Local Option: Setting Up LM Studio

[LM Studio](https://lmstudio.ai/) is a powerful platform that allows you to run large language models locally. To get started, follow these steps:

1. **Download and Install LM Studio:** Visit [https://lmstudio.ai/](https://lmstudio.ai/) and download the latest version of LM Studio for your operating system. Follow the installation instructions provided on the website.

2. **Start an Inference Server:** Once LM Studio is installed, launch the application and start an inference server. This server will handle requests from clearmail to process emails.

3. **Download a Language Model:** Any model can work, but we recommend searching for `TheBloke/Mistral-7B-Instruct-v0.2-code-ft-GGUF` within LM Studio's model marketplace and download any of the models listed there. These models are specifically tailored for instruction-following tasks and code generation, making them well-suited for analyzing and categorizing emails.

4. **Specify the Connection String:** After setting up the inference server, note the connection string provided by LM Studio. If you modify it, update clearmail's `config.yml` under the `localLLM.postURL` field to ensure clearmail can communicate with the local LLM server.  If you don't modify it, clearmail will work out of the box with LMStudio's loaded model.

### Configuration in clearmail

Once your LM Studio server is running and the model is downloaded, configure clearmail to use the local LLM by editing the `config.yml` file:

```yaml
settings:
  useLocalLLM: true

localLLM:
  postURL: http://localhost:1234/v1/chat/completions  # Replace with your actual LM Studio connection string
```

Make sure the `useLocalLLM` setting is set to `true` and the `postURL` points to your running LM Studio inference server.

### Using OpenAI

While using local LLMs can offer many advantages, it's important to note that performance and reliability may vary compared to using OpenAI's APIs. We have included some `fixJSON` work in the clearmail codebase to address potential inconsistencies with model outputs, but local models can still be somewhat unreliable. If you encounter issues, consider using OpenAI but keep in mind you are sending your emails to their AI and you need to be comfortable with that level of not-privacy.

For best performance, we recommend using OpenAI's `gpt-4.5-turbo-0125` model, which offers a good balance between speed, accuracy, and cost. The `gpt-3.5-turbo` model also provides reasonably good performance but may not match the latest advancements found in newer models.

#### Obtaining Your OpenAI API Key

1. **Log in or Sign Up to OpenAI**:
    - Visit the OpenAI platform at [https://platform.openai.com/account/api-keys](https://platform.openai.com/account/api-keys). If you already have an account, log in using your credentials. If you don't, you'll need to sign up and create an account.

2. **Create a New Secret Key**:
    - Once logged in, you'll be directed to the API keys section of your OpenAI account. Look for the "Create new secret key" button and click on it. This action will generate a new API key for you to use with applications like clearmail.

3. **Copy Your Key**:
    - After creating your new secret key, a window will pop up showing your newly generated API key. Use the "Copy" button to copy your key to your clipboard. Make sure to save it in a secure place, as you will need to enter this key into your clearmail configuration.

#### Integrating the API Key into clearmail

1. **Open Your .env File**: Navigate to the root directory of your clearmail project and open the `.env` file in a text editor. If you haven't created this file yet, you can copy and rename the `.env.example` file to `.env`.

2. **Enter Your OpenAI API Key**: Locate the line starting with `OPENAI_API_KEY=` and paste your copied API key right after the equals sign (`=`) without any spaces. It should look something like this:

    ```plaintext
    OPENAI_API_KEY=your_copied_api_key_here
    ```

   Replace `your_copied_api_key_here` with the API key you copied from the OpenAI platform.

3. **Save Changes**: After entering your API key, save the `.env` file. This update will allow clearmail to use your OpenAI API key to access the AI services required for email analysis.

## Using PM2 to Manage the clearmail Process

[PM2](https://pm2.keymetrics.io/) is a process manager for Node.js applications that can help manage and keep your clearmail process running in the background. To use PM2 with clearmail:

1. Install PM2 globally using npm:

    ```bash
    npm install pm2 -g
    ```

2. Start clearmail with PM2:

    ```bash
    pm2 start server.js --name clearmail
    ```

3. To ensure clearmail starts on system reboot, use the `pm2 startup` command and follow the instructions provided.

4. To stop clearmail, use:

    ```bash
    pm2 stop clearmail
    ```

## Contact

For questions, suggestions, or contributions, please get in touch with the project owner, [Andy Walters](mailto:andywalters@gmail.com). Your feedback is much appreciated!

Project sponsored by [Emerge Haus](https://emerge.haus), a custom Generative AI consultancy & dev shop.