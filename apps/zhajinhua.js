import plugin from '../../../lib/plugins/plugin.js'
import { helpScreenshot } from '../model/render.js'
import * as Game from '../games/zhajinhua/engine.js'
import { renderGame } from '../games/zhajinhua/render.js'

export class Zhajinhua extends plugin {
  constructor() {
    super({
      name: '炸金花',
      dsc: '炸金花（金花）扑克牌游戏',
      event: 'message',
      priority: 500,
      rule: [
        { reg: /^#?(炸?金花|金沙)$/, fnc: 'create' },
        { reg: /^#?加入炸?金花$/, fnc: 'join' },
        { reg: /^#?退出炸?金花$/, fnc: 'quit' },
        { reg: /^#?开始炸?金花$/, fnc: 'start' },
        { reg: /^#?看牌$/, fnc: 'peek' },
        { reg: /^#?跟注$/, fnc: 'callBet' },
        { reg: /^#?加注\s*\d*$/, fnc: 'raiseBet' },
        { reg: /^#?弃牌$/, fnc: 'foldHand' },
        { reg: /^#?比牌\s*/, fnc: 'compareHands' },
        { reg: /^#?炸?金花结束$/, fnc: 'end' },
        { reg: /^#?炸?金花状态$/, fnc: 'status' },
        { reg: /^#?炸?金花帮助$/, fnc: 'help' },
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
    const r = Game.startGame(e.group_id, String(e.user_id))
    if (r.error) return e.reply(r.error, true)
    await this.render(e, r.game)
    return true
  }

  async peek(e) {
    if (!e.isGroup) return false
    const game = Game.getGame(e.group_id)
    if (!game) return false
    const r = Game.peek(e.group_id, String(e.user_id))
    if (r.error) return e.reply(r.error, true)

    // 私发手牌给玩家
    if (r.action === 'peek' && r.peekPlayer) {
      try {
        const friend = Bot.pickFriend?.(r.peekPlayer.userId)
        if (friend?.sendMsg) {
          const cardNames = r.peekPlayer.hand
            .map(c => `${c.suit === 'heart' || c.suit === 'diamond' ? '红' : '黑'}${c.rank}${c.suit === 'spade' ? '♠' : c.suit === 'heart' ? '♥' : c.suit === 'diamond' ? '♦' : '♣'}`)
            .join('  ')
          const result = Game.evaluateHand(r.peekPlayer.hand)
          await friend.sendMsg([
            `🃏 你的手牌（炸金花）：\n`,
            `${cardNames}\n`,
            `牌型：${result.name}`,
          ].join(''))
        }
      } catch (err) {
        logger?.error(`[卡牌游戏·炸金花] 私发手牌失败`, err)
      }
    }

    await this.render(e, r.game)
    return true
  }

  async callBet(e) {
    if (!e.isGroup) return false
    const game = Game.getGame(e.group_id)
    if (!game) return false
    const r = Game.callBet(e.group_id, String(e.user_id))
    if (r.error) return e.reply(r.error, true)
    await this.render(e, r.game)
    return true
  }

  async raiseBet(e) {
    if (!e.isGroup) return false
    const game = Game.getGame(e.group_id)
    if (!game) return false
    const m = e.msg.match(/\d+/)
    const amount = m ? Number(m[0]) : 0
    if (!amount || amount <= 0) return e.reply('请输入有效加注金额，例如 #加注 30', true)
    const r = Game.raiseBet(e.group_id, String(e.user_id), amount)
    if (r.error) return e.reply(r.error, true)
    await this.render(e, r.game)
    return true
  }

  async foldHand(e) {
    if (!e.isGroup) return false
    const game = Game.getGame(e.group_id)
    if (!game) return false
    const r = Game.foldHand(e.group_id, String(e.user_id))
    if (r.error) return e.reply(r.error, true)
    await this.render(e, r.game)
    return true
  }

  async compareHands(e) {
    if (!e.isGroup) return false
    const game = Game.getGame(e.group_id)
    if (!game) return false

    // 从消息中提取 @ 目标
    let targetId = null
    if (e.message) {
      for (const seg of e.message) {
        if (seg.type === 'at' && seg.qq) {
          targetId = String(seg.qq)
          break
        }
      }
    }
    if (!targetId) return e.reply('请 @ 你要比牌的对象，例如 #比牌 @某人', true)

    const r = Game.compareHandsAction(e.group_id, String(e.user_id), targetId)
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
    if (!game) return false
    const r = Game.newRound(e.group_id)
    if (r.error) return e.reply(r.error, true)
    await this.render(e, r.game)
    return true
  }

  async help(e) {
    try {
      const img = await helpScreenshot('zhajinhua')
      if (img) return e.reply(img)
      return e.reply('帮助图片渲染失败', true)
    } catch (err) {
      logger?.error(`[卡牌游戏·炸金花] 帮助渲染失败`, err)
      return e.reply('帮助图片渲染失败：' + (err?.message || err), true)
    }
  }

  async render(e, game) {
    try {
      const img = await renderGame(game)
      if (img) await e.reply(img)
    } catch (err) {
      logger?.error(`[卡牌游戏·炸金花] 渲染失败`, err)
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
      await g.sendMsg('等待超时，本局炸金花已自动结束。发 #炸金花 重新发起')
      return
    }
    if (type === 'turn-warn') {
      const active = game.players.filter(p => !p.folded)
      if (active.length && game.currentPlayerIdx < active.length) {
        const current = active[game.currentPlayerIdx]
        await g.sendMsg([
          segment.at(current.userId),
          ` 还有 ${extra?.secondsLeft ?? 15} 秒操作，超时将自动弃牌`,
        ].join(''))
      }
      return
    }

    const img = await renderGame(game)
    if (img) await g.sendMsg(img)
  } catch (err) {
    logger?.error(`[卡牌游戏·炸金花] 超时自动推进发送失败`, err)
  }
})
