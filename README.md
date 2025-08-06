# 🛡️ ApplicationWatcher

A powerful **Discord bot** that monitors **Google Form applications** (via Sheets API)  
and posts them to your server with **interactive Accept/Reject buttons**.  

Originally built as `NewModWatcher` for the [NewMod](https://github.com/CallOfCreator) project,  
it is now fully generalized for **any community or project**. ✨

---

## 🚀 Features

- 📥 Pulls new applications from Google Sheets (connected to Google Forms)
- 🧾 Parses all responses and posts a beautiful embed
- ✅ Accept/Reject buttons with optional role assignment
- 📬 Sends a DM on Accept or Reject (optional)
- 🔒 Supports multiple sheet types: **Moderator**, **Beta**, **Team**, or custom forms
- ⏱️ Automatically checks every 10 seconds
- 🛠️ Slash command to manually recheck applications: `/check`

---

## 📦 Environment Setup

Create a `.env` file in the root of the project with the following variables:

```dotenv
# Google Service Account
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_PRIVATE_KEY=

# Discord Bot
DISCORD_TOKEN=
DISCORD_CHANNEL_ID=

# Optional
STAFF_PING_USER_ID=         # Discord ID to ping when new application arrives
ACCEPTED_ROLE_ID=           # Role ID to assign when someone is accepted
DM_ON_REJECT=true           # Set to false to disable DM on rejection

# Sheet Configs (connected to your Google Forms)
SPREADSHEET_ID_MODERATOR=
SPREADSHEET_ID_BETA=
SPREADSHEET_ID_TEAM=

# Optional: Only change if you renamed your sheet tab (default is 'Form Responses 1')
SHEET_NAME_MODERATOR=Form Responses 1
SHEET_NAME_BETA=Form Responses 1
SHEET_NAME_TEAM=Form Responses 1
