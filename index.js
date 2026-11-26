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

const CONFIG = {
  token: process.env.TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID,
  port: Number(process.env.PORT) || 3000,
  dataDir: process.env.DATA_DIR || __dirname,
  fileName: 'warnings.json',
  maxWarnings: 3,
  footerText: 'RedLine Life EHMR • Moderation & Warning System',
};

const FILE_PATH = path.join(CONFIG.dataDir, CONFIG.fileName);

// ID-urile rolurilor de Warn staff (1/3, 2/3, 3/3)
const STAFF_ROLE_MAP = {
  1: '1565014816350011422',
  2: '1565014817511837786',
  3: '1565014818958610533',
};

// Opțional: poți adăuga aici ID-urile rolurilor de Player Warn (1/3, 2/3, 3/3)
const PLAYER_ROLE_MAP = {};

const COLORS = {
  warnLow: '#f59e0b',
  warnHigh: '#dc2626',
  playerLow: '#3b82f6',
  playerHigh: '#e11d48',
  ban: '#b91c1c',
  success: '#22c55e',
  limit: '#991b1b',
};

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

process.on('unhandledRejection', (err) => {
  console.error('[UNHANDLED REJECTION]:', err);
});

process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT EXCEPTION]:', err);
});

function buildSlashCommands() {
  const staffWarnCmd = new SlashCommandBuilder()
    .setName('staffwarn')
    .setDescription('Oferă un avertisment de staff (1/3, 2/3, 3/3) și dă gradul de Warn staff')
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
    );

  const playerWarnCmd = new SlashCommandBuilder()
    .setName('playerwarn')
    .setDescription('Oferă un avertisment de player (1/3, 2/3, 3/3) după numele de Roblox')
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
        .setDescription('Opțional: alege direct contul de Discord')
        .setRequired(false)
    );

  const robloxBanCmd = new SlashCommandBuilder()
    .setName('robloxban')
    .setDescription('Înregistrează un ban pe Roblox (RO) cu nume, timp și dovadă')
    .addStringOption((option) =>
      option
        .setName('roblox')
        .setDescription('Numele de pe Roblox al jucătorului banat')
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('timp')
        .setDescription('Durata banului (ex: 7 zile, 30 zile, Permanent)')
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('dovada')
        .setDescription('Link dovadă (SS/video) sau descrierea dovezii')
        .setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('motiv')
        .setDescription('Opțional: motivul banului')
        .setRequired(false)
    )
    .addUserOption((option) =>
      option
        .setName('membru_discord')
        .setDescription('Opțional: alege contul de Discord')
        .setRequired(false)
    );

  const removeWarnCmd = new SlashCommandBuilder()
    .setName('removewarn')
    .setDescription('Scoate un avertisment de staff sau de player')
    .addSubcommand((sub) =>
      sub
        .setName('staff')
        .setDescription('Scoate un avertisment de staff și scoate rolul de Warn staff')
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
            .setDescription('Opțional: alege contul de Discord')
            .setRequired(false)
        )
    );

  return [staffWarnCmd, playerWarnCmd, robloxBanCmd, removeWarnCmd].map((cmd) => cmd.toJSON());
}

function ensureStorageReady() {
  if (!fs.existsSync(CONFIG.dataDir)) {
    fs.mkdirSync(CONFIG.dataDir, { recursive: true });
  }
  if (!fs.existsSync(FILE_PATH)) {
    fs.writeFileSync(FILE_PATH, JSON.stringify({}, null, 2), 'utf8');
  }
}

