import Config from '../../model/config.js'
import { RANK_ORDER, SUIT_SYMBOL, SUIT_COLOR, cardValue, createDeck, shuffle, drawCard, formatCard } from '../../model/deck.js'

const games = {}

export const STATE = {
  WAITING: 'waiting',
  BETTING: 'betting',
  DEALING: 'dealing',
  SETTLEMENT: 'settlement',
  ENDED: 'ended',
}

let externalTick = null
export function setExternalTick(fn) { externalTick = fn }

function notify(game, type, extra) {
  try { externalTick?.(game, type, extra) } catch (err) {
    logger?.error(`[卡牌游戏·斗牛] tick 回调异常`, err)
  }
}

function clearTimer(game) {
  if (game?._timer) { clearTimeout(game._timer); game._timer = null }
  if (game?._warnTimer) { clearTimeout(game._warnTimer); game._warnTimer = null }
  if (game?._cleanupTimer) { clearTimeout(game._cleanupTimer); game._cleanupTimer = null }
}

function scheduleEndedCleanup(game) {
  if (game?._cleanupTimer) clearTimeout(game._cleanupTimer)
  game._cleanupTimer = setTimeout(() => {
    if (game.state === STATE.ENDED) {
      delete games[game.groupId]
    }
  }, 300000)
}

function getWarnBefore() {
  return Math.max(0, Number(Config.get().douniu?.warnBefore ?? 15))
}

function scheduleWaitTimeout(game) {
  clearTimer(game)
  const sec = Math.max(30, Number(Config.get().douniu?.waitTimeout ?? 300))
  game._timer = setTimeout(() => onWaitTimeout(game), sec * 1000)
}

function scheduleBetTimeout(game) {
  clearTimer(game)
  const sec = Math.max(15, Number(Config.get().douniu?.betTimeout ?? 60))
  const warn = getWarnBefore()
  game._timer = setTimeout(() => onBetTimeout(game), sec * 1000)
  if (warn > 0 && sec > warn) {
    game._warnTimer = setTimeout(() => {
      game._warnTimer = null
      if (game.state === STATE.BETTING) notify(game, 'turn-warn', { secondsLeft: warn })
    }, (sec - warn) * 1000)
  }
}

// ======== Hand Evaluation ========

// Hand result: { type, level, points, name }
// type: 'wuxiao' | 'bomb' | 'wuhua' | 'niuniu' | 'youNiu' | 'wuNiu'
// level: numeric for comparison (higher = better)

function evaluateHand(cards) {
  if (!cards?.length || cards.length !== 5) return { type: 'wuNiu', level: 0, points: 0, name: '无牛' }

  const ranks = cards.map(c => RANK_ORDER[c.rank])
  const suits = cards.map(c => c.suit)

  // 五小牛: all < 5 and total <= 10
  const allSmall = ranks.every(r => r <= 4)
  const totalSum = ranks.reduce((a, b) => a + b, 0)
  if (allSmall && totalSum <= 10) {
    return { type: 'wuxiao', level: 100, points: 0, name: '五小牛' }
  }

  // 炸弹: 4 of same rank
  const rankCount = {}
  for (const r of ranks) {
    rankCount[r] = (rankCount[r] || 0) + 1
  }
  for (const [rank, count] of Object.entries(rankCount)) {
    if (count >= 4) {
      return { type: 'bomb', level: 90, points: 0, name: '炸弹' }
    }
  }

  // 五花牛: all face cards (J/Q/K = 11/12/13)
  const allFace = ranks.every(r => r >= 11)
  if (allFace) {
    return { type: 'wuhua', level: 80, points: 0, name: '五花牛' }
  }

  // Find best 牛: try all C(5,3)=10 combinations
  const values = ranks.map(r => Math.min(r, 10)) // J/Q/K = 10 for 斗牛
  let bestPoints = -1

  for (let i = 0; i < 5; i++) {
    for (let j = i + 1; j < 5; j++) {
      for (let k = j + 1; k < 5; k++) {
        const sum3 = values[i] + values[j] + values[k]
        if (sum3 % 10 === 0) {
          // Remaining 2 cards
          const remaining = []
          for (let x = 0; x < 5; x++) {
            if (x !== i && x !== j && x !== k) remaining.push(values[x])
          }
          const sum2 = remaining[0] + remaining[1]
          const points = sum2 % 10
          if (points === 0) {
            // 牛牛 — best possible within 有牛
            return { type: 'niuniu', level: 50, points: 0, name: '牛牛' }
          }
          if (points > bestPoints) bestPoints = points
        }
      }
    }
  }

  if (bestPoints > 0) {
    return { type: 'youNiu', level: bestPoints, points: bestPoints, name: `牛${bestPoints}` }
  }

  return { type: 'wuNiu', level: 0, points: 0, name: '无牛' }
}

