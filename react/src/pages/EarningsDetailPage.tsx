import { useState, useMemo, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { usePortfolio } from '../hooks/usePortfolio'
import LoanTable from '../components/LoanTable'
import SharedLoanDrawer from '../components/LoanDrawer'
import SharedKpiDrawer from '../components/KpiDrawer'
import { useUser } from '../context/UserContext'

type EarningsKpiKey = 'kpi1' | 'kpi2' | 'kpi3' | 'kpi4'
type DrawerMode = { kind: 'kpi'; kpi: EarningsKpiKey } | { kind: 'loan'; loanId: string } | null

const fmt$  = (v: number) => '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtMY = (d: Date)   => d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
const fmtDate = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

const TODAY         = new Date()
const CURRENT_MONTH = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1)

// ─── Shared styles ────────────────────────────────────────────────────────────
const filterSelectStyle: React.CSSProperties = {
  padding: '6px 10px', borderRadius: 8, border: '1px solid #e2e8f0',
  background: '#fff', color: '#0f172a', fontSize: 13, fontWeight: 500, cursor: 'pointer',
}
const filterBtnStyle: React.CSSProperties = {
  padding: '7px 14px', borderRadius: 8, border: '1px solid #e2e8f0',
  background: '#fff', color: '#0f172a', fontSize: 13, fontWeight: 500, cursor: 'pointer',
}
const drawerThStyle: React.CSSProperties = {
  padding: '8px 10px', textAlign: 'left', color: '#94a3b8', fontWeight: 700,
  fontSize: 11, textTransform: 'uppercase' as const, letterSpacing: '0.05em',
  borderBottom: '1px solid #e2e8f0', position: 'sticky', top: 0, background: '#f8fafc',
}
const drawerThR: React.CSSProperties = { ...drawerThStyle, textAlign: 'right' }

// ─── Earnings data helpers ────────────────────────────────────────────────────
// Supports both earningsEngine output (loan.earningsSchedule with monthlyNet etc.)
// and amort schedule fallback (principalPaid, interest, feeThisMonth fields).

function getLoanEarningsSchedule(loan: any): any[] {
  // earningsEngine.js produces loan.earningsSchedule — prefer it
  if (Array.isArray(loan.earningsSchedule) && loan.earningsSchedule.length > 0) {
    return loan.earningsSchedule
  }
  // Fallback: owned rows from amort schedule
  return (loan.amort?.schedule ?? []).filter((r: any) => r.isOwned && r.loanDate instanceof Date)
}

function getOwnershipPct(loan: any): number {
  return Number(loan.ownershipPct ?? loan.userOwnershipPct ?? 1)
}

function getRowMonthlyNet(r: any): number {
  if (r.monthlyNet !== undefined) return Number(r.monthlyNet ?? 0)
  // amort fallback
  const pct = Number(r.ownershipPct ?? 1)
  const principal = Math.max(0, (Number(r.principalPaid ?? r.scheduledPrincipal ?? 0)) - (Number(r.prepayment ?? r.prepaymentPrincipal ?? 0))) * pct
  const interest  = (Number(r.interest) || 0) * pct
  const fee       = (Number(r.feeThisMonth) || 0) * pct
  return principal + interest - fee
}

function getRowMonthlyPrincipal(r: any): number {
  if (r.monthlyPrincipal !== undefined) return Number(r.monthlyPrincipal ?? 0)
  const pct = Number(r.ownershipPct ?? 1)
  return Math.max(0, (Number(r.principalPaid ?? r.scheduledPrincipal ?? 0)) - (Number(r.prepayment ?? r.prepaymentPrincipal ?? 0))) * pct
}

function getRowMonthlyInterest(r: any): number {
  if (r.monthlyInterest !== undefined) return Number(r.monthlyInterest ?? 0)
  const pct = Number(r.ownershipPct ?? 1)
  return (Number(r.interest) || 0) * pct
}

function getRowMonthlyFees(r: any): number {
  if (r.monthlyFees !== undefined) return Number(r.monthlyFees ?? 0)
  const pct = Number(r.ownershipPct ?? 1)
  return (Number(r.feeThisMonth) || 0) * pct
}

function loanNetToDate(loan: any): number {
  return getLoanEarningsSchedule(loan)
    .filter((r: any) => r.loanDate instanceof Date && r.loanDate <= CURRENT_MONTH)
    .reduce((s: number, r: any) => s + getRowMonthlyNet(r), 0)
}

function loanFeesToDate(loan: any): number {
  return getLoanEarningsSchedule(loan)
    .filter((r: any) => r.loanDate instanceof Date && r.loanDate <= CURRENT_MONTH)
    .reduce((s: number, r: any) => s + getRowMonthlyFees(r), 0)
}

function allOwnedMonths(loans: any[]): Date[] {
  const ms = new Set<number>()
  loans.forEach(l => {
    getLoanEarningsSchedule(l).forEach((r: any) => {
      if (r.loanDate instanceof Date)
        ms.add(new Date(r.loanDate.getFullYear(), r.loanDate.getMonth(), 1).getTime())
    })
  })
  return Array.from(ms).sort((a, b) => a - b).map(t => new Date(t))
}

function ownedMonthsToDate(loans: any[]): Date[] {
  return allOwnedMonths(loans).filter(d => d <= CURRENT_MONTH)
}

// ─── Tooltip — always ABOVE cursor ───────────────────────────────────────────
function Tooltip({ x, y, children }: { x: number; y: number; children: React.ReactNode }) {
  return (
    <div style={{
      position: 'fixed', left: x + 14, top: y - 14,
      transform: 'translateY(-100%)',
      background: '#1e293b', color: '#fff', borderRadius: 8,
      padding: '10px 14px', fontSize: 12, lineHeight: 1.7,
      boxShadow: '0 8px 24px rgba(0,0,0,0.35)', pointerEvents: 'none', zIndex: 9999,
      minWidth: 190, maxWidth: 260,
    }}>
      {children}
    </div>
  )
}

interface BarSeries {
  loanId: string
  name: string
  color: string
  data: Map<number, number>
}

