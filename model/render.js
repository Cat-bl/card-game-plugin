import puppeteer from '../../../lib/puppeteer/puppeteer.js'

export function screenshot(gameType, saveId, data) {
  return puppeteer.screenshot('card-game-plugin', {
    saveId: `${gameType}-${saveId}`,
    imgType: 'png',
    tplFile: `./plugins/card-game-plugin/resources/html/${gameType}/chat.html`,
    _data: data,
  })
}

export function helpScreenshot(gameType) {
  return puppeteer.screenshot('card-game-plugin', {
    saveId: `${gameType}-help`,
    imgType: 'png',
    tplFile: `./plugins/card-game-plugin/resources/html/${gameType}/help.html`,
  })
}
