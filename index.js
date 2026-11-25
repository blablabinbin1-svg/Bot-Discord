const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http'); // dacă folosești serverul HTTP pe Render
const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
} = require('discord.js');

const TOKEN = process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const FILE_PATH = path.join(__dirname, 'warnings.json');

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// 1. AICI PUI CELE DOUĂ COMENZI SLASH (/staffwarn și /playerwarn)
const commands = [
  new SlashCommandBuilder()
    .setName('staffwarn')
    .setDescription('Oferă un avertisment de staff (1/3, 2/3, 3/3)')
    .addUserOption((option) =>
      option
        .setName('utilizator')
        .setDescription('Membrul staff avertizat')
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('motiv')
        .setDescription('Motivul avertismentului')
        .setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('playerwarn')
    .setDescription('Oferă un avertisment de player (1/3, 2/3, 3/3)')
    .addUserOption((option) =>
      option
        .setName('utilizator')
        .setDescription('Jucătorul avertizat')
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('motiv')
        .setDescription('Motivul avertismentului')
        .setRequired(true)
    ),
].map((cmd) => cmd.toJSON());

function loadWarnings() {
  if (!fs.existsSync(FILE_PATH)) {
    fs.writeFileSync(FILE_PATH, '{}', 'utf8');
  }
  return JSON.parse(fs.readFileSync(FILE_PATH, 'utf8'));
}

function saveWarnings(data) {
  fs.writeFileSync(FILE_PATH, JSON.stringify(data, null, 2), 'utf8');
}

client.once('ready', async () => {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
      body: commands,
    });
    console.log(`Botul este online ca ${client.user.tag}`);
  } catch (err) {
    console.error('Eroare la înregistrarea comenzilor:', err);
  }
});

// 2. AICI PUI RĂSPUNSUL CU EMBED ȘI NUMĂRAREA 1/3, 2/3, 3/3
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const isStaff = interaction.commandName === 'staffwarn';
  const isPlayer = interaction.commandName === 'playerwarn';
  if (!isStaff && !isPlayer) return;

  const type = isStaff ? 'staff' : 'player';
  const label = isStaff ? 'Staff' : 'Player';
  const targetUser = interaction.options.getUser('utilizator');
  const reason = interaction.options.getString('motiv');

  const data = loadWarnings();
  const key = `${type}_${interaction.guildId}_${targetUser.id}`;
  const currentCount = data[key]?.count || 0;

  if (currentCount >= 3) {
    const limitEmbed = new EmbedBuilder()
      .setColor('#991b1b')
      .setTitle(`⛔ Limită atinsă — ${label} Warn (3/3)`)
      .setDescription(`${targetUser} are deja **3/3** avertismente de tip **${label}**.`)
      .setTimestamp();

    return interaction.reply({ embeds: [limitEmbed], ephemeral: true });
  }

  const nextCount = currentCount + 1;
  data[key] = {
    count: nextCount,
    lastReason: reason,
    updatedAt: new Date().toISOString(),
  };
  saveWarnings(data);

  const color = isStaff
    ? nextCount === 3
      ? '#dc2626'
      : '#f59e0b'
    : nextCount === 3
      ? '#e11d48'
      : '#3b82f6';

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`⚠️ Avertisment ${label} (${nextCount}/3)`)
    .addFields(
      { name: 'Utilizator', value: `${targetUser}`, inline: true },
      { name: 'Avertismente', value: `**${nextCount}/3**`, inline: true },
      { name: 'Sancționat de', value: `${interaction.user}`, inline: true },
      { name: 'Motiv', value: reason, inline: false }
    )
    .setFooter({ text: `RedLine Life EHMR • ${label} Warning System` })
    .setTimestamp();

  await interaction.reply({ embeds: [embed] });
});

// Server HTTP pentru Render (dacă nu îl ai deja mai jos în fișier)
const PORT = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Bot is running');
  })
  .listen(PORT);

client.login(TOKEN);
