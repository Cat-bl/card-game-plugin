export const SUITS = ['spade', 'heart', 'diamond', 'club']
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']

export const SUIT_SYMBOL = { spade: '♠', heart: '♥', diamond: '♦', club: '♣' }
export const SUIT_COLOR = { spade: 'black', club: 'black', heart: 'red', diamond: 'red' }

export const RANK_ORDER = { 'A': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13 }
export const SUIT_ORDER = { 'spade': 4, 'heart': 3, 'diamond': 2, 'club': 1 }

export function cardValue(rank) {
  if (['J', 'Q', 'K'].includes(rank)) return 10
  return Number(rank)
}

export function createDeck(count = 1) {
  const deck = []
  for (let i = 0; i < count; i++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        deck.push({ suit, rank })
      }
    }
  }
  return shuffle(deck)
}

export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

export function drawCard(deck) {
  if (!deck.length) return null
  return deck.pop()
}

// Unicode 扑克牌字符映射 (U+1F0A0–U+1F0FF)
// 黑桃 A=0x1F0A1, 红心 A=0x1F0B1, 方片 A=0x1F0C1, 梅花 A=0x1F0D1
const UNICODE_BASE = { spade: 0x1F0A0, heart: 0x1F0B0, diamond: 0x1F0C0, club: 0x1F0D0 }
const UNICODE_RANK = { 'A': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 13, 'K': 14 }
// 注: Q=13 跳过 12 (骑士牌，标准 52 张牌组不使用)

function getCardUnicode(card) {
  const base = UNICODE_BASE[card.suit]
  const offset = UNICODE_RANK[card.rank]
  if (!base || !offset) return ''
  return String.fromCodePoint(base + offset)
}

export function formatCard(card) {
  return {
    suit: card.suit, rank: card.rank,
    symbol: SUIT_SYMBOL[card.suit], color: SUIT_COLOR[card.suit],
    unicode: getCardUnicode(card),
  }
}
