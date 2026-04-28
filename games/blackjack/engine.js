import Config from '../../model/config.js'
import { SUIT_SYMBOL, SUIT_COLOR, cardValue, createDeck, shuffle, drawCard, formatCard } from '../../model/deck.js'

const games = {}

export const STATE = {
  WAITING: 'waiting',
  BETTING: 'betting',
  PLAYING: 'playing',
  DEALER: 'dealer',
  ENDED: 'ended',
}

let externalTick = null
export function setExternalTick(fn) { externalTick = fn }

function notify(game, type, extra) {
  try { externalTick?.(game, type, extra) } catch (err) {
    logger?.error(`[卡牌游戏·21点] tick 回调异常`, err)
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
  }, 300000) // 5 分钟
}

function getWarnBefore() {
  return Math.max(0, Number(Config.get().blackjack?.warnBefore ?? 15))
}

function scheduleWaitTimeout(game) {
  clearTimer(game)
  const sec = Math.max(30, Number(Config.get().blackjack?.waitTimeout ?? 300))
  game._timer = setTimeout(() => onWaitTimeout(game), sec * 1000)
}

function scheduleTurnTimeout(game) {
  clearTimer(game)
  const sec = Math.max(15, Number(Config.get().blackjack?.turnTimeout ?? 60))
  const warn = getWarnBefore()
  game._timer = setTimeout(() => onTurnTimeout(game), sec * 1000)
  if (warn > 0 && sec > warn) {
    game._warnTimer = setTimeout(() => {
      game._warnTimer = null
      if (game.state === STATE.PLAYING) notify(game, 'turn-warn', { secondsLeft: warn })
    }, (sec - warn) * 1000)
  }
}

// ======== Hand Value (Blackjack-specific) ========

export function handValue(cards) {
  if (!cards?.length) return 0
  let total = 0
  let aces = 0
  for (const c of cards) {
    if (!c) continue
    if (c.rank === 'A') { aces++; total += 11 }
    else total += cardValue(c.rank)
  }
  while (total > 21 && aces > 0) { total -= 10; aces-- }
  return total
}

export function isBlackjack(cards) {
  return cards?.length === 2 && handValue(cards) === 21
}

export function isBust(cards) {
  return handValue(cards) > 21
}

// ======== Timeouts ========

function onWaitTimeout(game) {
  if (game.state !== STATE.WAITING) return
  clearTimer(game)
  delete games[game.groupId]
  notify(game, 'wait-timeout')
}

function onTurnTimeout(game) {
  if (game.state !== STATE.PLAYING) return
  const player = getCurrentPlayer(game)
  if (!player) return
  game.messages.push({ type: 'system', content: `${player.nickname} 操作超时，自动停牌` })
  forceStand(game, player)
  moveToNextPlayer(game)
}

// ======== CRUD ========

export function getGame(groupId) {
  return games[groupId]
}

export function createGame(groupId, initiatorId, nickname) {
  if (games[groupId] && games[groupId].state !== STATE.ENDED)
    return { error: '本群已有游戏进行中，请先 #21点结束' }
  if (games[groupId]) clearTimer(games[groupId])
  const gameCfg = Config.get().blackjack || {}
  games[groupId] = {
    groupId,
    state: STATE.WAITING,
    initiator: initiatorId,
    players: [],
    dealer: { hand: [] },
    deck: [],
    currentPlayerIdx: 0,
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
      blackjackPayout: gameCfg.blackjackPayout ?? 1.5,
      dealerStandOn: gameCfg.dealerStandOn ?? 17,
      enableDoubleDown: gameCfg.enableDoubleDown ?? true,
      enableInsurance: gameCfg.enableInsurance ?? true,
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
    return { error: '本群还未发起游戏，请先 #21点' }
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
    insured: false,
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
    content: `第 ${game.round} 轮下注开始，请玩家发送 #下注 <金额>（${game.config.minBet}~${game.config.maxBet}），或发送 #默认下注 使用默认 ${game.config.defaultBet} 筹码`,
  })
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
  game.messages.push({
    type: 'bet',
    userId: player.userId,
    nickname: player.nickname,
    avatar: player.avatar,
    amount: bet,
  })

  if (game.players.every(p => p.currentBet > 0)) {
    return startDealing(game)
  }
  return { ok: true, game }
}

