import plugin from '../../../lib/plugins/plugin.js'
import { helpScreenshot } from '../model/render.js'
import * as Game from '../games/blackjack/engine.js'
import { renderGame } from '../games/blackjack/render.js'

export class Blackjack extends plugin {
  constructor() {
    super({
      name: '21点',
      dsc: '21点扑克牌游戏',
      event: 'message',
      priority: 400,
      rule: [
        { reg: /^#?(21(点)?|发起21点|blackjack)$/i, fnc: 'create' },
        { reg: /^#?加入21点$/, fnc: 'join' },
        { reg: /^#?退出21点$/, fnc: 'quit' },
        { reg: /^#?开始21点$/, fnc: 'start' },
        { reg: /^#?下注\s*\d+$/, fnc: 'bet' },
        { reg: /^#?默认下注$/, fnc: 'defaultBet' },
        { reg: /^#?叫牌$/, fnc: 'hit' },
        { reg: /^#?停牌$/, fnc: 'stand' },
        { reg: /^#?双倍$/, fnc: 'doubleDown' },
        { reg: /^#?保险$/, fnc: 'insurance' },
        { reg: /^#?21点结束$/, fnc: 'end' },
        { reg: /^#?21点状态$/, fnc: 'status' },
        { reg: /^#?21点帮助$/, fnc: 'help' },
        { reg: /^#?再来一局$/, fnc: 'newRound' },
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
    if (!game || game.state !== Game.STATE.BETTING) return false
    const m = e.msg.match(/\d+/)
    const amount = m ? Number(m[0]) : 0
    if (!amount || amount <= 0) return e.reply('请输入有效下注金额，例如 #下注 50', true)
    const r = Game.placeBet(e.group_id, String(e.user_id), amount)
    if (r.error) return e.reply(r.error, true)
    await this.render(e, r.game)
    return true
  }

  async defaultBet(e) {
    if (!e.isGroup) return false
    const game = Game.getGame(e.group_id)
    if (!game || game.state !== Game.STATE.BETTING) return false
    const r = Game.placeBet(e.group_id, String(e.user_id), game.config.defaultBet)
    if (r.error) return e.reply(r.error, true)
    await this.render(e, r.game)
    return true
  }

  async hit(e) {
    if (!e.isGroup) return false
    const game = Game.getGame(e.group_id)
    if (!game) return false
    const thinkingMsg = await e.reply('正在摸牌...', true)
    setTimeout(async () => {
      try {
        const g = Bot.pickGroup?.(e.group_id)
        if (g && thinkingMsg?.message_id) await g.recallMsg(thinkingMsg.message_id)
      } catch {}
    }, 15000)
    const r = Game.hit(e.group_id, String(e.user_id))
    if (r.error) return e.reply(r.error, true)
    await this.render(e, r.game)
    return true
  }

  async stand(e) {
    if (!e.isGroup) return false
    const game = Game.getGame(e.group_id)
    if (!game) return false
    const r = Game.stand(e.group_id, String(e.user_id))
    if (r.error) return e.reply(r.error, true)
    await this.render(e, r.game)
    return true
  }

  async doubleDown(e) {
    if (!e.isGroup) return false
    const game = Game.getGame(e.group_id)
    if (!game) return false
    const r = Game.doubleDown(e.group_id, String(e.user_id))
    if (r.error) return e.reply(r.error, true)
    await this.render(e, r.game)
    return true
  }

  async insurance(e) {
    if (!e.isGroup) return false
    const game = Game.getGame(e.group_id)
    if (!game) return false
    const r = Game.insurance(e.group_id, String(e.user_id))
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
      const img = await helpScreenshot('blackjack')
      if (img) return e.reply(img)
      return e.reply('帮助图片渲染失败', true)
    } catch (err) {
      logger?.error(`[卡牌游戏·21点] 帮助渲染失败`, err)
      return e.reply('帮助图片渲染失败：' + (err?.message || err), true)
    }
  }

  async render(e, game) {
    try {
      const img = await renderGame(game)
      if (img) await e.reply(img)
    } catch (err) {
      logger?.error(`[卡牌游戏·21点] 渲染失败`, err)
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
      await g.sendMsg('等待超时，本局21点已自动结束。发 #21点 重新发起')
      return
    }
    if (type === 'turn-warn') {
      const playingPlayers = game.players.filter(p => p.status === 'playing')
      if (playingPlayers.length && game.currentPlayerIdx < playingPlayers.length) {
        const current = playingPlayers[game.currentPlayerIdx]
        await g.sendMsg([
          segment.at(current.userId),
          ` 还有 ${extra?.secondsLeft ?? 15} 秒操作，超时将自动停牌`,
        ])
      }
      return
    }

    const img = await renderGame(game)
    if (img) await g.sendMsg(img)
  } catch (err) {
    logger?.error(`[卡牌游戏·21点] 超时自动推进发送失败`, err)
  }
})
