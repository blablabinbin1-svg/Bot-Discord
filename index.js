const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
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

// Înlocuiește cu ID-urile reale ale rolurilor de pe server (sau lasă 'ID_ROL_...' dacă nu vrei rol la acel nivel)
const ROLE_MAP = {
  staff: {
    1: 'ID_ROL_STAFF_WARN_1',
    2: 'ID_ROL_STAFF_WARN_2',
    3: 'ID_ROL_STAFF_WARN_3',
  },
  player: {
    1: 'ID_ROL_PLAYER_WARN_1',
    2: 'ID_ROL_PLAYER_WARN_2',
    3: 'ID_ROL_PLAYER_WARN_3',
  },
};

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

const commands = [
  new SlashCommandBuilder()
    .setName('staffwarn')
    .setDescription('Oferă un avertisment de staff pe Discord (1/3, 2/3, 3/3)')
    .addUserOption((option) =>
      option
        .setName('utilizator')
        .setDescription('Membrul staff de pe Discord')
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
    .setDescription('Oferă un avertisment de player după numele de Roblox (1/3, 2/3, 3/3)')
    .addStringOption((option) =>
      option
        .setName('roblox')
        .setDescription('Numele de pe Roblox al jucătorului')
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('motiv')
        .setDescription('Motivul avertismentului')
        .setRequired(true)
    )
    .addUserOption((option) =>
      option
        .setName('membru_discord')
        .setDescription('Opțional: contul de Discord pentru rolul de warn')
        .setRequired(false)
    ),
].map((cmd) => cmd.toJSON());

function loadWarnings() {
  if (!fs.existsSync(FILE_PATH)) {
    fs.writeFileSync(FILE_PATH, '{}', 'utf8');
  }
  try {
    return JSON.parse(fs.readFileSync(FILE_PATH, 'utf8'));
  } catch (err) {
    console.error('Eroare la citirea warnings.json, resetez obiectul:', err);
    return {};
  }
}

function saveWarnings(data) {
  fs.writeFileSync(FILE_PATH, JSON.stringify(data, null, 2), 'utf8');
}

async function applyWarnRole(guild, discordUser, type, nextCount) {
  if (!guild || !discordUser) return null;

  const roleId = ROLE_MAP[type]?.[nextCount];
  if (!roleId || roleId.startsWith('ID_ROL_')) return null;

  const member = await guild.members.fetch(discordUser.id).catch(() => null);
  if (!member) return 'Membru negăsit pe server';

  const prevRoleId = ROLE_MAP[type]?.[nextCount - 1];
  if (prevRoleId && !prevRoleId.startsWith('ID_ROL_') && member.roles.cache.has(prevRoleId)) {
    await member.roles.remove(prevRoleId).catch((err) => {
      console.error('Eroare la scoaterea rolului anterior:', err);
    });
  }

  try {
    await member.roles.add(roleId);
    return `<@&${roleId}>`;
  } catch (err) {
    console.error('Eroare la adăugarea rolului (verifică Manage Roles și ierarhia rolurilor):', err);
    return 'Eroare permisiuni/ierarhie';
  }
}

client.once('ready', async () => {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
      body: commands,
    });
    console.log(`Botul este online ca ${client.user.tag} și comenzile sunt înregistrate.`);
  } catch (err) {
    console.error('Eroare la înregistrarea comenzilor:', err);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const data = loadWarnings();

  // ================= /staffwarn (pe Discord) =================
  if (interaction.commandName === 'staffwarn') {
    const targetUser = interaction.options.getUser('utilizator');
    const reason = interaction.options.getString('motiv').trim();

    const key = `staff_${interaction.guildId}_${targetUser.id}`;
    const currentCount = data[key]?.count || 0;

    if (currentCount >= 3) {
      const limitEmbed = new EmbedBuilder()
        .setColor('#991b1b')
        .setTitle('⛔ Limită atinsă — Staff Warn (3/3)')
        .setDescription(`${targetUser} are deja **3/3** avertismente de tip **Staff**.`)
        .setTimestamp();

      return interaction.reply({ embeds: [limitEmbed], ephemeral: true });
    }

    const nextCount = currentCount + 1;
    data[key] = {
      discordId: targetUser.id,
      discordTag: targetUser.tag,
      count: nextCount,
      lastReason: reason,
      updatedAt: new Date().toISOString(),
    };
    saveWarnings(data);

    const roleStatus = await applyWarnRole(interaction.guild, targetUser, 'staff', nextCount);

    const embed = new EmbedBuilder()
      .setColor(nextCount === 3 ? '#dc2626' : '#f59e0b')
      .setTitle(`⚠️ Avertisment Staff (${nextCount}/3)`)
      .addFields(
        { name: 'Membru Discord', value: `${targetUser}`, inline: true },
        { name: 'Avertismente', value: `**${nextCount}/3**`, inline: true },
        { name: 'Sancționat de', value: `${interaction.user}`, inline: true },
        { name: 'Motiv', value: reason, inline: false }
      )
      .setFooter({ text: 'RedLine Life EHMR • Staff Warning System' })
      .setTimestamp();

    if (roleStatus) {
      embed.addFields({ name: 'Rol aplicat', value: roleStatus, inline: true });
    }

    return interaction.reply({ embeds: [embed] });
  }

  // ================= /playerwarn (pe nume de Roblox) =================
  if (interaction.commandName === 'playerwarn') {
    const robloxName = interaction.options.getString('roblox').trim();
    const robloxKey = robloxName.toLowerCase();
    const reason = interaction.options.getString('motiv').trim();
    const discordMember = interaction.options.getUser('membru_discord');

    const key = `player_${interaction.guildId}_${robloxKey}`;
    const currentCount = data[key]?.count || 0;

    if (currentCount >= 3) {
      const limitEmbed = new EmbedBuilder()
        .setColor('#991b1b')
        .setTitle('⛔ Limită atinsă — Player Warn (3/3)')
        .setDescription(`Jucătorul de Roblox **${robloxName}** are deja **3/3** avertismente.`)
        .setTimestamp();

      return interaction.reply({ embeds: [limitEmbed], ephemeral: true });
    }

    const nextCount = currentCount + 1;
    data[key] = {
      robloxUsername: robloxName,
      discordId: discordMember?.id || null,
      count: nextCount,
      lastReason: reason,
      updatedAt: new Date().toISOString(),
    };
    saveWarnings(data);

    const roleStatus = discordMember
      ? await applyWarnRole(interaction.guild, discordMember, 'player', nextCount)
      : null;

    const embed = new EmbedBuilder()
      .setColor(nextCount === 3 ? '#e11d48' : '#3b82f6')
      .setTitle(`⚠️ Avertisment Player (${nextCount}/3)`)
      .addFields(
        { name: 'Jucător Roblox', value: `**${robloxName}**`, inline: true },
        { name: 'Avertismente', value: `**${nextCount}/3**`, inline: true },
        { name: 'Sancționat de', value: `${interaction.user}`, inline: true },
        { name: 'Motiv', value: reason, inline: false }
      )
      .setFooter({ text: 'RedLine Life EHMR • Player Warning System (Roblox)' })
      .setTimestamp();

    if (discordMember) {
      embed.addFields({ name: 'Cont Discord', value: `${discordMember}`, inline: true });
    }
    if (roleStatus) {
      embed.addFields({ name: 'Rol aplicat', value: roleStatus, inline: true });
    }

    return interaction.reply({ embeds: [embed] });
  }
});

const PORT = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('WarnBot Redline is running');
  })
  .listen(PORT, () => {
    console.log(`Serverul HTTP ascultă pe portul ${PORT}`);
  });

client.login(TOKEN);
