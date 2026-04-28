import { update as Update } from '../../other/update.js'
import { helpScreenshot } from '../model/render.js'

export class CardGameUpdate extends plugin {
  constructor() {
    super({
      name: '卡牌游戏更新',
      dsc: '#卡牌更新 #卡牌强制更新 #卡牌帮助',
      event: 'message',
      priority: 1000,
      rule: [
        { reg: /^#?卡牌(游戏)?(强制)?更新$/, fnc: 'update', permission: 'master' },
        { reg: /^#?卡牌(游戏)?帮助$/, fnc: 'help' },
      ],
    })
  }

  async update(e = this.e) {
    e.isMaster = true
    e.msg = `#${e.msg.includes('强制') ? '强制' : ''}更新card-game-plugin`
    const up = new Update(e)
    up.e = e
    return up.update()
  }

  async help(e) {
    try {
      const img = await helpScreenshot(null)
      if (img) return e.reply(img)
      return e.reply('帮助图片渲染失败', true)
    } catch (err) {
      logger?.error(`[卡牌游戏] 帮助渲染失败`, err)
      return e.reply('帮助图片渲染失败：' + (err?.message || err), true)
    }
  }
}
