# Mineflayer-Kitbot

A kitbot for Minecraft to deliver shulkers to players on Anarchy servers that support Teleport.  This is a basic kitbot that will deliver one type of kit and send discord notifications.

 As this bot is extremely basic, it will only go to the coordinates you define to get a kit.  It will assume it get's a kit once it gets there, then sends a tp.  You must setup a Dropper with a pressure plate to push a kit out to the bot.

**This kitbot does not log coordinates, you'll need a different tool if that's your goal**

## Requirements

* NodeJs
* Minecraft account with Microsoft Auth

## Installation

* First install Node.js >= 17 from [nodejs.org](https://nodejs.org/)
* [Download](https://github.com/PrismarineJS/mineflayer/archive/refs/heads/master.zip) the kitbot
* Extract the .zip archive

## Usage
  To use the bot, you must configure the bot.  This walks you through the basic sets of the one-time configurations.  As well, after you perform the Microsoft login, you do not need to login each time you start the bot, kinda nifty; Thanks Mineflayer.

* From a Command Prompt or Terminal, Install the required packages
   ```
   npm install
   ```
   * If the command fails with npm not found, your node.js is not installed correctly.
* Rename `config.sample.json` to `config.json`
* Open `config.json` and be sure to set the values
  * email
    * Microsoft Minecraft E-Mail address
  * channelID
    * Discord channel ID for notifications
  * server
    * Minecraft server address
  * server_version
    * Server Version, ie, 1.12.2
  * kit_pos_x
    * X Location of the kit pressure plate
  * kit_pos_y
    * Y Location of the kit pressure plate
  * bed_pos_x
    * X Location of the bed respawn point
  * token
    * Discord token
  * whitelist_uuid
    * Owner's Minecraft UUID 
* Set up your kitbot home.
  You must setup a dropper and pressure plate to deliver the kit to the bot. Here is an example of simple setup.
  ![RedstoneSetup](https://i.imgur.com/k2OJw4j.png)

* Set the home/respawn point so the bot respawns, then walks forward to the pressure plate for best results.  
Edit config.json
* Run the bot
  ``` 
  node index.js
  ```
* Enjoy a cat [gif](https://cataas.com/cat/gif)


## Credits
This bot is dependent on [Mineflayer](https://github.com/PrismarineJS/mineflayer)
