const config = require('./config.json')
const mineflayer = require('mineflayer')
const { listenerCount } = require('process')
const prefix = config.prefix
const { pathfinder, Movements } = require('mineflayer-pathfinder')
const { GoalXZ } = require('mineflayer-pathfinder').goals
const mcData = require('minecraft-data')('1.12.2')
const colors = require('colors')
// const prettyMilliseconds = require("pretty-ms");
const tpsPlugin = require('mineflayer-tps')(mineflayer)
const fetch = require('node-fetch')
const roundToHundredth = (value) => {
  return Number(value.toFixed(2))
}

// Discord
const Discord = require('discord.js')
const { Client, GatewayIntentBits } = require('discord.js')
const { Console } = require('console')

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessageTyping,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.DirectMessageReactions,
    GatewayIntentBits.DirectMessageTyping
  ]
})
client.commands = new Discord.Collection()
client.on('ready', () => {
  console.log('Kitbot online!'.blue)
  client.user.setActivity('Kitbot ', { type: 'PLAYING' })
})
client.login(config.token)

// Mineflayer setttings
const options = {
  host: `${config.server}`,
  port: 25565,
  username: `${config.email}`,
  auth: 'microsoft',
  version: `${config.server_version}`
}

const bot = mineflayer.createBot(options)

bindEvents(bot)
function bindEvents (bot) {
  //= ================
  // Console Login
  //= ================
  bot.once('login', () => {
    setTimeout(() => {
      console.log('──────────────────────────────────────────'.blue)
    }, 0)
    setTimeout(() => {
      console.log('Logged in as: '.green + `${bot.username}`.yellow)
    }, 1)
    setTimeout(() => {
      console.log('Server: '.green + `${options.host}`.yellow)
    }, 2)
    setTimeout(() => {
      console.log('Port: '.green + `${options.port}`.yellow)
    }, 3)
    setTimeout(() => {
      console.log('──────────────────────────────────────────'.blue)
    }, 4)
    client.channels.cache.get(config.channelID).send(`${bot.username} Online!`)
  })

  //= ================
  // Auto Relog
  //= ================
  bot.on('error', function (err) {
    console.log('Error attempting to reconnect: ' + err.errno + '.')
    if (err.code === undefined) {
      console.log(
        'Invalid credentials OR bot needs to wait because it relogged too quickly.'
      )
      console.log('Will retry to connect in 30 seconds. ')
      setTimeout(relog, 30000)
    }
  })
  bot.on('kicked', function (reason) {
    console.log(`Bot kicked for ${reason}`.red)
    setTimeout(relog, 30000)
  })
  bot.on('error', (err) => {
    console.error(err)
  })
  function relog () {
    client.destroy()
    console.log('Attempting to reconnect...')
    bot = mineflayer.createBot(options)
    bindEvents(bot)
    client.login(config.token)
  }

  //= ======================
  // UUID Function
  //= ======================
  function uuid (username, callback) {
    const dash = require('add-dashes-to-uuid')
    const MojangAPI = require('mojang-api')
    const date = new Date()
    MojangAPI.uuidAt(username, date, function (err, res) {
      if (err) console.log(err)
      else var dashuuid = dash(res.id)
      callback(dashuuid)
    })
  }

  //= ===============
  // Chat Patterns
  //= ===============
  bot.chatAddPattern(
    /^Teleported to ([a-zA-Z0-9_]{3,16})!$/,
    'tpaccepted',
    'tpa accepted'
  )
  bot.chatAddPattern(
    /^([a-zA-Z0-9_]{3,16}) wants to teleport to you\.$/,
    'tpRequest',
    'tpa request'
  )

  //= ======================
  // Tpa to bot
  //= ======================
  bot.on('tpRequest', function (username) {
    console.log('TP Request')
    if (config.whitelist_uuid.includes(username)) {
      client.channels.cache
        .get(config.channelID)
        .send(`${bot.username} is accepting TP Request from ${username}!`)
      return (
        bot.chat(`/msg ${username} Auto Accepting..`),
        bot.chat(`/tpy ${username}`)
      )
    }
  })

  //= =================
  // Whisper Function
  //= =================
  bot.loadPlugin(pathfinder)
  const defaultMove = new Movements(bot, mcData)

  bot.on('whisper', (username, message) => {
    if (!bot.players[username]) return
    // Log
    console.log(`${username} w> ${message}`)

    // Verify
    uuid(bot.username, (id) => {
      if (config.whitelist_uuid.includes(id)) {
        if (message === 'kill') {
          bot.chat(`/w ${username} Terminating Bot`)
          return bot.end()
        }

        if (message === 'tpa') {
          bot.chat(`/tpa ${username}`)
        }
      }
    })
  })

  //= ===========================
  // Kit Grabber
  //= ===========================
  bot.on('chat', function (username, message) {
    if (message === '!kit') {
      console.log(`Getting kit for ${username}`)
      const x = parseFloat(config.kit_pos_x, 10)
      const z = parseFloat(config.kit_pos_y, 10)
      p = username
      bot.pathfinder.setMovements(defaultMove)
      bot.pathfinder.setGoal(new GoalXZ(x, z))
      console.log('Navigating')
    }
  })

  //= ================
  // Tpa Event
  //= ================
  let p = ''
  bot.on('goal_reached', () => {
    bot.chat(`/tpa ${p}`)
    bot.pathfinder.setGoal(null)
  })

  //= ================
  // Kill on tp
  //= ================
  bot.on('tpaccepted', function (username) {
    setTimeout(() => {
      client.channels.cache
        .get(config.channelID)
        .send(`[Kit] Gave a kit to ${username}`)
    }, 500)
    bot.chat('/kill')
    console.log('bot /killed')

    setTimeout(() => {
      if (bot.entity.position.x !== config.bed_pos_x) {
        bot.chat('/kill')
        console.log('bot /killed by timer')
      }
    }, 15000)
  })
}