// ─── Stacked Bar Chart ────────────────────────────────────────────────────────
// KEY FIX: onMouseMove is on the <svg> element (not <g> children) for reliable
// hit detection. cumulative=true builds running totals so bars grow over time.
function StackedBarChart({
  series,
  dates,
  height = 260,
  cumulative = false,
  visibleIds,
  focusedId,
  showTodayLine = true,
  compact = false,
  tooltipMode = 'portfolio',
  tooltipBreakdownByTs,
}: {
  series: BarSeries[]
  dates: Date[]
  height?: number
  cumulative?: boolean
  visibleIds?: Set<string>
  focusedId?: string | null
  showTodayLine?: boolean
  compact?: boolean
  tooltipMode?: 'portfolio' | 'loan-breakdown'
  tooltipBreakdownByTs?: Map<number, {
    principal: number
    interest: number
    fees: number
    net: number
  }>
}) {
  const [hovered, setHovered] = useState<{ idx: number; x: number; y: number } | null>(null)

  const visible = visibleIds ? series.filter(s => visibleIds.has(s.loanId)) : series

  const resolvedSeries = useMemo(() => {
    if (!cumulative) return visible
    return visible.map(s => {
      let running = 0
      const data = new Map<number, number>()
      dates.forEach(d => {
        const ts = d.getTime()
        running += s.data.get(ts) ?? 0
        data.set(ts, running)
      })
      return { ...s, data }
    })
  }, [visible, dates, cumulative])

  const stacks = useMemo(
    () =>
      dates.map((d, idx) => {
        const ts = d.getTime()
        let posCum = 0
        let negCum = 0

        const bars = resolvedSeries.map(s => {
          const val = s.data.get(ts) ?? 0

          if (val >= 0) {
            const bottom = posCum
            posCum += val
            return { loanId: s.loanId, color: s.color, val, bottom, top: posCum }
          }

          const top = negCum
          negCum += val
          return { loanId: s.loanId, color: s.color, val, bottom: negCum, top }
        })

        return {
          idx,
          date: d,
          ts,
          posTotal: posCum,
          negTotal: negCum,
          bars,
        }
      }),
    [resolvedSeries, dates]
  )

  const maxPos = Math.max(...stacks.map(s => s.posTotal), 1)
  const minNeg = Math.min(...stacks.map(s => s.negTotal), 0)
  const range = maxPos - minNeg || 1

  const PAD = { top: 20, right: 16, bottom: 36, left: 72 }
  const W = 860
  const H = height
  const cW = W - PAD.left - PAD.right
  const cH = H - PAD.top - PAD.bottom
  const barW = Math.max(2, Math.min(18, cW / Math.max(dates.length, 1) - 1))
  const xS = (i: number) => PAD.left + (i / Math.max(dates.length - 1, 1)) * cW
  const yS = (v: number) => PAD.top + cH - ((v - minNeg) / range) * cH
  const zeroY = yS(0)

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(f => {
    const v = minNeg + f * range
    return { v, y: yS(v) }
  })

  const xStep = Math.max(1, Math.round(dates.length / 8))
  const xTicks = dates.map((d, i) => ({ d, i })).filter(({ i }) => i % xStep === 0)
  const todayIdx = dates.findIndex(
    d =>
      d.getFullYear() === CURRENT_MONTH.getFullYear() &&
      d.getMonth() === CURRENT_MONTH.getMonth()
  )

  const hovStack = hovered !== null ? stacks[hovered.idx] : null

  function handleSvgMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect()
    const svgX = ((e.clientX - rect.left) / rect.width) * W
    const idx = Math.max(
      0,
      Math.min(dates.length - 1, Math.round(((svgX - PAD.left) / cW) * (dates.length - 1)))
    )
    setHovered({ idx, x: e.clientX, y: e.clientY })
  }

  return (
    <div style={{ position: 'relative', userSelect: 'none' }}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height }}
        onMouseMove={handleSvgMouseMove}
        onMouseLeave={() => setHovered(null)}
      >
        {yTicks.map(t => (
          <g key={t.v}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={t.y}
              y2={t.y}
              stroke={Math.abs(t.v) < 0.0001 ? '#94a3b8' : '#e2e8f0'}
              strokeWidth={Math.abs(t.v) < 0.0001 ? 1 : 0.5}
            />
            <text x={PAD.left - 6} y={t.y + 4} textAnchor="end" fontSize={10} fill="#94a3b8">
              {t.v < 0
                ? `-$${Math.abs(t.v) >= 1000 ? (Math.abs(t.v) / 1000).toFixed(0) + 'k' : Math.abs(t.v).toFixed(0)}`
                : t.v >= 1000
                  ? `$${(t.v / 1000).toFixed(0)}k`
                  : `$${t.v.toFixed(0)}`}
            </text>
          </g>
        ))}

        {stacks.map(stack => {
          const cx = xS(stack.idx)
          const isHov = hovered?.idx === stack.idx

          return (
            <g key={stack.idx}>
              {stack.bars.map(bar => {
                if (bar.val === 0) return null
                const yTop = yS(bar.top)
                const yBottom = yS(bar.bottom)
                const rectY = Math.min(yTop, yBottom)
                const rectH = Math.max(0, Math.abs(yBottom - yTop))
                const isDimmed = focusedId != null && focusedId !== bar.loanId

                return (
                  <rect
                    key={bar.loanId}
                    x={cx - barW / 2}
                    y={rectY}
                    width={barW}
                    height={rectH}
                    fill={bar.color}
                    opacity={isDimmed ? 0.12 : isHov ? 1 : 0.85}
                  />
                )
              })}

              {isHov && (
                <rect
                  x={cx - barW / 2 - 1}
                  y={PAD.top}
                  width={barW + 2}
                  height={cH}
                  fill="rgba(15,23,42,0.04)"
                  rx={2}
                />
              )}
            </g>
          )
        })}

        {showTodayLine && todayIdx >= 0 && (
          <line
            x1={xS(todayIdx)}
            x2={xS(todayIdx)}
            y1={PAD.top}
            y2={H - PAD.bottom}
            stroke="#94a3b8"
            strokeWidth={1.5}
            strokeDasharray="4,3"
          />
        )}

        <line x1={PAD.left} x2={W - PAD.right} y1={zeroY} y2={zeroY} stroke="#94a3b8" strokeWidth={1} />

        {xTicks.map(({ d, i }) => (
          <text key={i} x={xS(i)} y={H - PAD.bottom + 14} textAnchor="middle" fontSize={10} fill="#94a3b8">
            {fmtMY(d)}
          </text>
        ))}
      </svg>

      {hovStack && hovered && (() => {
  const activeSeries = series.filter(s => !visibleIds || visibleIds.has(s.loanId))

  const cumulativeNet =
    (stacks[hovStack.idx]?.posTotal ?? 0) + (stacks[hovStack.idx]?.negTotal ?? 0)

    if (tooltipMode === 'loan-breakdown') {
      const principalSeries = activeSeries.find(s => s.loanId === 'principal')
      const interestSeries = activeSeries.find(s => s.loanId === 'interest')
      const feesSeries = activeSeries.find(s => s.loanId === 'fees')
    
      const cumulativePrincipal = principalSeries?.data.get(hovStack.ts) ?? 0
      const cumulativeInterest = interestSeries?.data.get(hovStack.ts) ?? 0
      const feesRaw = feesSeries?.data.get(hovStack.ts) ?? 0
      const cumulativeFees = Math.abs(feesRaw)
    
      const cumulativeNet = cumulativePrincipal + cumulativeInterest - cumulativeFees
    
      return (
        <Tooltip x={hovered.x} y={hovered.y}>
          <div
            style={{
              fontWeight: 700,
              fontSize: 13,
              marginBottom: 6,
              borderBottom: '1px solid rgba(255,255,255,0.15)',
              paddingBottom: 6,
            }}
          >
            Date: {fmtMY(hovStack.date)}
          </div>
    
          <div>Principal: <b>{fmt$(cumulativePrincipal)}</b></div>
          <div>Interest: <b>{fmt$(cumulativeInterest)}</b></div>
          <div>Fees: <b>{cumulativeFees === 0 ? '-$0.00' : `-${fmt$(cumulativeFees)}`}</b></div>
          <div>Cumulative Net: <b>{fmt$(cumulativeNet)}</b></div>
        </Tooltip>
      )
    }

    const breakdown = tooltipBreakdownByTs?.get(hovStack.ts)

    if (breakdown) {
      return (
        <Tooltip x={hovered.x} y={hovered.y}>
          <div
            style={{
              fontWeight: 700,
              fontSize: 13,
              marginBottom: 6,
              borderBottom: '1px solid rgba(255,255,255,0.15)',
              paddingBottom: 6,
            }}
          >
            Date: {fmtMY(hovStack.date)}
          </div>
    
          <div>Principal: <b>{fmt$(breakdown.principal)}</b></div>
          <div>Interest: <b>{fmt$(breakdown.interest)}</b></div>
          <div>Fees: <b>{breakdown.fees === 0 ? '-$0.00' : `-${fmt$(breakdown.fees)}`}</b></div>
          <div>Cumulative Net: <b>{fmt$(breakdown.net)}</b></div>
        </Tooltip>
      )
    }
    
    const visibleBars = hovStack.bars.filter(b => b.val !== 0)
    const monthNet = activeSeries.reduce((x, s) => x + (s.data.get(hovStack.ts) ?? 0), 0)
    
    return (
      <Tooltip x={hovered.x} y={hovered.y}>
        <div
          style={{
            fontWeight: 700,
            fontSize: 13,
            marginBottom: 4,
            borderBottom: '1px solid rgba(255,255,255,0.15)',
            paddingBottom: 6,
          }}
        >
          {fmtMY(hovStack.date)}
        </div>
    
        <div
          style={{
            marginBottom: 6,
            borderBottom: '1px solid rgba(255,255,255,0.12)',
            paddingBottom: 6,
          }}
        >
          <div>Month Net: <b>{fmt$(monthNet)}</b></div>
          <div>Cumulative: <b>{fmt$(cumulativeNet)}</b></div>
        </div>
    
        {!compact &&
          visibleBars
            .sort((a, b) => Math.abs(b.val) - Math.abs(a.val))
            .map(bar => {
              const s = series.find(s => s.loanId === bar.loanId)
              const dispVal = s?.data.get(hovStack.ts) ?? bar.val
              return (
                <div key={bar.loanId} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      background: bar.color,
                      borderRadius: 2,
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ color: '#94a3b8', fontSize: 11, flex: 1 }}>{s?.name}</span>
                  <span style={{ fontWeight: 600 }}>{fmt$(dispVal)}</span>
                </div>
              )
            })}
      </Tooltip>
    )
})()}
    </div>
  )
}