function startDealing(game) {
  clearTimer(game)
  game.state = STATE.PLAYING
  game.deck = createDeck(game.config.deckCount)
  game.dealer.hand = []
  game.currentPlayerIdx = 0

  for (const player of game.players) {
    player.hand = [drawCard(game.deck), drawCard(game.deck)]
    player.status = isBlackjack(player.hand) ? 'blackjack' : 'playing'
    player.insured = false
  }

  game.dealer.hand = [drawCard(game.deck), drawCard(game.deck)]

  const dealerBJ = isBlackjack(game.dealer.hand)
  const playerBJs = game.players.filter(p => p.status === 'blackjack')

  game.messages.push({ type: 'system', content: '发牌完毕' })

  if (dealerBJ) {
    game.dealer.status = 'blackjack'
    for (const p of game.players) {
      if (p.insured) {
        p.chips += p.insuranceBet * 3
        game.messages.push({
          type: 'result', nickname: p.nickname, result: 'insurance',
          detail: `保险赔付 ${p.insuranceBet * 2} 筹码`,
        })
        p.insured = false
      }
    }
    for (const p of game.players) {
      if (p.status === 'blackjack') {
        p.chips += p.currentBet
        p.currentBet = 0
        p.status = 'push'
        game.messages.push({ type: 'result', nickname: p.nickname, result: 'push', detail: '双方都是黑杰克，平局退还筹码' })
      } else {
        p.status = 'lose'
        game.messages.push({ type: 'result', nickname: p.nickname, result: 'lose', detail: '庄家黑杰克' })
        p.currentBet = 0
      }
    }
    game.state = STATE.ENDED
    scheduleEndedCleanup(game)
    game.messages.push({ type: 'system', content: '庄家黑杰克！本轮结束' })
    return { ok: true, game, settled: true }
  }

  if (playerBJs.length) {
    for (const p of playerBJs) {
      const payout = Math.floor(p.currentBet * game.config.blackjackPayout)
      p.chips += p.currentBet + payout
      game.messages.push({ type: 'result', nickname: p.nickname, result: 'blackjack', detail: `黑杰克！赢得 ${payout} 筹码`, amount: payout })
      p.currentBet = 0
    }
  }

  const firstPlaying = game.players.findIndex(p => p.status === 'playing')
  if (firstPlaying < 0) {
    return startDealerTurn(game)
  }
  game.currentPlayerIdx = firstPlaying
  scheduleTurnTimeout(game)
  return { ok: true, game }
}

export function hit(groupId, userId) {
  const game = games[groupId]
  if (!game) return { error: '本群没有进行中的游戏' }
  if (game.state !== STATE.PLAYING) return { error: '当前不是叫牌阶段' }

  const player = getCurrentPlayer(game)
  if (!player || player.userId != userId) {
    const who = player ? player.nickname : '无'
    return { error: `还没轮到你，当前应该 ${who} 操作` }
  }

  const card = drawCard(game.deck)
  if (!card) return { error: '牌堆已空' }
  player.hand.push(card)

  if (isBust(player.hand)) {
    player.status = 'bust'
    game.messages.push({
      type: 'hit', nickname: player.nickname, card: formatCard(card), bust: true,
    })
    game.messages.push({ type: 'system', content: `${player.nickname} 爆牌！(共 ${handValue(player.hand)} 点)` })
    moveToNextPlayer(game)
  } else {
    game.messages.push({
      type: 'hit', nickname: player.nickname, card: formatCard(card), bust: false,
    })
    scheduleTurnTimeout(game)
  }
  return { ok: true, game }
}

