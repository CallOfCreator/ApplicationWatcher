const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Events, REST, Routes, SlashCommandBuilder, Partials } = require('discord.js');
const { google } = require('googleapis');
const { JWT } = require('google-auth-library');
const fs = require('fs');
const path = require('path');

// ENV
const SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
let PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY;
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID;
const STAFF_PING_USER_ID = process.env.STAFF_PING_USER_ID; // Replace with your Discord ID
const ACCEPTED_ROLE_ID = process.env.ACCEPTED_ROLE_ID;
const DM_ON_REJECT = process.env.DM_ON_REJECT === 'true';

if (!SERVICE_ACCOUNT_EMAIL || !PRIVATE_KEY || !DISCORD_TOKEN || !CHANNEL_ID || !STAFF_PING_USER_ID) {
  console.error('❌ Missing env vars.');
  process.exit(1);
}
if (PRIVATE_KEY.includes('\\n')) PRIVATE_KEY = PRIVATE_KEY.replace(/\\n/g, '\n');

const SHEETS_TO_WATCH = [
  { id: process.env.SPREADSHEET_ID_MODERATOR, sheetName: process.env.SHEET_NAME_MODERATOR || 'Form Responses 1', formType: 'Moderator' },
  { id: process.env.SPREADSHEET_ID_BETA, sheetName: process.env.SHEET_NAME_BETA || 'Form Responses 1', formType: 'Beta' },
  { id: process.env.SPREADSHEET_ID_TEAM, sheetName: process.env.SHEET_NAME_TEAM || 'Form Responses 1', formType: 'Team' }
];

const STATE_FILE = path.join(__dirname, 'processed_state.json');
let lastProcessedMap = loadLastProcessedMap();

const authClient = new JWT({
  email: SERVICE_ACCOUNT_EMAIL,
  key: PRIVATE_KEY,
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});
const sheets = google.sheets({ version: 'v4', auth: authClient });

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.DirectMessages],
  partials: [Partials.Channel]
});

function loadLastProcessedMap() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}
function saveLastProcessedMap() {
  fs.writeFileSync(STATE_FILE, JSON.stringify(lastProcessedMap, null, 2));
}

async function pollAllSheets() {
  for (const sheet of SHEETS_TO_WATCH) {
    await pollSheet(sheet);
  }
}

let headerRow = [];

async function pollSheet({ id, sheetName, formType }) {
  const range = `${sheetName}!A1:ZZ`;
  const sheetKey = `${id}_${sheetName}`;

  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: id, range });
    const values = res.data.values || [];
    if (values.length === 0) return;

    headerRow = values[0];
    const dataRows = values.slice(1);
    const lastRow = lastProcessedMap[sheetKey] || 0;

    for (let i = lastRow; i < dataRows.length; i++) {
      const row = dataRows[i];
      if (!row.some(cell => cell?.trim())) continue;

      const rowNumber = i + 2;
      const entry = parseRow(row);
      if (formType) entry.type = formType;

      await postApplication(entry, rowNumber);
      lastProcessedMap[sheetKey] = i + 1;
      saveLastProcessedMap();
    }
  } catch (err) {
    console.error(`❌ Polling error in ${sheetKey}:`, err.message);
  }
}

function parseRow(row) {
  const questions = [];
  let discordTag = null, type = 'Application';

  for (let c = 0; c < headerRow.length; c++) {
    const col = headerRow[c];
    const val = row[c] ?? '';
    const lower = col.toLowerCase();

    if (lower.includes('discord')) discordTag = val.trim();
    else if (lower.includes('application type')) type = val || type;
    else questions.push({ name: col, answer: val });
  }

  return { questions, discordTag, type };
}

async function postApplication(entry, rowNumber) {
  const channel = await client.channels.fetch(CHANNEL_ID);
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setTitle(`📝 New ${entry.type} Application`)
    .setColor('#ff0ad6')
    .setDescription(`A new application has been submitted.`)
    .setTimestamp();

  entry.questions.forEach(qa => {
    if (!qa.answer) return;
    embed.addFields({ name: `**${qa.name}**`, value: qa.answer });
  });

  if (entry.discordTag) embed.addFields({ name: '**Discord Username**', value: entry.discordTag });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`accept_${rowNumber}`).setLabel('Accept').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`reject_${rowNumber}`).setLabel('Reject').setStyle(ButtonStyle.Danger)
  );

  await channel.send(`<@${STAFF_PING_USER_ID}>`);
  await channel.send({ embeds: [embed], components: [row] });
}

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton()) return;

  const [action, rowStr] = interaction.customId.split('_');
  const rowNumber = parseInt(rowStr, 10);
  await interaction.deferReply({ ephemeral: true });

  if (action === 'accept') await handleAccept(interaction, rowNumber);
  if (action === 'reject') await handleReject(interaction, rowNumber);
});

