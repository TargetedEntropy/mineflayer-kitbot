# Mineflayer-Kitbot

A kitbot for Minecraft to deliver shulkers to players on Anarchy servers that support Teleport.

## Requirements

* NodeJs
* Minecraft account with Microsoft Auth

## Installation

* First install Node.js >= 17 from [nodejs.org](https://nodejs.org/)
* [Download](https://github.com/PrismarineJS/mineflayer/archive/refs/heads/master.zip) the kitbot
* Extract the .zip archive
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
    * X Location of the kit
  * kit_pos_y
    * Y Location of the kit
  * bed_pos_x
    * X Location of the bed respawn point
  * token
    * Discord token
  * whitelist_uuid
    * Owner's Minecraft UUID 
  
Edit config.json
* Run the bot

## Usage

```sh
node kitbot.js
```
