import Config from '../../model/config.js'
import { screenshot } from '../../model/render.js'
import { STATE, handValue, isBlackjack, SUIT_SYMBOL, SUIT_COLOR } from './engine.js'

export async function renderGame(game) {
  const data = buildRenderData(game)
  return screenshot('blackjack', `chat-${game.groupId}`, data)
}

function buildRenderData(game) {
  const ended = game.state === STATE.ENDED
  const stateLabel = buildStateLabel(game)

  const players = game.players.map(p => ({
    userId: p.userId,
    nickname: p.nickname,
    avatar: p.avatar,
    chips: p.chips,
    currentBet: p.currentBet,
    cards: p.hand.map(c => ({
      suit: c.suit,
      rank: c.rank,
      symbol: SUIT_SYMBOL[c.suit],
      color: SUIT_COLOR[c.suit],
    })),
    handValue: handValue(p.hand),
    isBlackjack: isBlackjack(p.hand),
    isBust: p.status === 'bust' || p.status === 'lose',
    status: p.status,
    isPlaying: p.status === 'playing',
    isCurrent: false,
  }))

  if (game.state === STATE.PLAYING) {
    const current = game.players[game.currentPlayerIdx]
    if (current && current.status === 'playing') {
      const p = players.find(pp => pp.userId === current.userId)
      if (p) p.isCurrent = true
    }
  }

  const dealerCards = game.dealer.hand.map((c, i) => {
    if (game.state === STATE.PLAYING && i === 1) {
      return { hidden: true }
    }
    return {
      suit: c.suit,
      rank: c.rank,
      symbol: SUIT_SYMBOL[c.suit],
      color: SUIT_COLOR[c.suit],
    }
  })
  const dealerRevealed = game.state === STATE.DEALER || game.state === STATE.ENDED
  const dealerValue = game.dealer.hand.length
    ? (dealerRevealed ? handValue(game.dealer.hand) : handValue([game.dealer.hand[0]]))
    : 0

  const allMessages = game.messages || []
  const maxMessages = Math.max(1, Number(Config.get().blackjack?.maxMessages ?? 40))
  const truncated = allMessages.length > maxMessages
  const messages = truncated ? allMessages.slice(-maxMessages) : allMessages

  return {
    stateLabel,
    statusText: buildStatusText(game),
    ended,
    players,
    dealer: {
      cards: dealerCards,
      handValue: dealerValue,
      isBlackjack: dealerRevealed && isBlackjack(game.dealer.hand),
      isBust: dealerRevealed && (game.dealer.status === 'bust' || game.dealer.hand.length > 2 && dealerValue > 21),
      revealed: dealerRevealed,
    },
    messages,
    truncated,
    omittedCount: truncated ? allMessages.length - maxMessages : 0,
    round: game.round,
  }
}

function buildStateLabel(game) {
  switch (game.state) {
    case STATE.WAITING:
      return `等待玩家加入 (${game.players.length})`
    case STATE.BETTING:
      return '下注中'
    case STATE.PLAYING:
      return `第 ${game.round} 轮 · 游戏中`
    case STATE.DEALER:
      return '庄家回合'
    case STATE.ENDED:
      return `第 ${game.round} 轮 · 结算`
    default:
      return ''
  }
}

function buildStatusText(game) {
  if (game.state === STATE.WAITING) {
    const n = game.players.length
    const need = game.config.minPlayers
    if (n < need) return `还需 ${need - n} 人，发送 #加入21点 参与`
    return `人数已就绪（${n}人），发起人发送 #开始21点`
  }
  if (game.state === STATE.BETTING) {
    const notBet = game.players.filter(p => p.currentBet === 0)
    if (notBet.length)
      return `等待下注：${notBet.map(p => p.nickname).join('、')}`
    return '全员已下注'
  }
  if (game.state === STATE.PLAYING) {
    const current = game.players[game.currentPlayerIdx]
    if (current && current.status === 'playing') {
      return `轮到 ${current.nickname} 操作 · 发送 #叫牌 #停牌 #双倍`
    }
    return '等待操作...'
  }
  if (game.state === STATE.DEALER) {
    return '庄家正在摸牌...'
  }
  if (game.state === STATE.ENDED) {
    return '发送 #再来一局 继续游戏'
  }
  return ''
}