export function stand(groupId, userId) {
  const game = games[groupId]
  if (!game) return { error: '本群没有进行中的游戏' }
  if (game.state !== STATE.PLAYING) return { error: '当前不是操作阶段' }

  const player = getCurrentPlayer(game)
  if (!player || player.userId != userId) {
    const who = player ? player.nickname : '无'
    return { error: `还没轮到你，当前应该 ${who} 操作` }
  }

  forceStand(game, player)
  moveToNextPlayer(game)
  return { ok: true, game }
}

export function doubleDown(groupId, userId) {
  const game = games[groupId]
  if (!game) return { error: '本群没有进行中的游戏' }
  if (!game.config.enableDoubleDown) return { error: '本局未开启双倍下注' }
  if (game.state !== STATE.PLAYING) return { error: '当前不是操作阶段' }

  const player = getCurrentPlayer(game)
  if (!player || player.userId != userId) {
    const who = player ? player.nickname : '无'
    return { error: `还没轮到你，当前应该 ${who} 操作` }
  }
  if (player.hand.length !== 2) return { error: '只能在首次发牌后双倍下注' }
  if (player.chips < player.currentBet) return { error: '筹码不足，无法双倍' }

  player.chips -= player.currentBet
  player.currentBet *= 2

  const card = drawCard(game.deck)
  if (!card) return { error: '牌堆已空' }
  player.hand.push(card)

  if (isBust(player.hand)) {
    player.status = 'bust'
    game.messages.push({
      type: 'double', nickname: player.nickname, card: formatCard(card), bet: player.currentBet, bust: true,
    })
    game.messages.push({ type: 'system', content: `${player.nickname} 双倍下注后爆牌！(共 ${handValue(player.hand)} 点)` })
  } else {
    player.status = 'stand'
    game.messages.push({
      type: 'double', nickname: player.nickname, card: formatCard(card), bet: player.currentBet, bust: false,
    })
  }
  moveToNextPlayer(game)
  return { ok: true, game }
}

export function insurance(groupId, userId) {
  const game = games[groupId]
  if (!game) return { error: '本群没有进行中的游戏' }
  if (!game.config.enableInsurance) return { error: '本局未开启保险' }
  if (game.state !== STATE.PLAYING) return { error: '当前不是操作阶段' }

  const player = getCurrentPlayer(game)
  if (!player || player.userId != userId) return { error: '还没轮到你' }
  if (game.dealer.hand[0]?.rank !== 'A') return { error: '庄家明牌不是 A，无需保险' }
  if (player.insured) return { error: '你已经购买过保险了' }
  const insuranceBet = Math.floor(player.currentBet / 2)
  if (player.chips < insuranceBet) return { error: '筹码不足，无法购买保险' }

  player.chips -= insuranceBet
  player.insured = true
  player.insuranceBet = insuranceBet
  game.messages.push({
    type: 'insurance', nickname: player.nickname, amount: insuranceBet,
  })
  return { ok: true, game }
}

// ======== Dealer Turn ========

function startDealerTurn(game) {
  game.state = STATE.DEALER
  clearTimer(game)
  game.messages.push({ type: 'system', content: '所有玩家操作完毕，庄家亮牌' })

  const standOn = game.config.dealerStandOn
  while (handValue(game.dealer.hand) < standOn) {
    const card = drawCard(game.deck)
    if (!card) break
    game.dealer.hand.push(card)
    game.messages.push({
      type: 'dealer', card: formatCard(card), total: handValue(game.dealer.hand), bust: isBust(game.dealer.hand),
    })
  }

  if (isBust(game.dealer.hand)) {
    game.messages.push({ type: 'system', content: `庄家爆牌！(共 ${handValue(game.dealer.hand)} 点)` })
  } else {
    game.messages.push({ type: 'system', content: `庄家停牌：${handValue(game.dealer.hand)} 点` })
  }

  settle(game)
  return game
}

// ======== Settlement ========

