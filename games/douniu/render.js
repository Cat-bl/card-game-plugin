import Config from '../../model/config.js'
import { screenshot } from '../../model/render.js'
import { STATE, evaluateHand, formatCard } from './engine.js'

export async function renderGame(game) {
  const data = buildRenderData(game)
  return screenshot('douniu', `chat-${game.groupId}`, data)
}

function buildRenderData(game) {
  const ended = game.state === STATE.ENDED
  const stateLabel = buildStateLabel(game)

  const players = game.players.map(p => {
    const result = p.handResult || (p.hand.length ? evaluateHand(p.hand) : null)
    return {
      userId: p.userId,
      nickname: p.nickname,
      avatar: p.avatar,
      chips: p.chips,
      currentBet: p.currentBet,
      cards: p.hand.map(formatCard),
      handName: result?.name || '',
      status: p.status,
    }
  })

  const dealerRevealed = game.state === STATE.SETTLEMENT || game.state === STATE.ENDED
  const dealerResult = dealerRevealed && game.dealer.hand.length
    ? evaluateHand(game.dealer.hand)
    : null

  const dealerCards = game.dealer.hand.map(c => {
    if (!dealerRevealed) return { hidden: true }
    return formatCard(c)
  })

  const allMessages = game.messages || []
  const maxMessages = Math.max(1, Number(Config.get().douniu?.maxMessages ?? 40))
  const truncated = allMessages.length > maxMessages
  const messages = truncated ? allMessages.slice(-maxMessages) : allMessages

  return {
    stateLabel,
    statusText: buildStatusText(game),
    ended,
    players,
    dealer: {
      cards: dealerCards,
      handName: dealerResult?.name || '',
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
    case STATE.DEALING:
    case STATE.SETTLEMENT:
      return `第 ${game.round} 轮 · 结算中`
    case STATE.ENDED:
      return `第 ${game.round} 轮 · 结算完成`
    default:
      return ''
  }
}

function buildStatusText(game) {
  if (game.state === STATE.WAITING) {
    const n = game.players.length
    const need = game.config.minPlayers
    if (n < need) return `还需 ${need - n} 人，发送 #加入斗牛 参与`
    return `人数已就绪（${n}人），发起人发送 #开始斗牛`
  }
  if (game.state === STATE.BETTING) {
    const notBet = game.players.filter(p => p.currentBet === 0)
    if (notBet.length)
      return `等待下注：${notBet.map(p => p.nickname).join('、')}`
    return '全员已下注，即将发牌...'
  }
  if (game.state === STATE.ENDED) {
    return '发送 #再来一局 继续游戏'
  }
  return ''
}
