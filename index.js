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

// Pune aici ID-ul rolului de Staff Warn (sau lasă-l așa dacă nu vrei rol la staff warn)
const STAFF_WARN_ROLE_ID = 'ID_ROL_STAFF_WARN';

// ID-urile rolurilor de Warn pentru jucători (1/3, 2/3, 3/3)
const PLAYER_ROLE_MAP = {
  1: '1565014816350011422',
  2: '1565014817511837786',
  3: '1565014818958610533',
};

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

const commands = [
  new SlashCommandBuilder()
    .setName('staffwarn')
    .setDescription('Oferă un avertisment de staff pe Discord (1/3, 2/3, 3/3) și pune rolul de Staff Warn')
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
    .setDescription('Oferă un avertisment de player (1/3, 2/3, 3/3) și pune automat rolul de Warn')
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
        .setDescription('Opțional: alege direct contul de Discord pentru rolul de Warn')
        .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName('removewarn')
    .setDescription('Scoate un avertisment de staff sau de player')
    .addSubcommand((sub) =>
      sub
        .setName('staff')
        .setDescription('Scoate un avertisment de staff de pe un membru Discord')
        .addUserOption((option) =>
          option
            .setName('utilizator')
            .setDescription('Membrul staff de pe Discord')
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('player')
        .setDescription('Scoate un avertisment de player după numele de Roblox')
        .addStringOption((option) =>
          option
            .setName('roblox')
            .setDescription('Numele de pe Roblox al jucătorului')
            .setRequired(true)
        )
        .addUserOption((option) =>
          option
            .setName('membru_discord')
            .setDescription('Opțional: alege contul de Discord dacă vrei să actualizeze rolul')
            .setRequired(false)
        )
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

async function applyStaffWarnRole(guild, user, newCount) {
  if (!guild || !user) return 'Membru negăsit pe server';
  if (!STAFF_WARN_ROLE_ID || STAFF_WARN_ROLE_ID === 'ID_ROL_STAFF_WARN') {
    return 'Fără rol configurat';
  }

  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member) return 'Membru negăsit pe server';

  try {
    if (newCount > 0) {
      await member.roles.add(STAFF_WARN_ROLE_ID);
      return `<@&${STAFF_WARN_ROLE_ID}>`;
    }
    if (member.roles.cache.has(STAFF_WARN_ROLE_ID)) {
      await member.roles.remove(STAFF_WARN_ROLE_ID);
      return 'Rol scos (0/3)';
    }
    return 'Fără rol';
  } catch (err) {
    console.error('Eroare la modificarea rolului de Staff Warn:', err);
    return `Eroare permisiuni/ierarhie: ${err.message}`;
  }
}

async function findDiscordMemberForRoblox(guild, robloxName, explicitUser) {
  if (!guild) return null;
  if (explicitUser) {
    return guild.members.fetch(explicitUser.id).catch(() => null);
  }

  const target = robloxName.trim().toLowerCase();
  const members = await guild.members.fetch().catch(() => null);
  if (!members) return null;

  return (
    members.find(
      (m) =>
        m.user.username.toLowerCase() === target ||
        (m.user.globalName && m.user.globalName.toLowerCase() === target) ||
        (m.nickname && m.nickname.toLowerCase() === target) ||
        (m.nickname && m.nickname.toLowerCase().includes(target))
    ) || null
  );
}

async function applyAutoPlayerWarnRole(guild, member, nextCount) {
  if (!guild || !member) return 'Membru negăsit pe server';

  const roleId = PLAYER_ROLE_MAP[nextCount];
  if (!roleId) return 'Lipsă ID rol în PLAYER_ROLE_MAP';

  const prevRoleId = PLAYER_ROLE_MAP[nextCount - 1];
  if (prevRoleId && member.roles.cache.has(prevRoleId)) {
    await member.roles.remove(prevRoleId).catch((err) => {
      console.error('Eroare la scoaterea rolului anterior de Warn:', err);
    });
  }

  try {
    await member.roles.add(roleId);
    return `<@&${roleId}>`;
  } catch (err) {
    console.error('Eroare la adăugarea rolului automat:', err);
    return `Eroare permisiuni/ierarhie: ${err.message}`;
  }
}

async function syncPlayerWarnRoleAfterRemove(guild, member, prevCount, newCount) {
  if (!guild || !member) return 'Membru negăsit pe server';

  const oldRoleId = PLAYER_ROLE_MAP[prevCount];
  if (oldRoleId && member.roles.cache.has(oldRoleId)) {
    await member.roles.remove(oldRoleId).catch((err) => {
      console.error('Eroare la scoaterea rolului vechi de Warn:', err);
    });
  }

  if (newCount <= 0) {
    return 'Fără rol de Warn (0/3)';
  }

  const nextRoleId = PLAYER_ROLE_MAP[newCount];
  if (!nextRoleId) return 'Lipsă ID rol în PLAYER_ROLE_MAP';

  try {
    await member.roles.add(nextRoleId);
    return `<@&${nextRoleId}>`;
  } catch (err) {
    console.error('Eroare la actualizarea rolului după removewarn:', err);
    return `Eroare permisiuni/ierarhie: ${err.message}`;
  }
}

function findPlayerWarningEntry(data, guildId, robloxInput) {
  const normalized = robloxInput.trim().toLowerCase();
  const exactKey = `player_${guildId}_${normalized}`;
  if (data[exactKey]) {
    return { key: exactKey, entry: data[exactKey] };
  }

  const fallbackKey = Object.keys(data).find((k) => {
    if (!k.startsWith(`player_${guildId}_`)) return false;
    const item = data[k];
    const savedName = (item?.robloxUsername || '').trim().toLowerCase();
    return savedName === normalized || savedName.includes(normalized);
  });

  if (fallbackKey) {
    return { key: fallbackKey, entry: data[fallbackKey] };
  }

  return { key: exactKey, entry: null };
}

client.once('ready', async () => {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
      body: commands,
    });
    console.log(`Botul este online ca ${client.user.tag} și comenzile sunt gata.`);
  } catch (err) {
    console.error('Eroare la înregistrarea comenzilor:', err);
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const data = loadWarnings();

  // ================= /staffwarn =================
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

    const staffRoleStatus = await applyStaffWarnRole(interaction.guild, targetUser, nextCount);

    const embed = new EmbedBuilder()
      .setColor(nextCount === 3 ? '#dc2626' : '#f59e0b')
      .setTitle(`⚠️ Avertisment Staff (${nextCount}/3)`)
      .addFields(
        { name: 'Membru Discord', value: `${targetUser}`, inline: true },
        { name: 'Avertismente', value: `**${nextCount}/3**`, inline: true },
        { name: 'Sancționat de', value: `${interaction.user}`, inline: true },
        { name: 'Motiv', value: reason, inline: false },
        { name: 'Rol Staff Warn', value: staffRoleStatus, inline: true }
      )
      .setFooter({ text: 'RedLine Life EHMR • Staff Warning System' })
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }

  // ================= /playerwarn =================
  if (interaction.commandName === 'playerwarn') {
    const robloxName = interaction.options.getString('roblox').trim();
    const robloxKey = robloxName.toLowerCase();
    const reason = interaction.options.getString('motiv').trim();
    const explicitUser = interaction.options.getUser('membru_discord');

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
    const matchedMember = await findDiscordMemberForRoblox(
      interaction.guild,
      robloxName,
      explicitUser
    );

    data[key] = {
      robloxUsername: robloxName,
      discordId: matchedMember?.id || data[key]?.discordId || null,
      count: nextCount,
      lastReason: reason,
      updatedAt: new Date().toISOString(),
    };
    saveWarnings(data);

    const roleStatus = matchedMember
      ? await applyAutoPlayerWarnRole(interaction.guild, matchedMember, nextCount)
      : `Nu am găsit membrul pe Discord pentru "${robloxName}" (alege-l la membru_discord)`;

    const embed = new EmbedBuilder()
      .setColor(nextCount === 3 ? '#e11d48' : '#3b82f6')
      .setTitle(`⚠️ Avertisment Player (${nextCount}/3)`)
      .addFields(
        { name: 'Jucător Roblox', value: `**${robloxName}**`, inline: true },
        { name: 'Avertismente', value: `**${nextCount}/3**`, inline: true },
        { name: 'Sancționat de', value: `${interaction.user}`, inline: true },
        { name: 'Motiv', value: reason, inline: false },
        { name: 'Rol Warn', value: roleStatus, inline: true }
      )
      .setFooter({ text: 'RedLine Life EHMR • Player Warning System (Roblox)' })
      .setTimestamp();

    if (matchedMember) {
      embed.addFields({ name: 'Membru Discord', value: `${matchedMember}`, inline: true });
    }

    return interaction.reply({ embeds: [embed] });
  }

  // ================= /removewarn =================
  if (interaction.commandName === 'removewarn') {
    const subcommand = interaction.options.getSubcommand();

    if (subcommand === 'staff') {
      const targetUser = interaction.options.getUser('utilizator');
      const key = `staff_${interaction.guildId}_${targetUser.id}`;
      const currentCount = data[key]?.count || 0;

      if (currentCount <= 0) {
        return interaction.reply({
          content: `${targetUser} nu are avertismente înregistrate (0/3).`,
          ephemeral: true,
        });
      }

      const newCount = currentCount - 1;
      if (newCount === 0) {
        delete data[key];
      } else {
        data[key].count = newCount;
        data[key].updatedAt = new Date().toISOString();
      }
      saveWarnings(data);

      const staffRoleStatus = await applyStaffWarnRole(interaction.guild, targetUser, newCount);

      const embed = new EmbedBuilder()
        .setColor('#22c55e')
        .setTitle(`✅ Avertisment Staff scos (${newCount}/3)`)
        .addFields(
          { name: 'Membru Discord', value: `${targetUser}`, inline: true },
          { name: 'Avertismente rămase', value: `**${newCount}/3**`, inline: true },
          { name: 'Scos de', value: `${interaction.user}`, inline: true },
          { name: 'Rol Staff Warn', value: staffRoleStatus, inline: true }
        )
        .setFooter({ text: 'RedLine Life EHMR • Staff Warning System' })
        .setTimestamp();

      return interaction.reply({ embeds: [embed] });
    }

    if (subcommand === 'player') {
      const robloxInput = interaction.options.getString('roblox').trim();
      const explicitUser = interaction.options.getUser('membru_discord');
      const { key, entry } = findPlayerWarningEntry(data, interaction.guildId, robloxInput);
      const currentCount = entry?.count || 0;

      if (!entry || currentCount <= 0) {
        return interaction.reply({
          content: `Jucătorul de Roblox **${robloxInput}** nu are avertismente înregistrate (0/3).`,
          ephemeral: true,
        });
      }

      const newCount = currentCount - 1;
      const savedDiscordId = entry?.discordId || null;
      const storedRobloxName = entry?.robloxUsername || robloxInput;

      let matchedMember = await findDiscordMemberForRoblox(
        interaction.guild,
        storedRobloxName,
        explicitUser
      );
      if (!matchedMember && savedDiscordId) {
        matchedMember = await interaction.guild.members.fetch(savedDiscordId).catch(() => null);
      }

      if (newCount === 0) {
        delete data[key];
      } else {
        data[key].count = newCount;
        data[key].updatedAt = new Date().toISOString();
      }
      saveWarnings(data);

      const roleStatus = matchedMember
        ? await syncPlayerWarnRoleAfterRemove(
            interaction.guild,
            matchedMember,
            currentCount,
            newCount
          )
        : 'Nu a fost găsit membrul pe Discord';

      const embed = new EmbedBuilder()
        .setColor('#22c55e')
        .setTitle(`✅ Avertisment Player scos (${newCount}/3)`)
        .addFields(
          { name: 'Jucător Roblox', value: `**${storedRobloxName}**`, inline: true },
          { name: 'Avertismente rămase', value: `**${newCount}/3**`, inline: true },
          { name: 'Scos de', value: `${interaction.user}`, inline: true },
          { name: 'Rol Warn actual', value: roleStatus, inline: true }
        )
        .setFooter({ text: 'RedLine Life EHMR • Player Warning System (Roblox)' })
        .setTimestamp();

      if (matchedMember) {
        embed.addFields({ name: 'Membru Discord', value: `${matchedMember}`, inline: true });
      }

      return interaction.reply({ embeds: [embed] });
    }
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
