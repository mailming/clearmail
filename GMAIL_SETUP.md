# Quick Guide: Setting Up Gmail App Password

## Fastest Method (Direct Link)

1. **Go directly to App Passwords:**
   - Open this link: https://myaccount.google.com/apppasswords
   - Sign in with your Gmail account (gamepla@gmail.com)

2. **If you see "App passwords aren't available for your account":**
   - You need to enable 2-Step Verification first
   - Click the link that appears or go to: https://myaccount.google.com/security
   - Click "2-Step Verification" and follow the setup (you'll need your phone)

3. **Generate App Password:**
   - Select app: **"Mail"**
   - Select device: **"Windows Computer"** (or "Other (Custom name)" → type "clearmail")
   - Click **"Generate"**
   - **Copy the 16-character password immediately!** (Example: `abcd efgh ijkl mnop`)

4. **Add to .env file:**
   - Open `.env` file in the clearmail folder
   - Find the line: `IMAP_PASSWORD=your_app_password_here`
   - Replace `your_app_password_here` with your copied password (remove spaces)
   - Save the file

## Visual Guide

The process looks like this:
```
Google Account → Security → 2-Step Verification → App Passwords → Generate
```

## Common Issues

**Q: I don't see "App passwords" option**
- Make sure 2-Step Verification is fully enabled (not just security keys)
- Try the direct link: https://myaccount.google.com/apppasswords

**Q: "App passwords aren't available"**
- Enable 2-Step Verification first at: https://myaccount.google.com/security

**Q: I have a work/school Gmail account**
- App passwords might be disabled by your organization
- Contact your IT administrator

**Q: Can I use my regular Gmail password?**
- No, Gmail no longer allows "less secure apps"
- You must use an app password if you have 2FA enabled
- If you don't have 2FA, you can try your regular password, but enabling 2FA and using an app password is more secure

## Need Help?

If you're still having trouble:
1. Make sure you're signed into the correct Google account
2. Try using an incognito/private browser window
3. Clear your browser cache and try again
4. Check that IMAP is enabled in Gmail settings (Settings → See all settings → Forwarding and POP/IMAP → Enable IMAP)