function settle(game) {
  const dealerTotal = handValue(game.dealer.hand)
  const dealerBust = isBust(game.dealer.hand)
  const dealerBJ = isBlackjack(game.dealer.hand)

  for (const p of game.players) {
    if (p.status === 'blackjack' && dealerBJ) continue
    if (p.status === 'blackjack') continue
    if (p.status === 'bust') {
      p.status = 'lose'
      game.messages.push({
        type: 'result', nickname: p.nickname, result: 'lose', detail: `爆牌出局，损失 ${p.currentBet} 筹码`,
      })
      p.currentBet = 0
      continue
    }

    const playerTotal = handValue(p.hand)
    if (dealerBust) {
      p.chips += p.currentBet * 2
      p.status = 'win'
      game.messages.push({
        type: 'result', nickname: p.nickname, result: 'win',
        detail: `庄家爆牌，赢得 ${p.currentBet} 筹码`, amount: p.currentBet,
      })
    } else if (playerTotal > dealerTotal) {
      p.chips += p.currentBet * 2
      p.status = 'win'
      game.messages.push({
        type: 'result', nickname: p.nickname, result: 'win',
        detail: `${playerTotal} vs ${dealerTotal}，赢得 ${p.currentBet} 筹码`, amount: p.currentBet,
      })
    } else if (playerTotal === dealerTotal) {
      p.chips += p.currentBet
      p.status = 'push'
      game.messages.push({
        type: 'result', nickname: p.nickname, result: 'push',
        detail: `${playerTotal} vs ${dealerTotal}，平局退还筹码`,
      })
    } else {
      p.status = 'lose'
      game.messages.push({
        type: 'result', nickname: p.nickname, result: 'lose',
        detail: `${playerTotal} vs ${dealerTotal}，损失 ${p.currentBet} 筹码`,
      })
    }
    p.currentBet = 0
  }

  const dealerHasBJ = isBlackjack(game.dealer.hand)
  for (const p of game.players) {
    if (p.insured && dealerHasBJ) {
      p.chips += p.insuranceBet * 3
      game.messages.push({
        type: 'result', nickname: p.nickname, result: 'insurance',
        detail: `保险赔付 ${p.insuranceBet * 2} 筹码`,
      })
    }
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
  game.messages.push({ type: 'system', content: '本轮结束，发送 #再来一局 继续游戏' })
}

export function newRound(groupId) {
  const game = games[groupId]
  if (!game) return { error: '本群没有进行中的游戏' }
  if (game.state !== STATE.ENDED) return { error: '当前轮次未结束' }
  if (!game.players.length) return { error: '没有玩家剩余，请重新 #21点' }

  clearTimer(game)

  for (const p of game.players) {
    p.hand = []
    p.currentBet = 0
    p.status = 'waiting'
    p.insured = false
  }
  game.dealer.hand = []
  game.dealer.status = null
  game.deck = []
  game.currentPlayerIdx = 0
  game.round++
  game.state = STATE.BETTING
  game.messages = []
  game.messages.push({
    type: 'system',
    content: `第 ${game.round} 轮下注开始（${game.config.minBet}~${game.config.maxBet}），发送 #下注 <金额> 或 #默认下注`,
  })
  return { ok: true, game }
}

// ======== Utilities ========

function forceStand(game, player) {
  player.status = 'stand'
  game.messages.push({ type: 'stand', nickname: player.nickname, total: handValue(player.hand) })
}

function getCurrentPlayer(game) {
  const player = game.players[game.currentPlayerIdx]
  if (!player || player.status !== 'playing') return null
  return player
}

function moveToNextPlayer(game) {
  let next = -1
  for (let i = game.currentPlayerIdx + 1; i < game.players.length; i++) {
    if (game.players[i].status === 'playing') { next = i; break }
  }
  if (next < 0) return startDealerTurn(game)
  game.currentPlayerIdx = next
  scheduleTurnTimeout(game)
  return game
}

export { SUIT_SYMBOL, SUIT_COLOR, formatCard }
