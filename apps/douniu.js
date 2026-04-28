import plugin from '../../../lib/plugins/plugin.js'
import { helpScreenshot } from '../model/render.js'
import * as Game from '../games/douniu/engine.js'
import { renderGame } from '../games/douniu/render.js'

export class Douniu extends plugin {
  constructor() {
    super({
      name: '斗牛',
      dsc: '斗牛（牛牛）扑克牌游戏',
      event: 'message',
      priority: 500,
      rule: [
        { reg: /^#?(斗牛|牛牛)$/, fnc: 'create' },
        { reg: /^#?加入斗牛$/, fnc: 'join' },
        { reg: /^#?退出斗牛$/, fnc: 'quit' },
        { reg: /^#?开始斗牛$/, fnc: 'start' },
        { reg: /^#?斗牛下注\s*\d+$/, fnc: 'bet' },
        { reg: /^#?斗牛默认下注$/, fnc: 'defaultBet' },
        { reg: /^#?斗牛结束$/, fnc: 'end' },
        { reg: /^#?斗牛状态$/, fnc: 'status' },
        { reg: /^#?斗牛帮助$/, fnc: 'help' },
        { reg: /^#?斗牛再来一局$/, fnc: 'newRound' },
      ],
    })
  }

  async create(e) {
    if (!e.isGroup) return e.reply('请在群聊中发起游戏', true)
    const nickname = e.sender?.card || e.sender?.nickname || String(e.user_id)
    const r = Game.createGame(e.group_id, String(e.user_id), nickname)
    if (r.error) return e.reply(r.error, true)
    await this.render(e, r.game)
    return true
  }

  async join(e) {
    if (!e.isGroup) return e.reply('请在群聊中加入游戏', true)
    const nickname = e.sender?.card || e.sender?.nickname || String(e.user_id)
    const r = Game.addPlayer(e.group_id, String(e.user_id), nickname)
    if (r.error) return e.reply(r.error, true)
    await this.render(e, r.game)
    return true
  }

  async quit(e) {
    if (!e.isGroup) return false
    const r = Game.removePlayer(e.group_id, String(e.user_id))
    if (r.error) return e.reply(r.error, true)
    if (r.dismissed) return e.reply('发起人退出，游戏已取消')
    await this.render(e, r.game)
    return true
  }

  async start(e) {
    if (!e.isGroup) return false
    const r = Game.startBetting(e.group_id, String(e.user_id))
    if (r.error) return e.reply(r.error, true)
    await this.render(e, r.game)
    return true
  }

  async bet(e) {
    if (!e.isGroup) return false
    const game = Game.getGame(e.group_id)
    if (!game) return false
    if (game.state === Game.STATE.ENDED) return e.reply('本轮已结束，请发送 #斗牛再来一局', true)
    const m = e.msg.match(/\d+/)
    const amount = m ? Number(m[0]) : 0
    if (!amount || amount <= 0) return e.reply('请输入有效下注金额，例如 #斗牛下注 50', true)
    const r = Game.placeBet(e.group_id, String(e.user_id), amount)
    if (r.error) return e.reply(r.error, true)
    await this.render(e, r.game)
    return true
  }

  async defaultBet(e) {
    if (!e.isGroup) return false
    const game = Game.getGame(e.group_id)
    if (!game) return false
    if (game.state === Game.STATE.ENDED) return e.reply('本轮已结束，请发送 #斗牛再来一局', true)
    const r = Game.placeBet(e.group_id, String(e.user_id), game.config.defaultBet)
    if (r.error) return e.reply(r.error, true)
    await this.render(e, r.game)
    return true
  }

  async end(e) {
    if (!e.isGroup) return false
    const game = Game.getGame(e.group_id)
    if (!game) return e.reply('本群没有进行中的游戏', true)
    if (String(e.user_id) != game.initiator && !e.isMaster)
      return e.reply('只有发起人或主人可以强制结束', true)
    Game.endGame(e.group_id)
    return e.reply('游戏已结束')
  }

  async status(e) {
    if (!e.isGroup) return false
    const game = Game.getGame(e.group_id)
    if (!game) return e.reply('本群没有进行中的游戏', true)
    await this.render(e, game)
    return true
  }

  async newRound(e) {
    if (!e.isGroup) return false
    const game = Game.getGame(e.group_id)
    if (!game || game.state !== Game.STATE.ENDED) return false
    const r = Game.newRound(e.group_id)
    if (r.error) return e.reply(r.error, true)
    await this.render(e, r.game)
    return true
  }

  async help(e) {
    try {
      const img = await helpScreenshot('douniu')
      if (img) return e.reply(img)
      return e.reply('帮助图片渲染失败', true)
    } catch (err) {
      logger?.error(`[卡牌游戏·斗牛] 帮助渲染失败`, err)
      return e.reply('帮助图片渲染失败：' + (err?.message || err), true)
    }
  }

  async render(e, game) {
    try {
      const img = await renderGame(game)
      if (img) await e.reply(img)
    } catch (err) {
      logger?.error(`[卡牌游戏·斗牛] 渲染失败`, err)
      await e.reply('图片渲染失败：' + (err?.message || err), true)
    }
  }
}

// ======== External Tick ========

Game.setExternalTick(async (game, type, extra) => {
  try {
    if (!game.groupId) return
    const g = Bot.pickGroup?.(game.groupId)
    if (!g?.sendMsg) return

    if (type === 'wait-timeout') {
      await g.sendMsg('等待超时，本局斗牛已自动结束。发 #斗牛 重新发起')
      return
    }
    if (type === 'turn-warn') {
      const notBet = game.players.filter(p => p.currentBet === 0)
      if (notBet.length) {
        const parts = notBet.flatMap(p => [segment.at(p.userId), ' '])
        parts.push(`还有 ${extra?.secondsLeft ?? 15} 秒下注，超时将自动使用默认下注`)
        await g.sendMsg(parts)
      }
      return
    }

    const img = await renderGame(game)
    if (img) await g.sendMsg(img)
  } catch (err) {
    logger?.error(`[卡牌游戏·斗牛] 超时自动推进发送失败`, err)
  }
})
