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
  const tplFile = gameType
    ? `./plugins/card-game-plugin/resources/html/${gameType}/help.html`
    : `./plugins/card-game-plugin/resources/html/help.html`
  return puppeteer.screenshot('card-game-plugin', {
    saveId: `${gameType || 'plugin'}-help`,
    imgType: 'png',
    tplFile,
  })
}
