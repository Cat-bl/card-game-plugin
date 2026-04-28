import Config from '../../model/config.js'
import { SUIT_ORDER, createDeck, drawCard, formatCard } from '../../model/deck.js'

const games = {}

export const STATE = {
  WAITING: 'waiting',
  PLAYING: 'playing',
  SHOWDOWN: 'showdown',
  ENDED: 'ended',
}

let externalTick = null
export function setExternalTick(fn) { externalTick = fn }

function notify(game, type, extra) {
  try { externalTick?.(game, type, extra) } catch (err) {
    logger?.error(`[卡牌游戏·炸金花] tick 回调异常`, err)
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
  return Math.max(0, Number(Config.get().zhajinhua?.warnBefore ?? 15))
}

function scheduleWaitTimeout(game) {
  clearTimer(game)
  const sec = Math.max(30, Number(Config.get().zhajinhua?.waitTimeout ?? 300))
  game._timer = setTimeout(() => onWaitTimeout(game), sec * 1000)
}

function scheduleTurnTimeout(game) {
  clearTimer(game)
  const sec = Math.max(15, Number(Config.get().zhajinhua?.turnTimeout ?? 60))
  const warn = getWarnBefore()
  game._timer = setTimeout(() => onTurnTimeout(game), sec * 1000)
  if (warn > 0 && sec > warn) {
    game._warnTimer = setTimeout(() => {
      game._warnTimer = null
      if (game.state === STATE.PLAYING) notify(game, 'turn-warn', { secondsLeft: warn })
    }, (sec - warn) * 1000)
  }
}

// ======== Hand Evaluation ========

// 炸金花 rank: A=14 (high), except A-2-3 straight where A=1
const ZR = { 'A': 14, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13 }

const HAND_TYPE = {
  BAOZI: 'baozi',
  TONGHUASHUN: 'tonghuashun',
  TONGHUA: 'tonghua',
  SHUNZI: 'shunzi',
  DUIZI: 'duizi',
  SANPAI: 'sanpai',
}

const TYPE_ORDER = [HAND_TYPE.SANPAI, HAND_TYPE.DUIZI, HAND_TYPE.SHUNZI, HAND_TYPE.TONGHUA, HAND_TYPE.TONGHUASHUN, HAND_TYPE.BAOZI]

export function evaluateHand(cards) {
  if (!cards?.length || cards.length !== 3) return { type: HAND_TYPE.SANPAI, name: '散牌', level: 0 }

  const ranks = cards.map(c => ZR[c.rank])
  const sorted = [...ranks].sort((a, b) => a - b)
  const suits = cards.map(c => c.suit)

  const isFlush = suits[0] === suits[1] && suits[1] === suits[2]

  // 顺子检测
  let isStraight = false
  let straightHigh = 0
  if (sorted[2] - sorted[1] === 1 && sorted[1] - sorted[0] === 1) {
    isStraight = true
    straightHigh = sorted[2]
  } else if (sorted[0] === 2 && sorted[1] === 3 && sorted[2] === 14) {
    // A-2-3 是最小的顺子
    isStraight = true
    straightHigh = 3
  }

  // 重复统计
  const countMap = {}
  for (const r of ranks) countMap[r] = (countMap[r] || 0) + 1
  const entries = Object.entries(countMap).map(([k, v]) => [Number(k), v])
  const groups = { 3: [], 2: [], 1: [] }
  for (const [r, c] of entries) groups[c].push(r)
  for (const k of Object.keys(groups)) groups[k].sort((a, b) => b - a)

  // 235 特殊：三张不同花色 2,3,5
  const is235 = sorted[0] === 2 && sorted[1] === 3 && sorted[2] === 5 && !isFlush

  if (groups[3].length === 1) {
    return { type: HAND_TYPE.BAOZI, name: '豹子', level: 600000 + groups[3][0], tripleRank: groups[3][0], is235 }
  }
  if (isFlush && isStraight) {
    return { type: HAND_TYPE.TONGHUASHUN, name: '同花顺', level: 500000 + straightHigh, straightHigh, is235 }
  }
  if (isFlush) {
    return { type: HAND_TYPE.TONGHUA, name: '同花', level: 400000 + sorted[2] * 10000 + sorted[1] * 100 + sorted[0], sortedRanks: sorted, is235 }
  }
  if (isStraight) {
    return { type: HAND_TYPE.SHUNZI, name: '顺子', level: 300000 + straightHigh, straightHigh, is235 }
  }
  if (groups[2].length === 1) {
    const pairRank = groups[2][0]
    const kicker = groups[1][0]
    return { type: HAND_TYPE.DUIZI, name: '对子', level: 200000 + pairRank * 100 + kicker, pairRank, kicker, is235 }
  }
  return {
    type: HAND_TYPE.SANPAI, name: '散牌',
    level: sorted[2] * 10000 + sorted[1] * 100 + sorted[0],
    sortedRanks: sorted, is235,
  }
}

export function compareHands(handA, handB) {
  const a = evaluateHand(handA)
  const b = evaluateHand(handB)

  // 235 杂牌 克 豹子（AAA）
  if (a.is235 && b.type === HAND_TYPE.BAOZI) return 1
  if (b.is235 && a.type === HAND_TYPE.BAOZI) return -1

  const idxA = TYPE_ORDER.indexOf(a.type)
  const idxB = TYPE_ORDER.indexOf(b.type)
  if (idxA !== idxB) return idxA - idxB

  if (a.level !== b.level) return a.level - b.level

  // 完全平局比较花色
  const aSorted = [...handA].sort((x, y) => ZR[y.rank] - ZR[x.rank])
  const bSorted = [...handB].sort((x, y) => ZR[y.rank] - ZR[x.rank])
  for (let i = 0; i < 3; i++) {
    if (ZR[aSorted[i].rank] !== ZR[bSorted[i].rank]) return ZR[aSorted[i].rank] - ZR[bSorted[i].rank]
  }
  return SUIT_ORDER[aSorted[0].suit] - SUIT_ORDER[bSorted[0].suit]
}

export function getSettlementType(game) {
  const active = game.players.filter(p => !p.folded)
  if (active.length === 1) return 'sole'
  return 'showdown'
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
  clearTimer(game)
  const active = game.players.filter(p => !p.folded)
  const current = active[game.currentPlayerIdx]
  if (!current) return
  game.messages.push({ type: 'system', content: `${current.nickname} 操作超时，自动弃牌` })
  doFold(game, current)
}

// ======== CRUD ========

export function getGame(groupId) {
  return games[groupId]
}

export function createGame(groupId, initiatorId, nickname) {
  if (games[groupId] && games[groupId].state !== STATE.ENDED)
    return { error: '本群已有游戏进行中，请先 #炸金花结束' }
  if (games[groupId]) clearTimer(games[groupId])
  const cfg = Config.get().zhajinhua || {}
  games[groupId] = {
    groupId,
    state: STATE.WAITING,
    initiator: String(initiatorId),
    players: [],
    deck: [],
    pot: 0,
    currentStake: 0,
    currentPlayerIdx: 0,
    turnCount: 0,
    messages: [],
    config: {
      minPlayers: cfg.minPlayers ?? 2,
      maxPlayers: cfg.maxPlayers ?? 8,
      deckCount: cfg.deckCount ?? 1,
      startingChips: cfg.startingChips ?? 1000,
      ante: cfg.ante ?? 10,
      blindStake: cfg.blindStake ?? 10,
      seenStake: cfg.seenStake ?? 20,
      maxRounds: cfg.maxRounds ?? 20,
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
    return { error: '本群还未发起游戏，请先 #炸金花 或 #金沙' }
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
    seen: false,
    folded: false,
    totalBet: 0,
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

export function startGame(groupId, operatorId) {
  const game = games[groupId]
  if (!game) return { error: '本群还未发起游戏' }
  if (game.state !== STATE.WAITING) return { error: '游戏已开始' }
  if (String(operatorId) != game.initiator) return { error: '只有发起人可以开始' }
  if (game.players.length < game.config.minPlayers)
    return { error: `人数不足，至少需要 ${game.config.minPlayers} 人` }

  clearTimer(game)

  // 收底注 + 发牌
  game.deck = createDeck(game.config.deckCount)
  game.pot = 0
  game.currentStake = game.config.blindStake
  game.turnCount = 0
  game.round = 1
  game.messages = []

  for (const p of game.players) {
    p.hand = []
    for (let i = 0; i < 3; i++) p.hand.push(drawCard(game.deck))
    p.seen = false
    p.folded = false
    p.totalBet = 0

    const ante = Math.min(game.config.ante, p.chips)
    p.chips -= ante
    p.totalBet += ante
    game.pot += ante
  }

  game.messages.push({
    type: 'system',
    content: `第 ${game.round} 轮开始！每人底注 ${game.config.ante}，盲注 ${game.config.blindStake} / 明注 ${game.config.seenStake}`,
  })

  // 随机选择起始玩家
  game.currentPlayerIdx = Math.floor(Math.random() * game.players.length)
  game.state = STATE.PLAYING

  const active = getActivePlayers(game)
  const current = active[game.currentPlayerIdx]
  game.messages.push({ type: 'system', content: `轮到 ${current.nickname} 操作（盲注状态）` })

  scheduleTurnTimeout(game)
  return { ok: true, game }
}

// ======== Player Actions ========

function getActivePlayers(game) {
  return game.players.filter(p => !p.folded)
}

function advanceTurn(game) {
  const active = getActivePlayers(game)
  if (active.length <= 1) {
    return showdown(game)
  }
  game.turnCount++
  const maxActions = game.config.maxRounds * game.players.length
  if (game.turnCount >= maxActions) {
    game.messages.push({ type: 'system', content: `已达最大回合数，强制比牌` })
    return showdown(game)
  }
  game.currentPlayerIdx = (game.currentPlayerIdx + 1) % active.length
  const current = active[game.currentPlayerIdx]
  game.messages.push({ type: 'system', content: `轮到 ${current.nickname} 操作（${current.seen ? '明注' : '盲注'}状态）` })
  scheduleTurnTimeout(game)
  return { ok: true, game }
}

export function peek(groupId, userId) {
  const game = games[groupId]
  if (!game || game.state !== STATE.PLAYING) return { error: '当前不在游戏阶段' }

  const active = getActivePlayers(game)
  const current = active[game.currentPlayerIdx]
  if (!current || current.userId != userId) return { error: '还没轮到你操作' }
  if (current.seen) return { error: '你已经看过牌了' }

  current.seen = true
  game.messages.push({ type: 'system', content: `${current.nickname} 看了牌（进入明注状态）` })
  return { ok: true, game, action: 'peek', peekPlayer: current }
}

export function callBet(groupId, userId) {
  const game = games[groupId]
  if (!game || game.state !== STATE.PLAYING) return { error: '当前不在游戏阶段' }

  const active = getActivePlayers(game)
  const current = active[game.currentPlayerIdx]
  if (!current || current.userId != userId) return { error: '还没轮到你操作' }

  const pay = current.seen
    ? Math.max(game.config.seenStake, game.currentStake)
    : game.config.blindStake

  if (pay > current.chips) return { error: `筹码不足！需要 ${pay}，你还有 ${current.chips}` }

  current.chips -= pay
  current.totalBet += pay
  game.pot += pay
  game.currentStake = pay

  game.messages.push({
    type: 'call',
    nickname: current.nickname,
    amount: pay,
    blind: !current.seen,
  })

  return advanceTurn(game)
}

export function raiseBet(groupId, userId, amount) {
  const game = games[groupId]
  if (!game || game.state !== STATE.PLAYING) return { error: '当前不在游戏阶段' }

  const active = getActivePlayers(game)
  const current = active[game.currentPlayerIdx]
  if (!current || current.userId != userId) return { error: '还没轮到你操作' }

  const minRaise = current.seen
    ? Math.max(game.config.seenStake, game.currentStake + 1)
    : Math.max(game.config.blindStake, game.currentStake + 1)

  if (!amount || amount < minRaise)
    return { error: `加注金额不能低于 ${minRaise}（盲注最低 ${game.config.blindStake} / 明注最低 ${game.config.seenStake}）` }
  if (amount > current.chips)
    return { error: `筹码不足！你还有 ${current.chips}` }

  current.chips -= amount
  current.totalBet += amount
  game.pot += amount
  game.currentStake = amount

  game.messages.push({
    type: 'raise',
    nickname: current.nickname,
    amount,
    blind: !current.seen,
  })

  return advanceTurn(game)
}

export function foldHand(groupId, userId) {
  const game = games[groupId]
  if (!game || game.state !== STATE.PLAYING) return { error: '当前不在游戏阶段' }

  const active = getActivePlayers(game)
  const current = active[game.currentPlayerIdx]
  if (!current || current.userId != userId) return { error: '还没轮到你操作' }

  doFold(game, current)
  return { ok: true, game }
}

function doFold(game, player) {
  player.folded = true
  game.messages.push({ type: 'fold', nickname: player.nickname })

  const active = getActivePlayers(game)
  if (active.length <= 1) {
    clearTimer(game)
    return showdown(game)
  }
  game.currentPlayerIdx = game.currentPlayerIdx % active.length
  const current = active[game.currentPlayerIdx]
  game.messages.push({ type: 'system', content: `轮到 ${current.nickname} 操作（${current.seen ? '明注' : '盲注'}状态）` })
  scheduleTurnTimeout(game)
}

export function compareHandsAction(groupId, userId, targetId) {
  const game = games[groupId]
  if (!game || game.state !== STATE.PLAYING) return { error: '当前不在游戏阶段' }

  const active = getActivePlayers(game)
  const current = active[game.currentPlayerIdx]
  if (!current || current.userId != userId) return { error: '还没轮到你操作' }

  const target = active.find(p => p.userId == targetId)
  if (!target) return { error: '目标玩家不在游戏中或已弃牌' }
  if (target.userId == current.userId) return { error: '不能和自己比牌' }

  // 比牌需要付跟注费用
  const pay = current.seen
    ? Math.max(game.config.seenStake, game.currentStake)
    : game.config.blindStake
  if (pay > current.chips) return { error: `筹码不足！比牌需要 ${pay}，你还有 ${current.chips}` }

  current.chips -= pay
  current.totalBet += pay
  game.pot += pay

  const cmp = compareHands(current.hand, target.hand)
  const challengerResult = evaluateHand(current.hand)
  const targetResult = evaluateHand(target.hand)

  let loser
  if (cmp > 0) {
    loser = target
  } else if (cmp < 0) {
    loser = current
  } else {
    // 平局，挑战者输
    loser = current
  }

  loser.folded = true

  game.messages.push({
    type: 'compare',
    challenger: current.nickname,
    target: target.nickname,
    challengerHand: current.hand.map(formatCard),
    challengerName: challengerResult.name,
    targetHand: target.hand.map(formatCard),
    targetName: targetResult.name,
    loser: loser.nickname,
  })

  const remaining = getActivePlayers(game)
  if (remaining.length <= 1) {
    clearTimer(game)
    return showdown(game)
  }

  // 调整回合索引
  if (loser.userId == current.userId) {
    // 挑战者被淘汰，同一索引位置现在是下一个玩家
    game.currentPlayerIdx = game.currentPlayerIdx % remaining.length
  } else {
    // 目标被淘汰，找到挑战者在剩余数组中的新位置，然后 +1
    const newIdx = remaining.findIndex(p => p.userId == current.userId)
    game.currentPlayerIdx = (newIdx + 1) % remaining.length
  }

  const next = remaining[game.currentPlayerIdx]
  game.messages.push({ type: 'system', content: `轮到 ${next.nickname} 操作（${next.seen ? '明注' : '盲注'}状态）` })
  scheduleTurnTimeout(game)
  return { ok: true, game }
}

// ======== Showdown ========

function showdown(game) {
  game.state = STATE.SHOWDOWN
  clearTimer(game)

  const active = game.players.filter(p => !p.folded)

  if (active.length === 0) {
    // 全部弃牌（不应出现）
    game.messages.push({ type: 'system', content: '所有玩家均已弃牌，游戏结束' })
    game.state = STATE.ENDED
    return { ok: true, game }
  }

  if (active.length === 1) {
    const winner = active[0]
    winner.chips += game.pot
    game.messages.push({
      type: 'result',
      nickname: winner.nickname,
      result: 'win',
      detail: `其余玩家弃牌，赢得 ${game.pot} 筹码`,
      pot: game.pot,
    })
  } else {
    // 多方比牌，找出最佳手牌
    let best = active[0]
    let bestResult = evaluateHand(best.hand)
    for (let i = 1; i < active.length; i++) {
      const cmp = compareHands(active[i].hand, best.hand)
      if (cmp > 0) {
        best = active[i]
        bestResult = evaluateHand(best.hand)
      }
    }
    best.chips += game.pot
    for (const p of active) {
      const r = evaluateHand(p.hand)
      p.handName = r.name
    }
    game.messages.push({
      type: 'result',
      nickname: best.nickname,
      result: 'win',
      detail: `${bestResult.name}，赢得 ${game.pot} 筹码`,
      pot: game.pot,
      allHands: active.map(p => ({
        nickname: p.nickname,
        cards: p.hand.map(formatCard),
        handName: evaluateHand(p.hand).name,
      })),
    })
  }

  // 淘汰筹码不足的玩家
  const minChips = Math.min(game.config.ante, game.config.blindStake)
  const broke = game.players.filter(p => p.chips < minChips)
  if (broke.length) {
    for (const p of broke) {
      game.messages.push({ type: 'system', content: `${p.nickname} 筹码不足，退出游戏` })
    }
    game.players = game.players.filter(p => p.chips >= minChips)
  }

  game.state = STATE.ENDED
  scheduleEndedCleanup(game)
  game.messages.push({ type: 'system', content: '本轮结束，发送 #再来一局 继续游戏' })
  return { ok: true, game }
}

export function newRound(groupId) {
  const game = games[groupId]
  if (!game) return { error: '本群没有进行中的游戏' }
  if (game.state !== STATE.ENDED) return { error: '当前轮次未结束' }
  if (game.players.length < game.config.minPlayers)
    return { error: `人数不足，至少需要 ${game.config.minPlayers} 人，请重新 #炸金花` }

  clearTimer(game)

  game.deck = createDeck(game.config.deckCount)
  game.pot = 0
  game.currentStake = game.config.blindStake
  game.turnCount = 0
  game.messages = []

  for (const p of game.players) {
    p.hand = []
    for (let i = 0; i < 3; i++) p.hand.push(drawCard(game.deck))
    p.seen = false
    p.folded = false
    p.totalBet = 0

    const ante = Math.min(game.config.ante, p.chips)
    p.chips -= ante
    p.totalBet += ante
    game.pot += ante
  }

  game.round++
  game.messages.push({
    type: 'system',
    content: `第 ${game.round} 轮开始！盲注 ${game.config.blindStake} / 明注 ${game.config.seenStake}`,
  })

  game.currentPlayerIdx = Math.floor(Math.random() * game.players.length)
  game.state = STATE.PLAYING

  const active = getActivePlayers(game)
  const current = active[game.currentPlayerIdx]
  game.messages.push({ type: 'system', content: `轮到 ${current.nickname} 操作（盲注状态）` })

  scheduleTurnTimeout(game)
  return { ok: true, game }
}
