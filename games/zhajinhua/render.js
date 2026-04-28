import Config from '../../model/config.js'
import { screenshot } from '../../model/render.js'
import { STATE, evaluateHand } from './engine.js'
import { formatCard } from '../../model/deck.js'

export async function renderGame(game) {
  const data = buildRenderData(game)
  return screenshot('zhajinhua', `chat-${game.groupId}`, data)
}

function buildRenderData(game) {
  const ended = game.state === STATE.ENDED
  const isShowdown = game.state === STATE.SHOWDOWN || ended

  const players = game.players.map(p => {
    const showCards = isShowdown && !p.folded
    const result = showCards ? evaluateHand(p.hand) : null
    return {
      userId: p.userId,
      nickname: p.nickname,
      avatar: p.avatar,
      chips: p.chips,
      folded: p.folded,
      seen: p.seen,
      totalBet: p.totalBet,
      cards: showCards
        ? p.hand.map(formatCard)
        : p.hand.map(() => ({ hidden: true })),
      handName: result?.name || (showCards ? '已弃牌' : ''),
      isCurrent: false,
    }
  })

  // 标记当前操作玩家
  if (game.state === STATE.PLAYING) {
    const active = game.players.filter(p => !p.folded)
    const activeIndices = []
    game.players.forEach((p, i) => {
      if (!p.folded) activeIndices.push(i)
    })
    if (activeIndices.length && game.currentPlayerIdx < activeIndices.length) {
      const currentIdx = activeIndices[game.currentPlayerIdx]
      if (players[currentIdx]) players[currentIdx].isCurrent = true
    }
  }

  const allMessages = game.messages || []
  const maxMessages = Math.max(1, Number(Config.get().zhajinhua?.maxMessages ?? 40))
  const truncated = allMessages.length > maxMessages
  const messages = truncated ? allMessages.slice(-maxMessages) : allMessages

  return {
    stateLabel: buildStateLabel(game),
    statusText: buildStatusText(game),
    ended,
    isShowdown,
    players,
    pot: game.pot,
    currentStake: game.currentStake,
    blindStake: game.config?.blindStake ?? 10,
    seenStake: game.config?.seenStake ?? 20,
    messages,
    truncated,
    omittedCount: truncated ? allMessages.length - maxMessages : 0,
  }
}

function buildStateLabel(game) {
  switch (game.state) {
    case STATE.WAITING:
      return `等待玩家加入 (${game.players.length})`
    case STATE.PLAYING:
      return '游戏中'
    case STATE.SHOWDOWN:
      return '比牌结算中'
    case STATE.ENDED:
      return '结算完成'
    default:
      return ''
  }
}

function buildStatusText(game) {
  if (game.state === STATE.WAITING) {
    const n = game.players.length
    const need = game.config?.minPlayers ?? 2
    if (n < need) return `还需 ${need - n} 人，发送 #加入炸金花 参与`
    return `人数已就绪（${n}人），发起人发送 #开始炸金花`
  }
  if (game.state === STATE.PLAYING) {
    const active = game.players.filter(p => !p.folded)
    const current = active[game.currentPlayerIdx]
    if (current) {
      return `当前操作：${current.nickname}（${current.seen ? '明注' : '盲注'}） | #看牌 #跟注 #加注 #弃牌 #比牌`
    }
  }
  if (game.state === STATE.ENDED) {
    return '发送 #再来一局 继续游戏'
  }
  return ''
}
