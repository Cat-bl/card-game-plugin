import { update as Update } from '../../other/update.js'

export class CardGameUpdate extends plugin {
  constructor() {
    super({
      name: '卡牌游戏更新',
      dsc: '#卡牌更新 #卡牌强制更新',
      event: 'message',
      priority: 1000,
      rule: [
        { reg: /^#?卡牌(游戏)?(强制)?更新$/, fnc: 'update', permission: 'master' },
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
}