// ─── Line Chart ───────────────────────────────────────────────────────────────
function LineChart({ data, height = 260, color = '#0ea5e9', showTodayLine = true }: {
  data: { date: Date; y: number; cumNet?: number }[]
  height?: number; color?: string; showTodayLine?: boolean
}) {
  const [hovered, setHovered] = useState<number | null>(null)
  const [mouse,   setMouse]   = useState({ x: 0, y: 0 })

  const PAD = { top: 20, right: 16, bottom: 36, left: 80 }
  const W = 860, H = height
  const cW = W - PAD.left - PAD.right
  const cH = H - PAD.top - PAD.bottom
  const vals  = data.map(d => d.y)
  const minV  = Math.min(...vals, 0)
  const maxV  = Math.max(...vals, 1)
  const range = maxV - minV || 1
  const xS = (i: number) => PAD.left + (i / Math.max(data.length - 1, 1)) * cW
  const yS = (v: number) => PAD.top + cH - ((v - minV) / range) * cH
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map(f => ({ v: minV + f * range, y: yS(minV + f * range) }))
  const xStep  = Math.max(1, Math.round(data.length / 7))
  const xTicks = data.map((d, i) => ({ d, i })).filter(({ i }) => i % xStep === 0)
  const todayIdx = data.findIndex(d => d.date.getFullYear() === CURRENT_MONTH.getFullYear() && d.date.getMonth() === CURRENT_MONTH.getMonth())
  const pathD = data.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${xS(i).toFixed(1)} ${yS(pt.y).toFixed(1)}`).join(' ')

  return (
    <div style={{ position: 'relative', userSelect: 'none' }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height }}
        onMouseLeave={() => setHovered(null)}
        onMouseMove={e => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
          const svgX = ((e.clientX - rect.left) / rect.width) * W
          const idx  = Math.max(0, Math.min(data.length - 1, Math.round(((svgX - PAD.left) / cW) * (data.length - 1))))
          setHovered(idx); setMouse({ x: e.clientX, y: e.clientY })
        }}
      >
        {yTicks.map(t => (
          <g key={t.v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={t.y} y2={t.y} stroke="#e2e8f0" strokeWidth={0.5} />
            <text x={PAD.left - 6} y={t.y + 4} textAnchor="end" fontSize={10} fill="#94a3b8">
              {t.v >= 1000 ? `$${(t.v / 1000).toFixed(0)}k` : `$${t.v.toFixed(0)}`}
            </text>
          </g>
        ))}
        <path d={`${pathD} L ${xS(data.length - 1)} ${yS(minV)} L ${xS(0)} ${yS(minV)} Z`} fill={color} opacity={0.08} />
        <path d={pathD} fill="none" stroke={color} strokeWidth={2.2} />
        {showTodayLine && todayIdx >= 0 && (
          <line x1={xS(todayIdx)} x2={xS(todayIdx)} y1={PAD.top} y2={H - PAD.bottom}
            stroke="#94a3b8" strokeWidth={1.5} strokeDasharray="4,3" />
        )}
        {hovered !== null && <circle cx={xS(hovered)} cy={yS(data[hovered].y)} r={5} fill={color} stroke="#fff" strokeWidth={2} />}
        {xTicks.map(({ d, i }) => (
          <text key={i} x={xS(i)} y={H - PAD.bottom + 14} textAnchor="middle" fontSize={10} fill="#94a3b8">
            {fmtMY(d.date)}
          </text>
        ))}
      </svg>
      {hovered !== null && (
        <Tooltip x={mouse.x} y={mouse.y}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 6, borderBottom: '1px solid rgba(255,255,255,0.15)', paddingBottom: 6 }}>
            {fmtMY(data[hovered].date)}
          </div>
          <div>Avg / Month: <b>{fmt$(data[hovered].y)}</b></div>
          {data[hovered].cumNet != null && <div>Net to Date: <b>{fmt$(data[hovered].cumNet!)}</b></div>}
        </Tooltip>
      )}
    </div>
  )
}

// ─── DrawerShell ──────────────────────────────────────────────────────────────
// KEY FIX: Removed the transparent full-screen backdrop div that was catching
// all clicks (including KPI tiles and loan rows) and closing the drawer.
// Now only the ✕ button closes the drawer — clicks on the main page are unaffected.
/* delete
function DrawerShell({ open, title, subTitle, onClose, children }: {
  open: boolean; title: string; subTitle?: string; onClose: () => void; children: React.ReactNode
}) {
  if (!open) return null
  return (
    <div onClick={e => e.stopPropagation()} style={{
      position: 'fixed', right: 0, top: 0, height: '100vh', width: 620,
      background: '#fff', borderLeft: '1px solid #e2e8f0',
      boxShadow: '-28px 0 80px rgba(15,23,42,0.14)',
      display: 'flex', flexDirection: 'column', zIndex: 90,
      animation: 'drawerSlideIn 0.22s cubic-bezier(0.25,1,0.5,1) backwards',
    }}>
      <style>{`@keyframes drawerSlideIn{from{transform:translateX(100%)}}`}</style>
      <div style={{ padding: '20px 20px 14px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', borderBottom: '1px solid #e2e8f0', flexShrink: 0 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: '#0f172a' }}>{title}</h2>
          {subTitle && <div style={{ fontSize: 13, color: '#64748b', marginTop: 4, lineHeight: 1.4, whiteSpace: 'pre-line' }}>{subTitle}</div>}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
          <button style={{ padding: '5px 12px', borderRadius: 7, border: '1px solid #e2e8f0', background: 'transparent', cursor: 'pointer', fontWeight: 600, fontSize: 12, color: '#0f172a' }}>Download CSV</button>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: 20, lineHeight: 1, padding: '2px 6px', borderRadius: 6 }}>✕</button>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '16px 20px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {children}
      </div>
      <div style={{ padding: '10px 20px', borderTop: '1px solid #e2e8f0', display: 'flex', gap: 8, background: '#fff', flexShrink: 0 }}>
        <button style={{ padding: '6px 14px', borderRadius: 7, border: '1px solid #e2e8f0', background: 'transparent', cursor: 'pointer', fontWeight: 600, fontSize: 12, color: '#0f172a' }} onClick={() => window.print()}>Print</button>
        <button style={{ padding: '6px 14px', borderRadius: 7, border: 'none', background: '#0ea5e9', cursor: 'pointer', fontWeight: 600, fontSize: 12, color: '#fff' }}>Copy CSV</button>
      </div>
    </div>
  )
}
*/


function StatBar({ items }: { items: { label: string; value: string; flex?: number }[] }) {
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      {items.map(item => (
        <div key={item.label} style={{ flex: item.flex ?? 1, background: '#f8fafc', padding: '10px 14px', borderRadius: 8, border: '1px solid #e2e8f0' }}>
          <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{item.label}</div>
          <div style={{ fontSize: item.flex != null && item.flex < 1 ? 16 : 22, fontWeight: 800, color: '#0f172a' }}>{item.value}</div>
        </div>
      ))}
    </div>
  )
}

function ChartBox({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: 'linear-gradient(180deg,#fff,#fcfeff)', borderRadius: 8, border: '1px solid rgba(15,23,42,0.06)', boxShadow: '0 6px 18px rgba(15,23,42,0.06)', padding: 8 }}>
      {children}
    </div>
  )
}

// ─── Individual Loan Drawer ───────────────────────────────────────────────────
function LoanEarningsDrawerBody({ loan }: { loan: any }) {
  const sched = getLoanEarningsSchedule(loan)
  const netToDate  = loanNetToDate(loan)
  const feesToDate = loanFeesToDate(loan)

  const chartDates = useMemo(() => {
    const seen = new Set<number>()
    const out: Date[] = []
    sched.forEach((r: any) => {
      if (!(r.loanDate instanceof Date)) return
      const t = new Date(r.loanDate.getFullYear(), r.loanDate.getMonth(), 1).getTime()
      if (!seen.has(t)) {
        seen.add(t)
        out.push(new Date(t))
      }
    })
    return out.sort((a, b) => a.getTime() - b.getTime())
  }, [sched])

  const principalSeries: BarSeries = useMemo(() => {
    let running = 0
    const data = new Map<number, number>()
  
    chartDates.forEach(d => {
      const ts = d.getTime()
      const row = sched.find(
        (r: any) =>
          r.loanDate instanceof Date &&
          r.loanDate.getFullYear() === d.getFullYear() &&
          r.loanDate.getMonth() === d.getMonth()
      )
      running += row ? getRowMonthlyPrincipal(row) : 0
      data.set(ts, running)
    })
  
    return {
      loanId: 'principal',
      name: 'Principal',
      color: '#0ea5e9',
      data,
    }
  }, [sched, chartDates])
  
  const interestSeries: BarSeries = useMemo(() => {
    let running = 0
    const data = new Map<number, number>()
  
    chartDates.forEach(d => {
      const ts = d.getTime()
      const row = sched.find(
        (r: any) =>
          r.loanDate instanceof Date &&
          r.loanDate.getFullYear() === d.getFullYear() &&
          r.loanDate.getMonth() === d.getMonth()
      )
      running += row ? getRowMonthlyInterest(row) : 0
      data.set(ts, running)
    })
  
    return {
      loanId: 'interest',
      name: 'Interest',
      color: '#22c55e',
      data,
    }
  }, [sched, chartDates])
  
  const feesSeries: BarSeries = useMemo(() => {
    let running = 0
    const data = new Map<number, number>()
  
    chartDates.forEach(d => {
      const ts = d.getTime()
      const row = sched.find(
        (r: any) =>
          r.loanDate instanceof Date &&
          r.loanDate.getFullYear() === d.getFullYear() &&
          r.loanDate.getMonth() === d.getMonth()
      )
      running += row ? getRowMonthlyFees(row) : 0
      data.set(ts, -running)
    })
  
    return {
      loanId: 'fees',
      name: 'Fees',
      color: '#ef4444',
      data,
    }
  }, [sched, chartDates])

  return (
    <>
      <ChartBox>
      <StackedBarChart
  series={[principalSeries, interestSeries, feesSeries]}
  dates={chartDates}
  height={240}
  showTodayLine
  visibleIds={new Set(['principal', 'interest', 'fees'])}
  tooltipMode="loan-breakdown"
/>
      </ChartBox>

      <StatBar items={[
        { label: 'Net Earnings to Date', value: fmt$(netToDate), flex: 2 },
        { label: 'Fees to Date',         value: fmt$(feesToDate), flex: 1 },
      ]} />

      <div>
        <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a', marginBottom: 8 }}>Earnings Breakdown by Month</div>
        <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, maxHeight: '45vh', overflow: 'auto', background: '#fff' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={drawerThStyle}>Date</th>
                <th style={drawerThR}>Principal</th>
                <th style={drawerThR}>Interest</th>
                <th style={drawerThR}>Fees</th>
                <th style={drawerThR}>Net Earnings</th>
              </tr>
            </thead>
            <tbody>
              {sched.map((r: any, i: number) => {
                const principal = getRowMonthlyPrincipal(r)
                const interest  = getRowMonthlyInterest(r)
                const fee       = getRowMonthlyFees(r)
                const net       = getRowMonthlyNet(r)
                const isCurrent = r.loanDate instanceof Date &&
                  r.loanDate.getFullYear() === CURRENT_MONTH.getFullYear() &&
                  r.loanDate.getMonth() === CURRENT_MONTH.getMonth()
                const isDeferral = r.isDeferralMonth ?? r.isDeferred ?? false
                const isPrepay   = (r.prepaymentPrincipal ?? r.prepayment ?? 0) > 0
                const isTerminal = r.isTerminal ?? false
                const rowBg = isPrepay ? 'rgba(22,163,74,0.12)'
                  : isTerminal ? 'rgba(220,38,38,0.10)'
                  : isDeferral ? 'rgba(234,179,8,0.13)'
                  : i % 2 === 1 ? 'rgba(15,23,42,0.015)' : 'transparent'
                return (
                  <tr key={i} style={{ background: isCurrent ? 'rgba(14,165,233,0.08)' : rowBg }}>
                    <td style={{ padding: '7px 10px', color: isCurrent ? '#0ea5e9' : '#0f172a', fontWeight: isCurrent ? 700 : 400 }}>
                      {r.loanDate instanceof Date ? fmtMY(r.loanDate) : '—'}
                    </td>
                    <td style={{ padding: '7px 10px', textAlign: 'right', color: '#64748b' }}>{fmt$(principal)}</td>
                    <td style={{ padding: '7px 10px', textAlign: 'right', color: '#64748b' }}>{fmt$(interest)}</td>
                    <td style={{ padding: '7px 10px', textAlign: 'right', color: fee > 0 ? '#dc2626' : '#64748b' }}>{fee !== 0 ? `-${fmt$(fee)}` : '-$0.00'}</td>
                    <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700, color: net >= 0 ? '#16a34a' : '#dc2626' }}>{fmt$(net)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

// ─── KPI Drawer Body ──────────────────────────────────────────────────────────
function KpiEarningsDrawerBody({ kpi, loansWithRoi }: { kpi: EarningsKpiKey; loansWithRoi: any[] }) {
  const [focusedId,  setFocusedId]  = useState<string | null>(null)
  const [visibleIds, setVisibleIds] = useState<Set<string>>(() =>
    new Set(loansWithRoi.map((l: any) => String(l.loanId ?? l.id ?? '')))
  )

  const toggleId = useCallback((id: string) => {
    setVisibleIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next })
  }, [])

  const allDates      = useMemo(() => allOwnedMonths(loansWithRoi), [loansWithRoi])
  const historicDates = useMemo(() => ownedMonthsToDate(loansWithRoi), [loansWithRoi])

  const series: BarSeries[] = useMemo(() => loansWithRoi.map((loan: any) => {
    const id  = String(loan.loanId ?? loan.id ?? '')
    const data = new Map<number, number>()
    getLoanEarningsSchedule(loan).forEach((r: any) => {
      if (!(r.loanDate instanceof Date)) return
      const ts = new Date(r.loanDate.getFullYear(), r.loanDate.getMonth(), 1).getTime()
      data.set(ts, getRowMonthlyNet(r))
    })
    return { loanId: id, name: loan.loanName ?? loan.name ?? id, color: loan.loanColor ?? loan.color ?? '#64748b', data }
  }), [loansWithRoi])

  const cumulativeBreakdownByTs = useMemo(() => {
    const sourceDates = kpi === 'kpi1' ? historicDates : allDates
  
    let runningPrincipal = 0
    let runningInterest = 0
    let runningFees = 0
  
    const out = new Map<number, {
      principal: number
      interest: number
      fees: number
      net: number
    }>()
  
    sourceDates.forEach(d => {
      const ts = d.getTime()
  
      let monthPrincipal = 0
      let monthInterest = 0
      let monthFees = 0
  
      loansWithRoi.forEach((loan: any) => {
        getLoanEarningsSchedule(loan).forEach((r: any) => {
          if (!(r.loanDate instanceof Date)) return
          if (
            r.loanDate.getFullYear() === d.getFullYear() &&
            r.loanDate.getMonth() === d.getMonth()
          ) {
            monthPrincipal += getRowMonthlyPrincipal(r)
            monthInterest += getRowMonthlyInterest(r)
            monthFees += getRowMonthlyFees(r)
          }
        })
      })
  
      runningPrincipal += monthPrincipal
      runningInterest += monthInterest
      runningFees += monthFees
  
      out.set(ts, {
        principal: runningPrincipal,
        interest: runningInterest,
        fees: runningFees,
        net: runningPrincipal + runningInterest - runningFees,
      })
    })
  
    return out
  }, [loansWithRoi, historicDates, allDates, kpi])


  const loanTotals = useMemo(() => loansWithRoi.map((loan: any) => {
    const id  = String(loan.loanId ?? loan.id ?? '')
    const sched = getLoanEarningsSchedule(loan)
    const toDate  = sched.filter((r: any) => r.loanDate instanceof Date && r.loanDate <= CURRENT_MONTH)
    const allRows = sched
    const netToDate     = toDate.reduce((s: number, r: any) => s + getRowMonthlyNet(r), 0)
    const projNet       = allRows.reduce((s: number, r: any) => s + getRowMonthlyNet(r), 0)
    const principal     = toDate.reduce((s: number, r: any) => s + getRowMonthlyPrincipal(r), 0)
    const interest      = toDate.reduce((s: number, r: any) => s + getRowMonthlyInterest(r), 0)
    const fees          = toDate.reduce((s: number, r: any) => s + getRowMonthlyFees(r), 0)
    const projPrincipal = allRows.reduce((s: number, r: any) => s + getRowMonthlyPrincipal(r), 0)
    const projInterest  = allRows.reduce((s: number, r: any) => s + getRowMonthlyInterest(r), 0)
    const projFees      = allRows.reduce((s: number, r: any) => s + getRowMonthlyFees(r), 0)
    const monthsToDate  = toDate.length
    const totalMonths   = allRows.length
    const avgToDate     = monthsToDate > 0 ? netToDate / monthsToDate : 0
    const avgProj       = totalMonths  > 0 ? projNet   / totalMonths  : 0
    const lastRow       = sched.length > 0 ? sched[sched.length - 1] : null
    const matDate: Date | null = lastRow?.loanDate instanceof Date ? lastRow.loanDate : null
    const purchaseDate  = loan.purchaseDate ? (() => { try { return new Date(loan.purchaseDate) } catch { return null } })() : null
    const purchasePrice = Number(loan.purchasePrice ?? loan.userPurchasePrice ?? 0)
    return { id, loan, netToDate, projNet, principal, interest, fees, projPrincipal, projInterest, projFees, monthsToDate, totalMonths, avgToDate, avgProj, matDate, purchaseDate, purchasePrice }
  }), [loansWithRoi])

  const totalNetToDate   = loanTotals.reduce((s, t) => s + t.netToDate, 0)
  const totalProjNet     = loanTotals.reduce((s, t) => s + t.projNet,   0)
  const totalFeesToDate  = loanTotals.reduce((s, t) => s + t.fees,      0)
  const totalProjFees    = loanTotals.reduce((s, t) => s + t.projFees,  0)
  const avgMonthlyToDate = historicDates.length > 0 ? totalNetToDate / historicDates.length : 0
  const avgMonthlyProj   = allDates.length > 0      ? totalProjNet   / allDates.length      : 0

  const avgToDateLine = useMemo(() => {
    let cumNet = 0
    return historicDates.map((d, idx) => {
      const ts = d.getTime()
      series.forEach(s => { cumNet += s.data.get(ts) ?? 0 })
      return { date: d, y: cumNet / (idx + 1), cumNet }
    })
  }, [series, historicDates])

  const avgProjLine = useMemo(() => {
    let cumNet = 0
    return allDates.map((d, idx) => {
      const ts = d.getTime()
      series.forEach(s => { cumNet += s.data.get(ts) ?? 0 })
      return { date: d, y: cumNet / (idx + 1), cumNet }
    })
  }, [series, allDates])

  function ToggleCell({ t }: { t: typeof loanTotals[0] }) {
    const color = t.loan.loanColor ?? t.loan.color ?? '#64748b'
    const isOn  = visibleIds.has(t.id)
    const isFoc = focusedId === t.id
    return (
      <td style={{ padding: '9px 10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button onClick={e => { e.stopPropagation(); toggleId(t.id) }}
            style={{ width: 14, height: 14, borderRadius: 3, flexShrink: 0, background: isOn ? color : '#e2e8f0', border: isFoc ? `2px solid ${color}` : '2px solid transparent', cursor: 'pointer', padding: 0, transition: 'background 0.15s' }}
            title={isOn ? 'Hide from chart' : 'Show on chart'}
          />
          <div>
            <div style={{ fontWeight: 600, fontSize: 13, color: isOn ? color : '#94a3b8' }}>{t.loan.loanName ?? t.loan.name}</div>
            <div style={{ fontSize: 11, color: '#94a3b8' }}>{t.loan.school}</div>
          </div>
        </div>
      </td>
    )
  }

  function FocusRow({ t, children }: { t: typeof loanTotals[0]; children: React.ReactNode }) {
    const isFoc = focusedId === t.id
    const isDim = focusedId != null && !isFoc
    return (
      <tr style={{ borderBottom: '1px solid #f1f5f9', background: isFoc ? 'rgba(148,163,184,0.08)' : 'transparent', opacity: isDim ? 0.3 : 1, transition: 'opacity 0.15s' }}
        onMouseEnter={() => setFocusedId(t.id)}
        onMouseLeave={() => setFocusedId(null)}
      >
        {children}
      </tr>
    )
  }

  const cfgs = {
    kpi1: {
      stat:  [{ label: 'Net Earnings to Date', value: fmt$(totalNetToDate), flex: 2 }, { label: 'Total Fees to Date', value: fmt$(totalFeesToDate), flex: 1 }],
      chart: <StackedBarChart series={series} dates={historicDates} height={260} cumulative visibleIds={visibleIds} focusedId={focusedId} showTodayLine compact tooltipBreakdownByTs={cumulativeBreakdownByTs} />,
      title: 'Total Net Earnings to Date',
      table: (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr>
            <th style={{ ...drawerThStyle, minWidth: 160 }}>Loan</th>
            <th style={drawerThR}>Net Earnings</th><th style={drawerThR}>Principal</th><th style={drawerThR}>Interest</th><th style={drawerThR}>Fees</th>
          </tr></thead>
          <tbody>{loanTotals.map(t => (
            <FocusRow key={t.id} t={t}>
              <ToggleCell t={t} />
              <td style={{ padding: '9px 10px', textAlign: 'right', fontWeight: 700, color: '#16a34a' }}>{fmt$(t.netToDate)}</td>
              <td style={{ padding: '9px 10px', textAlign: 'right', color: '#64748b' }}>{fmt$(t.principal)}</td>
              <td style={{ padding: '9px 10px', textAlign: 'right', color: '#64748b' }}>{fmt$(t.interest)}</td>
              <td style={{ padding: '9px 10px', textAlign: 'right', color: t.fees > 0 ? '#dc2626' : '#94a3b8' }}>{t.fees > 0 ? `-${fmt$(t.fees)}` : '-$0.00'}</td>
            </FocusRow>
          ))}</tbody>
        </table>
      ),
    },
    kpi2: {
      stat:  [{ label: 'Projected Net Earnings', value: fmt$(totalProjNet), flex: 2 }, { label: 'Projected Total Fees', value: fmt$(totalProjFees), flex: 1 }],
      chart: <StackedBarChart series={series} dates={allDates} height={260} cumulative visibleIds={visibleIds} focusedId={focusedId} showTodayLine compact tooltipBreakdownByTs={cumulativeBreakdownByTs} />,
      title: 'Projected Total Net Earnings',
      table: (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr>
            <th style={{ ...drawerThStyle, minWidth: 160 }}>Loan</th>
            <th style={drawerThR}>Projected Net</th><th style={drawerThR}>Principal</th><th style={drawerThR}>Interest</th><th style={drawerThR}>Fees</th>
          </tr></thead>
          <tbody>{loanTotals.map(t => (
            <FocusRow key={t.id} t={t}>
              <ToggleCell t={t} />
              <td style={{ padding: '9px 10px', textAlign: 'right', fontWeight: 700, color: t.loan.loanColor ?? t.loan.color ?? '#0f172a' }}>{fmt$(t.projNet)}</td>
              <td style={{ padding: '9px 10px', textAlign: 'right', color: '#64748b' }}>{fmt$(t.projPrincipal)}</td>
              <td style={{ padding: '9px 10px', textAlign: 'right', color: '#64748b' }}>{fmt$(t.projInterest)}</td>
              <td style={{ padding: '9px 10px', textAlign: 'right', color: t.projFees > 0 ? '#dc2626' : '#94a3b8' }}>{t.projFees > 0 ? `-${fmt$(t.projFees)}` : '-$0.00'}</td>
            </FocusRow>
          ))}</tbody>
        </table>
      ),
    },
    kpi3: {
      stat:  [{ label: 'Avg Monthly Earnings to Date', value: fmt$(avgMonthlyToDate), flex: 2 }, { label: 'Months Counted', value: String(historicDates.length), flex: 1 }],
      chart: <LineChart data={avgToDateLine} height={260} color="#0ea5e9" showTodayLine />,
      title: 'Avg Monthly Earnings to Date',
      table: (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr>
            <th style={{ ...drawerThStyle, minWidth: 160 }}>Loan</th>
            <th style={drawerThR}>Avg Monthly Earnings to Date</th><th style={drawerThR}>Purchase Date</th><th style={drawerThR}>Maturity Date</th>
          </tr></thead>
          <tbody>{loanTotals.map(t => (
            <FocusRow key={t.id} t={t}>
              <td style={{ padding: '9px 10px' }}><div><div style={{ fontWeight: 600, fontSize: 13 }}>{t.loan.loanName ?? t.loan.name}</div><div style={{ fontSize: 11, color: '#94a3b8' }}>{t.loan.school}</div></div></td>
              <td style={{ padding: '9px 10px', textAlign: 'right', fontWeight: 700 }}>{fmt$(t.avgToDate)}</td>
              <td style={{ padding: '9px 10px', textAlign: 'right', color: '#94a3b8', fontSize: 12 }}>{t.purchaseDate ? fmtDate(t.purchaseDate) : '—'}</td>
              <td style={{ padding: '9px 10px', textAlign: 'right', color: '#94a3b8', fontSize: 12 }}>{t.matDate ? fmtMY(t.matDate) : '—'}</td>
            </FocusRow>
          ))}</tbody>
        </table>
      ),
    },
    kpi4: {
      stat:  [{ label: 'Avg / Month (Projected)', value: fmt$(avgMonthlyProj), flex: 2 }, { label: 'Months Through Maturity', value: String(allDates.length), flex: 1 }],
      chart: <LineChart data={avgProjLine} height={260} color="#0ea5e9" showTodayLine />,
      title: 'Projected Avg Monthly Earnings',
      table: (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead><tr>
            <th style={{ ...drawerThStyle, minWidth: 160 }}>Loan</th>
            <th style={drawerThR}>Proj Avg Monthly</th><th style={drawerThR}>Projected Net</th><th style={drawerThR}>Purchase Price</th><th style={drawerThR}>Maturity Date</th>
          </tr></thead>
          <tbody>{loanTotals.map(t => (
            <FocusRow key={t.id} t={t}>
              <td style={{ padding: '9px 10px' }}><div><div style={{ fontWeight: 600, fontSize: 13 }}>{t.loan.loanName ?? t.loan.name}</div><div style={{ fontSize: 11, color: '#94a3b8' }}>{t.loan.school}</div></div></td>
              <td style={{ padding: '9px 10px', textAlign: 'right', fontWeight: 700 }}>{fmt$(t.avgProj)}</td>
              <td style={{ padding: '9px 10px', textAlign: 'right', color: '#64748b' }}>{fmt$(t.projNet)}</td>
              <td style={{ padding: '9px 10px', textAlign: 'right', color: '#64748b' }}>{fmt$(t.purchasePrice)}</td>
              <td style={{ padding: '9px 10px', textAlign: 'right', color: '#94a3b8', fontSize: 12 }}>{t.matDate ? fmtMY(t.matDate) : '—'}</td>
            </FocusRow>
          ))}</tbody>
        </table>
      ),
    },
  }

  const cfg = cfgs[kpi]
  return (
    <>
      <ChartBox>{cfg.chart}</ChartBox>
      <StatBar items={cfg.stat} />
      <div>
        <div style={{ fontWeight: 700, fontSize: 14, color: '#0f172a', marginBottom: 8 }}>{cfg.title}</div>
        <div style={{ border: '1px solid #e2e8f0', borderRadius: 8, maxHeight: '45vh', overflow: 'auto', background: '#fff' }}>
          {cfg.table}
        </div>
      </div>
    </>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────


export default function EarningsDetailPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const initialKpi = (searchParams.get('kpi') as EarningsKpiKey) || null
  const initialLoanId = searchParams.get('loan') || null

  const [drawerOpen, setDrawerOpen] = useState(!!(initialKpi || initialLoanId))
  const [drawerMode, setDrawerMode] = useState<DrawerMode>(initialLoanId ? { kind: 'loan', loanId: initialLoanId } : initialKpi ? { kind: 'kpi', kpi: initialKpi } : null)

  const navigate   = useNavigate()
  const { userId } = useUser()
  const { loansWithRoi, earningsKpis, loading, error } = usePortfolio(userId)

  const [filterName,   setFilterName]   = useState('')
  const [filterSchool, setFilterSchool] = useState('')
  const [filterRate,   setFilterRate]   = useState('')
  const [sortKey,      setSortKey]      = useState('')

  const loanNames = useMemo(() => [...new Set(loansWithRoi.map((l: any) => l.loanName ?? l.name ?? ''))].filter(Boolean).sort(), [loansWithRoi])
  const schools   = useMemo(() => [...new Set(loansWithRoi.map((l: any) => l.school ?? ''))].filter(Boolean).sort(), [loansWithRoi])

  const filteredLoans = useMemo(() => {
    let rows = [...loansWithRoi]
    if (filterName)   rows = rows.filter((l: any) => (l.loanName ?? l.name) === filterName)
    if (filterSchool) rows = rows.filter((l: any) => l.school === filterSchool)
    if (filterRate === 'low')  rows = rows.filter((l: any) => { const r = Number(l.nominalRate ?? 0); return (r < 1 ? r * 100 : r) < 5 })
    if (filterRate === 'mid')  rows = rows.filter((l: any) => { const r = Number(l.nominalRate ?? 0); const rp = r < 1 ? r * 100 : r; return rp >= 5 && rp <= 8 })
    if (filterRate === 'high') rows = rows.filter((l: any) => { const r = Number(l.nominalRate ?? 0); return (r < 1 ? r * 100 : r) > 8 })
    if (sortKey === 'purchase_asc')  rows.sort((a: any, b: any) => String(a.purchaseDate).localeCompare(String(b.purchaseDate)))
    if (sortKey === 'purchase_desc') rows.sort((a: any, b: any) => String(b.purchaseDate).localeCompare(String(a.purchaseDate)))
    if (sortKey === 'amount_asc')    rows.sort((a: any, b: any) => Number(a.principal ?? a.origLoanAmt ?? 0) - Number(b.principal ?? b.origLoanAmt ?? 0))
    if (sortKey === 'amount_desc')   rows.sort((a: any, b: any) => Number(b.principal ?? b.origLoanAmt ?? 0) - Number(a.principal ?? a.origLoanAmt ?? 0))
    if (sortKey === 'rate_asc')      rows.sort((a: any, b: any) => Number(a.nominalRate ?? 0) - Number(b.nominalRate ?? 0))
    if (sortKey === 'rate_desc')     rows.sort((a: any, b: any) => Number(b.nominalRate ?? 0) - Number(a.nominalRate ?? 0))
    if (sortKey === 'earnings_asc')  rows.sort((a: any, b: any) => loanNetToDate(a) - loanNetToDate(b))
    if (sortKey === 'earnings_desc') rows.sort((a: any, b: any) => loanNetToDate(b) - loanNetToDate(a))
    return rows
  }, [loansWithRoi, filterName, filterSchool, filterRate, sortKey])

  function resetFilters() { setFilterName(''); setFilterSchool(''); setFilterRate(''); setSortKey('') }

  function handleKpiClick(key: EarningsKpiKey) {
    setDrawerMode({ kind: 'kpi', kpi: key })
    setDrawerOpen(true)
    setSearchParams({ kpi: key })
  }
  function handleLoanRowClick(loan: any) {
    const loanId = String(loan.loanId ?? loan.id ?? '')
    setDrawerMode({ kind: 'loan', loanId })
    setDrawerOpen(true)
    setSearchParams({ loan: loanId })
  }
  function closeDrawer() {
    setDrawerOpen(false)
    setDrawerMode(null)
    setSearchParams({})
  }

  const drawerTitle = (() => {
    if (!drawerMode) return ''
    if (drawerMode.kind === 'kpi') return ({ kpi1: 'Total Net Earnings to Date', kpi2: 'Projected Total Net Earnings', kpi3: 'Avg Monthly Earnings to Date', kpi4: 'Projected Avg Monthly Earnings' } as Record<EarningsKpiKey, string>)[drawerMode.kpi]
    const loan = loansWithRoi.find((l: any) => String(l.loanId ?? l.id) === drawerMode.loanId)
    const pct  = loan ? Math.round(getOwnershipPct(loan) * 100) : null
    return loan ? `${loan.loanName ?? loan.name ?? drawerMode.loanId}${pct != null && pct !== 100 ? ` (${pct}% owned)` : ''}` : drawerMode.loanId
  })()

  const drawerSubTitle = (() => {
    if (!drawerMode) return undefined
    if (drawerMode.kind === 'kpi') return ({ kpi1: 'Portfolio-level earnings across all loans.', kpi2: 'Projected lifetime earnings across all loans, assuming full term.', kpi3: 'Total net earnings divided by months since the first month with earnings data.', kpi4: 'Average net earnings per month (historical → projected) across the full lifetime of the portfolio.' } as Record<EarningsKpiKey, string>)[drawerMode.kpi]
    const loan = loansWithRoi.find((l: any) => String(l.loanId ?? l.id) === drawerMode.loanId)
    if (!loan) return undefined
    const origAmt = Number(loan.originalLoanAmount ?? loan.origLoanAmt ?? loan.loanAmount ?? loan.principal ?? 0)
    const sched   = getLoanEarningsSchedule(loan)
    const lastRow = sched.length > 0 ? sched[sched.length - 1] : null
    const matDate = lastRow?.loanDate instanceof Date ? `Matures ${fmtMY(lastRow.loanDate)}` : ''
    return `${loan.school ?? ''}\nPurchased ${loan.purchaseDate} · ${matDate} · Orig Loan Amt ${fmt$(origAmt)}`
  })()

  const activeLoan = drawerMode?.kind === 'loan'
    ? loansWithRoi.find((l: any) => String(l.loanId ?? l.id) === drawerMode.loanId)
    : null

  const loansForTable = useMemo(() => filteredLoans.map((l: any) => ({
    ...l, _earningsToDate: loanNetToDate(l),
  })), [filteredLoans])

  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: '#64748b', fontSize: 15 }}>Loading portfolio…</div>
  if (error)   return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', color: '#ef4444', fontSize: 15 }}>Error: {error}</div>

  const kpis: { key: EarningsKpiKey; label: string; value: string }[] = [
    { key: 'kpi1', label: 'Net Earnings to Date',         value: fmt$(earningsKpis.netEarningsToDate ?? 0) },
    { key: 'kpi2', label: 'Projected Lifetime Earnings',  value: fmt$(earningsKpis.projectedLifetimeEarnings ?? 0) },
    { key: 'kpi3', label: 'Avg Monthly Earnings to Date', value: fmt$(earningsKpis.avgMonthlyEarningsToDate ?? 0) },
    { key: 'kpi4', label: 'Projected Avg Monthly',        value: fmt$(earningsKpis.projectedAvgMonthlyEarnings ?? 0) },
  ]

  return (
    <div
  style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}
  onClick={(e) => {
    const target = e.target as HTMLElement

    if (target.closest('[data-drawer-shell="true"]')) return
    if (target.closest('[data-drawer-open="true"]')) return

    closeDrawer()
  }}
>
<div style={{ padding: '14px 20px 0', flexShrink: 0 }}>
<button
  type="button"
  data-drawer-open="true"
  onClick={() => navigate('/')}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: '#64748b',
            fontSize: 13,
            fontWeight: 500,
            marginBottom: 10,
            padding: 0,
          }}
          onMouseEnter={e => {
            e.currentTarget.style.color = '#0ea5e9'
          }}
          onMouseLeave={e => {
            e.currentTarget.style.color = '#64748b'
          }}
        >
          ← Back to My Holdings
        </button>
        <h1 style={{ margin: '0 0 2px', fontSize: 20, fontWeight: 800, color: '#0f172a' }}>Loan Portfolio — Earnings</h1>
        <p style={{ margin: 0, fontSize: 13, color: '#64748b' }}>Cumulative principal, interest, and fees for each loan and for the portfolio.</p>
        <p style={{ margin: '4px 0 12px', fontSize: 13, color: '#64748b' }}>Current Date: {fmtMY(new Date())}</p>
      </div>

      <div style={{ display: 'flex', gap: 10, padding: '0 20px 14px', flexShrink: 0 }}>
        {kpis.map(k => (
          <div
          key={k.key}
          data-drawer-open="true"
          onClick={() => handleKpiClick(k.key)}
          style={{
            flex: 1,
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 10,
            padding: '12px 16px',
            cursor: 'pointer',
            boxShadow: '0 1px 4px rgba(15,23,42,0.06)',
            transition: 'transform 0.15s, box-shadow 0.15s'
          }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(15,23,42,0.10)' }}
            onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 1px 4px rgba(15,23,42,0.06)' }}
          >
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 6 }}>{k.label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: '#0f172a' }}>{k.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '0 20px 12px', flexShrink: 0, flexWrap: 'wrap' }}>
        <select value={filterName}   onChange={e => setFilterName(e.target.value)}   style={filterSelectStyle}><option value="">Name</option>{loanNames.map((n: string) => <option key={n} value={n}>{n}</option>)}</select>
        <select value={filterSchool} onChange={e => setFilterSchool(e.target.value)} style={filterSelectStyle}><option value="">School</option>{schools.map((s: string) => <option key={s} value={s}>{s}</option>)}</select>
        <select value={filterRate}   onChange={e => setFilterRate(e.target.value)}   style={filterSelectStyle}>
          <option value="">Rate</option><option value="low">Below 5%</option><option value="mid">5% – 8%</option><option value="high">Above 8%</option>
        </select>
        <select value={sortKey} onChange={e => setSortKey(e.target.value)} style={filterSelectStyle}>
          <option value="">Sort</option>
          <option value="purchase_asc">Purchase Date ↑</option><option value="purchase_desc">Purchase Date ↓</option>
          <option value="amount_asc">Orig Amt ↑</option><option value="amount_desc">Orig Amt ↓</option>
          <option value="rate_asc">Rate ↑</option><option value="rate_desc">Rate ↓</option>
          <option value="earnings_asc">Earnings ↑</option><option value="earnings_desc">Earnings ↓</option>
        </select>
        <button onClick={resetFilters} style={filterSelectStyle}>Reset</button>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 13, color: '#64748b', fontWeight: 500 }}>{filteredLoans.length} loan{filteredLoans.length !== 1 ? 's' : ''}</span>
          <button style={filterBtnStyle}>Download CSV</button>
          <button style={filterBtnStyle}>Copy CSV</button>
          <button style={filterBtnStyle}>Print</button>
        </div>
      </div>

      <div style={{ flex: 1, padding: '0 20px 20px', overflow: 'hidden', minHeight: 0 }}>
  <LoanTable loans={loansForTable} onRowClick={handleLoanRowClick} lastColumnMode="earnings" />
</div>

      <SharedKpiDrawer
        open={drawerOpen && drawerMode?.kind === 'kpi'}
        kpi={drawerMode?.kind === 'kpi' ? drawerMode.kpi : null}
        onClose={closeDrawer}
        title={drawerTitle}
        subTitle={drawerSubTitle}
      >
        {drawerMode?.kind === 'kpi' && <KpiEarningsDrawerBody kpi={drawerMode.kpi} loansWithRoi={loansWithRoi} />}
      </SharedKpiDrawer>

      <SharedLoanDrawer
        loan={activeLoan}
        open={drawerOpen && drawerMode?.kind === 'loan'}
        onClose={closeDrawer}
        title={drawerTitle}
        subTitle={drawerSubTitle}
      >
        {drawerMode?.kind === 'loan' && activeLoan && <LoanEarningsDrawerBody loan={activeLoan} />}
      </SharedLoanDrawer>
    </div>
  )
}