function loadWarnings() {
  ensureStorageReady();
  try {
    const raw = fs.readFileSync(FILE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    console.error('[STORAGE ERROR] Nu s-a putut citi warnings.json, se folosește obiect gol:', err);
    return {};
  }
}

function saveWarnings(data) {
  ensureStorageReady();
  fs.writeFileSync(FILE_PATH, JSON.stringify(data, null, 2), 'utf8');
  console.log(`[STORAGE SAVED] ${FILE_PATH} | Total înregistrări: ${Object.keys(data).length}`);
}

function getStaffKey(guildId, userId) {
  return `staff_${guildId}_${userId}`;
}

function getPlayerKey(guildId, robloxName) {
  return `player_${guildId}_${robloxName.trim().toLowerCase()}`;
}

function getRobloxBanKey(guildId, robloxName) {
  return `robloxban_${guildId}_${robloxName.trim().toLowerCase()}`;
}

async function safeFetchMember(guild, userId) {
  if (!guild || !userId) return null;
  return guild.members.fetch(userId).catch(() => null);
}

function detectStaffWarnCountFromRoles(member) {
  if (!member || !member.roles || !member.roles.cache) return 0;
  if (member.roles.cache.has(STAFF_ROLE_MAP[3])) return 3;
  if (member.roles.cache.has(STAFF_ROLE_MAP[2])) return 2;
  if (member.roles.cache.has(STAFF_ROLE_MAP[1])) return 1;
  return 0;
}

async function applyStaffWarnRoleOnAdd(member, nextCount) {
  if (!member) return 'Membru negăsit pe server';

  const roleId = STAFF_ROLE_MAP[nextCount];
  if (!roleId) {
    return 'Lipsă ID rol în STAFF_ROLE_MAP';
  }

  for (const [level, id] of Object.entries(STAFF_ROLE_MAP)) {
    if (Number(level) !== nextCount && id && member.roles.cache.has(id)) {
      await member.roles.remove(id).catch((err) => {
        console.error(`[ROLE REMOVE ERROR] Nivel ${level}:`, err);
      });
    }
  }

  try {
    await member.roles.add(roleId);
    return `<@&${roleId}>`;
  } catch (err) {
    console.error('[ROLE ADD ERROR] Staff warn:', err);
    return `Eroare permisiuni/ierarhie: ${err.message}`;
  }
}

async function syncStaffWarnRoleOnRemove(member, newCount) {
  if (!member) return 'Membru negăsit pe server';

  const removedRoles = [];
  for (const roleId of Object.values(STAFF_ROLE_MAP)) {
    if (roleId && member.roles.cache.has(roleId)) {
      await member.roles.remove(roleId).catch((err) => {
        console.error('[ROLE REMOVE ERROR] Staff warn:', err);
      });
      removedRoles.push(`<@&${roleId}>`);
    }
  }

  if (newCount <= 0) {
    return removedRoles.length > 0
      ? `Scos: ${removedRoles.join(', ')} (0/3)`
      : 'Fără rol Warn staff (0/3)';
  }

  const nextRoleId = STAFF_ROLE_MAP[newCount];
  if (!nextRoleId) {
    return 'Lipsă ID rol în STAFF_ROLE_MAP';
  }

  try {
    await member.roles.add(nextRoleId);
    return `<@&${nextRoleId}> (actualizat)`;
  } catch (err) {
    console.error('[ROLE SYNC ERROR] Staff warn remove:', err);
    return `Eroare permisiuni/ierarhie: ${err.message}`;
  }
}

async function findDiscordMemberForRoblox(guild, robloxName, explicitUser) {
  if (!guild) return null;
  if (explicitUser) {
    return safeFetchMember(guild, explicitUser.id);
  }

  const target = robloxName.trim().toLowerCase();
  const members = await guild.members.fetch({ time: 5000 }).catch(() => null);
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
  if (!roleId) {
    return 'Fără rol configurat pentru player';
  }

  const prevRoleId = PLAYER_ROLE_MAP[nextCount - 1];
  if (prevRoleId && member.roles.cache.has(prevRoleId)) {
    await member.roles.remove(prevRoleId).catch((err) => {
      console.error('[PLAYER ROLE REMOVE ERROR]:', err);
    });
  }

  try {
    await member.roles.add(roleId);
    return `<@&${roleId}>`;
  } catch (err) {
    console.error('[PLAYER ROLE ADD ERROR]:', err);
    return `Eroare permisiuni/ierarhie: ${err.message}`;
  }
}

async function syncPlayerWarnRoleAfterRemove(guild, member, newCount) {
  if (!guild || !member) return 'Membru negăsit pe server';

  for (const roleId of Object.values(PLAYER_ROLE_MAP)) {
    if (roleId && member.roles.cache.has(roleId)) {
      await member.roles.remove(roleId).catch((err) => {
        console.error('[PLAYER ROLE SYNC REMOVE ERROR]:', err);
      });
    }
  }

  if (newCount <= 0) {
    return 'Fără rol de Warn (0/3)';
  }

  const nextRoleId = PLAYER_ROLE_MAP[newCount];
  if (!nextRoleId) {
    return 'Fără rol configurat pentru player';
  }

  try {
    await member.roles.add(nextRoleId);
    return `<@&${nextRoleId}>`;
  } catch (err) {
    console.error('[PLAYER ROLE SYNC ADD ERROR]:', err);
    return `Eroare permisiuni/ierarhie: ${err.message}`;
  }
}

function findPlayerWarningEntry(data, guildId, robloxInput) {
  const normalized = robloxInput.trim().toLowerCase();
  const exactKey = getPlayerKey(guildId, normalized);
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

async function handleStaffWarn(interaction, data) {
  const targetUser = interaction.options.getUser('utilizator');
  const reason = interaction.options.getString('motiv').trim();

  const member = await safeFetchMember(interaction.guild, targetUser.id);
  const key = getStaffKey(interaction.guildId, targetUser.id);

  const fileCount = data[key]?.count || 0;
  const roleCount = detectStaffWarnCountFromRoles(member);
  const currentCount = Math.max(fileCount, roleCount);

  if (currentCount >= CONFIG.maxWarnings) {
    const limitEmbed = new EmbedBuilder()
      .setColor(COLORS.limit)
      .setTitle(`⛔ Limită atinsă — Warn staff (${CONFIG.maxWarnings}/${CONFIG.maxWarnings})`)
      .setDescription(
        `${targetUser} are deja **${CONFIG.maxWarnings}/${CONFIG.maxWarnings}** avertismente de tip **Warn staff**.`
      )
      .setTimestamp();

    return interaction.editReply({ embeds: [limitEmbed] });
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

  const staffRoleStatus = await applyStaffWarnRoleOnAdd(member, nextCount);

  const embed = new EmbedBuilder()
    .setColor(nextCount === CONFIG.maxWarnings ? COLORS.warnHigh : COLORS.warnLow)
    .setTitle(`⚠️ Warn staff (${nextCount}/${CONFIG.maxWarnings})`)
    .addFields(
      { name: 'Membru Discord', value: `${targetUser}`, inline: true },
      { name: 'Avertismente', value: `**${nextCount}/${CONFIG.maxWarnings}**`, inline: true },
      { name: 'Sancționat de', value: `${interaction.user}`, inline: true },
      { name: 'Motiv', value: reason, inline: false },
      { name: 'Grad acordat', value: staffRoleStatus, inline: true }
    )
    .setFooter({ text: CONFIG.footerText })
    .setTimestamp();

  return interaction.editReply({ embeds: [embed] });
}

async function handlePlayerWarn(interaction, data) {
  const robloxName = interaction.options.getString('roblox').trim();
  const reason = interaction.options.getString('motiv').trim();
  const explicitUser = interaction.options.getUser('membru_discord');

  const key = getPlayerKey(interaction.guildId, robloxName);
  const currentCount = data[key]?.count || 0;

  if (currentCount >= CONFIG.maxWarnings) {
    const limitEmbed = new EmbedBuilder()
      .setColor(COLORS.limit)
      .setTitle(`⛔ Limită atinsă — Player Warn (${CONFIG.maxWarnings}/${CONFIG.maxWarnings})`)
      .setDescription(
        `Jucătorul de Roblox **${robloxName}** are deja **${CONFIG.maxWarnings}/${CONFIG.maxWarnings}** avertismente.`
      )
      .setTimestamp();

    return interaction.editReply({ embeds: [limitEmbed] });
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
    .setColor(nextCount === CONFIG.maxWarnings ? COLORS.playerHigh : COLORS.playerLow)
    .setTitle(`⚠️ Avertisment Player (${nextCount}/${CONFIG.maxWarnings})`)
    .addFields(
      { name: 'Jucător Roblox', value: `**${robloxName}**`, inline: true },
      { name: 'Avertismente', value: `**${nextCount}/${CONFIG.maxWarnings}**`, inline: true },
      { name: 'Sancționat de', value: `${interaction.user}`, inline: true },
      { name: 'Motiv', value: reason, inline: false },
      { name: 'Rol Warn', value: roleStatus, inline: true }
    )
    .setFooter({ text: CONFIG.footerText })
    .setTimestamp();

  if (matchedMember) {
    embed.addFields({ name: 'Membru Discord', value: `${matchedMember}`, inline: true });
  }

  return interaction.editReply({ embeds: [embed] });
}

async function handleRobloxBan(interaction, data) {
  const robloxName = interaction.options.getString('roblox').trim();
  const banTime = interaction.options.getString('timp').trim();
  const proof = interaction.options.getString('dovada').trim();
  const reason = interaction.options.getString('motiv')?.trim() || 'Nespecificat';
  const explicitUser = interaction.options.getUser('membru_discord');

  const key = getRobloxBanKey(interaction.guildId, robloxName);
  const matchedMember = await findDiscordMemberForRoblox(
    interaction.guild,
    robloxName,
    explicitUser
  );

  data[key] = {
    robloxUsername: robloxName,
    discordId: matchedMember?.id || data[key]?.discordId || null,
    duration: banTime,
    proof,
    reason,
    bannedById: interaction.user.id,
    bannedByTag: interaction.user.tag,
    region: 'RO',
    updatedAt: new Date().toISOString(),
  };
  saveWarnings(data);

  const embed = new EmbedBuilder()
    .setColor(COLORS.ban)
    .setTitle('🔨 Ban Roblox (RO)')
    .addFields(
      { name: 'Nume Roblox', value: `**${robloxName}**`, inline: true },
      { name: 'Timp / Durată', value: `**${banTime}**`, inline: true },
      { name: 'Dat de', value: `${interaction.user}`, inline: true },
      { name: 'Dovadă', value: proof, inline: false }
    )
    .setFooter({ text: 'RedLine Life EHMR • Roblox Ban Log (RO)' })
    .setTimestamp();

  if (reason !== 'Nespecificat') {
    embed.addFields({ name: 'Motiv', value: reason, inline: false });
  }

  if (matchedMember) {
    embed.addFields({ name: 'Membru Discord', value: `${matchedMember}`, inline: true });
  }

  return interaction.editReply({ embeds: [embed] });
}

async function handleRemoveStaffWarn(interaction, data) {
  const targetUser = interaction.options.getUser('utilizator');
  const member = await safeFetchMember(interaction.guild, targetUser.id);
  const key = getStaffKey(interaction.guildId, targetUser.id);

  const fileCount = data[key]?.count || 0;
  const roleCount = detectStaffWarnCountFromRoles(member);
  const currentCount = Math.max(fileCount, roleCount);
  const newCount = currentCount > 0 ? currentCount - 1 : 0;

  if (newCount === 0) {
    delete data[key];
  } else {
    data[key] = {
      ...(data[key] || {}),
      discordId: targetUser.id,
      discordTag: targetUser.tag,
      count: newCount,
      updatedAt: new Date().toISOString(),
    };
  }
  saveWarnings(data);

  const staffRoleStatus = await syncStaffWarnRoleOnRemove(member, newCount);

  const embed = new EmbedBuilder()
    .setColor(COLORS.success)
    .setTitle(`✅ Warn staff scos (${newCount}/${CONFIG.maxWarnings})`)
    .addFields(
      { name: 'Membru Discord', value: `${targetUser}`, inline: true },
      { name: 'Avertismente rămase', value: `**${newCount}/${CONFIG.maxWarnings}**`, inline: true },
      { name: 'Scos de', value: `${interaction.user}`, inline: true },
      { name: 'Status rol Warn staff', value: staffRoleStatus, inline: true }
    )
    .setFooter({ text: CONFIG.footerText })
    .setTimestamp();

  return interaction.editReply({ embeds: [embed] });
}

async function handleRemovePlayerWarn(interaction, data) {
  const robloxInput = interaction.options.getString('roblox').trim();
  const explicitUser = interaction.options.getUser('membru_discord');
  const { key, entry } = findPlayerWarningEntry(data, interaction.guildId, robloxInput);

  const currentCount = entry?.count || 0;
  const newCount = currentCount > 0 ? currentCount - 1 : 0;

  const savedDiscordId = entry?.discordId || null;
  const storedRobloxName = entry?.robloxUsername || robloxInput;

  let matchedMember = await findDiscordMemberForRoblox(
    interaction.guild,
    storedRobloxName,
    explicitUser
  );
  if (!matchedMember && savedDiscordId) {
    matchedMember = await safeFetchMember(interaction.guild, savedDiscordId);
  }

  if (newCount === 0) {
    delete data[key];
  } else {
    data[key] = {
      ...(entry || {}),
      robloxUsername: storedRobloxName,
      discordId: matchedMember?.id || savedDiscordId,
      count: newCount,
      updatedAt: new Date().toISOString(),
    };
  }
  saveWarnings(data);

  const roleStatus = matchedMember
    ? await syncPlayerWarnRoleAfterRemove(interaction.guild, matchedMember, newCount)
    : 'Nu a fost găsit membrul pe Discord';

  const embed = new EmbedBuilder()
    .setColor(COLORS.success)
    .setTitle(`✅ Avertisment Player scos (${newCount}/${CONFIG.maxWarnings})`)
    .addFields(
      { name: 'Jucător Roblox', value: `**${storedRobloxName}**`, inline: true },
      { name: 'Avertismente rămase', value: `**${newCount}/${CONFIG.maxWarnings}**`, inline: true },
      { name: 'Scos de', value: `${interaction.user}`, inline: true },
      { name: 'Rol Warn actual', value: roleStatus, inline: true }
    )
    .setFooter({ text: CONFIG.footerText })
    .setTimestamp();

  if (matchedMember) {
    embed.addFields({ name: 'Membru Discord', value: `${matchedMember}`, inline: true });
  }

  return interaction.editReply({ embeds: [embed] });
}

async function registerGuildCommands() {
  if (!CONFIG.token || !CONFIG.clientId || !CONFIG.guildId) {
    console.error('[CONFIG ERROR] Lipsesc TOKEN, CLIENT_ID sau GUILD_ID din variabilele de mediu.');
    return;
  }

  const rest = new REST({ version: '10' }).setToken(CONFIG.token);
  try {
    await rest.put(
      Routes.applicationGuildCommands(CONFIG.clientId, CONFIG.guildId),
      { body: buildSlashCommands() }
    );
    console.log(
      `[BOT READY] Conectat ca ${client.user.tag} | Comenzile slash sunt sincronizate | Storage: ${FILE_PATH}`
    );
  } catch (err) {
    console.error('[SLASH COMMAND REGISTER ERROR]:', err);
  }
}

function startKeepAliveServer() {
  http
    .createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('WarnBot Redline is running');
    })
    .listen(CONFIG.port, () => {
      console.log(`[HTTP SERVER] Ascultă pe portul ${CONFIG.port}`);
    });
}

client.once('clientReady', async () => {
  await registerGuildCommands();
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  await interaction.deferReply().catch(() => null);
  const data = loadWarnings();

  try {
    if (interaction.commandName === 'staffwarn') {
      return await handleStaffWarn(interaction, data);
    }

    if (interaction.commandName === 'playerwarn') {
      return await handlePlayerWarn(interaction, data);
    }

    if (interaction.commandName === 'robloxban') {
      return await handleRobloxBan(interaction, data);
    }

    if (interaction.commandName === 'removewarn') {
      const subcommand = interaction.options.getSubcommand();
      if (subcommand === 'staff') {
        return await handleRemoveStaffWarn(interaction, data);
      }
      if (subcommand === 'player') {
        return await handleRemovePlayerWarn(interaction, data);
      }
    }
  } catch (err) {
    console.error('[INTERACTION ERROR]:', err);
    if (interaction.deferred || interaction.replied) {
      await interaction
        .editReply({
          content: 'A apărut o eroare la procesarea comenzii.',
        })
        .catch(() => null);
    }
  }
});

startKeepAliveServer();
client.login(CONFIG.token);