// Compare two hands. Returns positive if a wins, negative if b wins, 0 if tie.
function compareHands(handA, handB) {
  const a = evaluateHand(handA)
  const b = evaluateHand(handB)
  if (a.level !== b.level) return a.level - b.level
  // Same level — compare highest card rank
  const ranksA = handA.map(c => RANK_ORDER[c.rank]).sort((x, y) => y - x)
  const ranksB = handB.map(c => RANK_ORDER[c.rank]).sort((x, y) => y - x)
  for (let i = 0; i < Math.min(ranksA.length, ranksB.length); i++) {
    if (ranksA[i] !== ranksB[i]) return ranksA[i] - ranksB[i]
  }
  // Same ranks — compare suit of highest
  return SUIT_ORDER[handA[0].suit] - SUIT_ORDER[handB[0].suit]
}

function getMultiplier(handResult) {
  switch (handResult.type) {
    case 'wuxiao': return 5
    case 'bomb': return 4
    case 'wuhua': return 4
    case 'niuniu': return 3
    case 'youNiu':
      return handResult.points >= 7 ? 2 : 1
    default: return 1
  }
}

export { evaluateHand, compareHands, getMultiplier }

// ======== Timeouts ========

function onWaitTimeout(game) {
  if (game.state !== STATE.WAITING) return
  clearTimer(game)
  delete games[game.groupId]
  notify(game, 'wait-timeout')
}

function onBetTimeout(game) {
  if (game.state !== STATE.BETTING) return
  clearTimer(game)
  game.messages.push({ type: 'system', content: '下注超时，系统自动使用默认下注' })
  for (const p of game.players) {
    if (p.currentBet === 0) {
      const bet = Math.min(game.config.defaultBet, p.chips)
      p.currentBet = bet
      p.chips -= bet
      game.messages.push({ type: 'bet', nickname: p.nickname, amount: bet })
    }
  }
  startDealing(game)
  notify(game, 'bet-timeout')
}

// ======== CRUD ========

export function getGame(groupId) {
  return games[groupId]
}

export function createGame(groupId, initiatorId, nickname) {
  if (games[groupId] && games[groupId].state !== STATE.ENDED)
    return { error: '本群已有游戏进行中，请先 #斗牛结束' }
  if (games[groupId]) clearTimer(games[groupId])
  const gameCfg = Config.get().douniu || {}
  games[groupId] = {
    groupId,
    state: STATE.WAITING,
    initiator: initiatorId,
    players: [],
    dealer: { hand: [] },
    deck: [],
    round: 0,
    messages: [],
    config: {
      minPlayers: gameCfg.minPlayers ?? 1,
      maxPlayers: gameCfg.maxPlayers ?? 6,
      deckCount: gameCfg.deckCount ?? 1,
      startingChips: gameCfg.startingChips ?? 1000,
      defaultBet: gameCfg.defaultBet ?? 50,
      minBet: gameCfg.minBet ?? 10,
      maxBet: gameCfg.maxBet ?? 500,
    },
    createdAt: Date.now(),
  }
  const r = addPlayer(groupId, initiatorId, nickname)
  if (r.ok) scheduleWaitTimeout(games[groupId])
  return r
}

export function addPlayer(groupId, userId, nickname) {
  const game = games[groupId]
  if (!game || game.state === STATE.ENDED)
    return { error: '本群还未发起游戏，请先 #斗牛' }
  if (game.state !== STATE.WAITING) return { error: '游戏已开始，无法加入' }
  if (game.players.find(p => p.userId == userId)) return { error: '你已经在游戏中了' }
  if (game.players.length >= game.config.maxPlayers)
    return { error: `人数已达上限 ${game.config.maxPlayers} 人` }
  game.players.push({
    userId: String(userId),
    nickname: nickname || String(userId),
    avatar: `https://q1.qlogo.cn/g?b=qq&nk=${userId}&s=100`,
    hand: [],
    chips: game.config.startingChips,
    currentBet: 0,
    status: 'waiting',
  })
  scheduleWaitTimeout(game)
  return { ok: true, game }
}

export function removePlayer(groupId, userId) {
  const game = games[groupId]
  if (!game || game.state === STATE.ENDED) return { error: '本群还未发起游戏' }
  if (game.state !== STATE.WAITING) return { error: '游戏已开始，无法退出' }
  const idx = game.players.findIndex(p => p.userId == userId)
  if (idx < 0) return { error: '你不在游戏中' }
  game.players.splice(idx, 1)
  if (game.players.length === 0 || userId == game.initiator) {
    clearTimer(game)
    delete games[groupId]
    return { ok: true, dismissed: true }
  }
  return { ok: true, game }
}

export function endGame(groupId) {
  if (!games[groupId]) return { error: '本群没有进行中的游戏' }
  clearTimer(games[groupId])
  delete games[groupId]
  return { ok: true }
}

// ======== Game Flow ========