async function handleAccept(interaction, rowNumber) {
  for (const { id, sheetName, formType } of SHEETS_TO_WATCH) {
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: id,
        range: `${sheetName}!A${rowNumber}:ZZ${rowNumber}`
      });
      const values = res.data.values || [];
      const row = values[0];
      if (!row) continue;

      const entry = parseRow(row);
      entry.type = formType;

      const guild = interaction.guild;
      let member = null, dmSuccess = false, assigned = false;

      if (entry.discordTag && guild) {
        member = await findMemberByTag(guild, entry.discordTag);
        if (member) {
          try {
            const roleWelcome = {
              Team: 'Welcome to the **Team**! 💼',
              Moderator: 'Welcome to the **Moderator Squad**! 🛡️',
              Beta: 'Welcome to the **Beta Testing Crew**! 🧪',
            };

            const acceptedEmbed = new EmbedBuilder()
              .setColor('#00ff99')
              .setTitle('🎉 Application Accepted!')
              .setDescription(`Hey ${member.displayName || member.user.username}, your **${entry.type} application** has been accepted!`)
              .addFields(
                { name: '🕒 What’s next?', value: 'Your role will be assigned within a few hours. Sit tight!' },
                { name: '🙏 Thanks!', value: roleWelcome[entry.type] || 'We’re glad to have you on board!' }
              )
              .setFooter({ text: 'Application Bot' })
              .setTimestamp();

            await member.send({ embeds: [acceptedEmbed] });
            dmSuccess = true;

            if (ACCEPTED_ROLE_ID) {
              await member.roles.add(ACCEPTED_ROLE_ID);
              assigned = true;
            }
          } catch (e) {
            console.warn('DM fail:', e.message);
          }
        }
      }

      await sheets.spreadsheets.values.update({
        spreadsheetId: id,
        range: `${sheetName}!A${rowNumber}`,
        valueInputOption: 'USER_ENTERED',
        resource: { values: [[`✅ Accepted on ${new Date().toLocaleDateString()}`]] }
      });

      let msg = `✅ Accepted row ${rowNumber}.`;
      if (dmSuccess) msg += ' Applicant DMed.';
      if (assigned) msg += ' Role assigned.';
      await interaction.editReply({ content: msg, components: [] });
      return;
    } catch {}
  }
  await interaction.editReply({ content: '❌ Failed to accept.', components: [] });
}

async function handleReject(interaction, rowNumber) {
  for (const { id, sheetName, formType } of SHEETS_TO_WATCH) {
    try {
      const res = await sheets.spreadsheets.values.get({
        spreadsheetId: id,
        range: `${sheetName}!A${rowNumber}:ZZ${rowNumber}`
      });
      const values = res.data.values || [];
      const row = values[0];
      if (!row) continue;

      const entry = parseRow(row);
      entry.type = formType;

      let member = null, dmSuccess = false;
      if (entry.discordTag && interaction.guild) {
        member = await findMemberByTag(interaction.guild, entry.discordTag);
        if (member && DM_ON_REJECT) {
          try {
            const rejectEmbed = new EmbedBuilder()
              .setColor('#ff0033')
              .setTitle('❌ Application Rejected')
              .setDescription(`Hey ${member.displayName || member.user.username}, unfortunately your **${entry.type} application** was not accepted.`)
              .addFields({ name: '💡 Want another chance?', value: 'You’re welcome to re-apply in the future!' })
              .setFooter({ text: 'Application Bot' })
              .setTimestamp();

            await member.send({ embeds: [rejectEmbed] });
            dmSuccess = true;
          } catch (e) {
            console.warn('DM reject fail:', e.message);
          }
        }
      }

      await sheets.spreadsheets.values.update({
        spreadsheetId: id,
        range: `${sheetName}!A${rowNumber}`,
        valueInputOption: 'USER_ENTERED',
        resource: { values: [[`❌ Rejected on ${new Date().toLocaleDateString()}`]] }
      });

      let msg = `❌ Rejected row ${rowNumber}.`;
      if (DM_ON_REJECT) msg += dmSuccess ? ' Applicant DMed.' : ' DM failed.';
      await interaction.editReply({ content: msg, components: [] });
      return;
    } catch {}
  }
  await interaction.editReply({ content: '❌ Failed to reject.', components: [] });
}

async function findMemberByTag(guild, tag) {
  const name = tag?.split('#')[0]?.trim();
  try {
    const members = await guild.members.search({ query: name, limit: 10 });
    return members.find(m => m.user.username.toLowerCase() === name.toLowerCase());
  } catch (e) {
    console.warn('Search fail:', e.message);
    return;
  }
}

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === 'check') {
    await interaction.reply({ content: '⏳ Checking sheets now...', ephemeral: true });
    try {
      await pollAllSheets();
      await interaction.editReply('✅ Done checking all sheets.');
    } catch (e) {
      await interaction.editReply('❌ Check failed.');
    }
  }
});

client.once(Events.ClientReady, async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  await pollAllSheets();
  setInterval(pollAllSheets, 10000); // 10s

  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  const data = [new SlashCommandBuilder().setName('check').setDescription('Manually check for new applications.')];

  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: data });
    console.log('✅ Slash command /check registered');
  } catch (e) {
    console.error('❌ Slash command registration failed:', e.message);
  }
});

client.login(DISCORD_TOKEN);