export function startBetting(groupId, operatorId) {
  const game = games[groupId]
  if (!game) return { error: '本群还未发起游戏' }
  if (game.state !== STATE.WAITING) return { error: '游戏已开始' }
  if (operatorId != game.initiator) return { error: '只有发起人可以开始' }
  if (game.players.length < game.config.minPlayers)
    return { error: `人数不足，至少需要 ${game.config.minPlayers} 人` }

  game.state = STATE.BETTING
  game.round = 1
  game.messages = []
  game.messages.push({
    type: 'system',
    content: `第 ${game.round} 轮下注开始（${game.config.minBet}~${game.config.maxBet}），发送 #斗牛下注 <金额> 或 #斗牛默认下注`,
  })
  scheduleBetTimeout(game)
  return { ok: true, game }
}

export function placeBet(groupId, userId, amount) {
  const game = games[groupId]
  if (!game) return { error: '本群没有进行中的游戏' }
  if (game.state !== STATE.BETTING) return { error: '当前不是下注阶段' }

  const player = game.players.find(p => p.userId == userId)
  if (!player) return { error: '你不在本局游戏中' }
  if (player.currentBet > 0) return { error: '你已下注，等待其他玩家' }

  let bet = amount ?? game.config.defaultBet
  bet = Math.max(game.config.minBet, Math.min(game.config.maxBet, bet))
  if (bet > player.chips) return { error: `筹码不足！你还有 ${player.chips} 筹码` }

  player.currentBet = bet
  player.chips -= bet
  game.messages.push({ type: 'bet', nickname: player.nickname, amount: bet })

  if (game.players.every(p => p.currentBet > 0)) {
    clearTimer(game)
    return startDealing(game)
  }
  return { ok: true, game }
}

function startDealing(game) {
  game.state = STATE.DEALING
  game.deck = createDeck(game.config.deckCount)
  game.dealer.hand = []

  for (const player of game.players) {
    player.hand = []
    for (let i = 0; i < 5; i++) player.hand.push(drawCard(game.deck))
    player.status = 'playing'
  }
  for (let i = 0; i < 5; i++) game.dealer.hand.push(drawCard(game.deck))

  game.messages.push({ type: 'system', content: '发牌完毕！开牌结算——' })

  return settle(game)
}

function settle(game) {
  game.state = STATE.SETTLEMENT
  const dealerResult = evaluateHand(game.dealer.hand)

  game.messages.push({
    type: 'dealer',
    cards: game.dealer.hand.map(formatCard),
    result: dealerResult.name,
  })

  for (const p of game.players) {
    const result = evaluateHand(p.hand)
    const cmp = compareHands(p.hand, game.dealer.hand)
    const mult = getMultiplier(result)

    p.handResult = result

    if (cmp > 0) {
      const win = p.currentBet * mult
      p.chips += p.currentBet + win
      p.status = 'win'
      game.messages.push({
        type: 'result',
        nickname: p.nickname,
        result: 'win',
        handName: result.name,
        detail: `${result.name}，赢得 ${win} 筹码`,
      })
    } else if (cmp === 0) {
      p.chips += p.currentBet
      p.status = 'push'
      game.messages.push({
        type: 'result',
        nickname: p.nickname,
        result: 'push',
        handName: result.name,
        detail: `${result.name}，平局退还筹码`,
      })
    } else {
      p.status = 'lose'
      game.messages.push({
        type: 'result',
        nickname: p.nickname,
        result: 'lose',
        handName: result.name,
        detail: `${result.name}，损失 ${p.currentBet} 筹码`,
      })
    }
    p.currentBet = 0
  }

  const broke = game.players.filter(p => p.chips < game.config.minBet)
  if (broke.length) {
    for (const p of broke) {
      game.messages.push({ type: 'system', content: `${p.nickname} 筹码不足，退出游戏` })
    }
    game.players = game.players.filter(p => p.chips >= game.config.minBet)
  }

  game.state = STATE.ENDED
  scheduleEndedCleanup(game)
  game.messages.push({ type: 'system', content: '本轮结束，发送 #斗牛再来一局 继续游戏' })
  return { ok: true, game }
}

export function newRound(groupId) {
  const game = games[groupId]
  if (!game) return { error: '本群没有进行中的游戏' }
  if (game.state !== STATE.ENDED) return { error: '当前轮次未结束' }
  if (!game.players.length) return { error: '没有玩家剩余，请重新 #斗牛' }

  clearTimer(game)

  for (const p of game.players) {
    p.hand = []
    p.currentBet = 0
    p.status = 'waiting'
    p.handResult = null
  }
  game.dealer.hand = []
  game.deck = []
  game.round++
  game.state = STATE.BETTING
  game.messages = []
  game.messages.push({
    type: 'system',
    content: `第 ${game.round} 轮下注开始（${game.config.minBet}~${game.config.maxBet}），发送 #斗牛下注 <金额> 或 #斗牛默认下注`,
  })
  scheduleBetTimeout(game)
  return { ok: true, game }
}

export { SUIT_SYMBOL, SUIT_COLOR, formatCard }
